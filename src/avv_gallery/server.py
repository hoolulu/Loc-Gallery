# -*- coding: utf-8 -*-
import asyncio
import mimetypes
import os
import subprocess
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from avv_gallery.category_store import get_meta, set_order, set_sort_mode, set_starred, sort_categories
from avv_gallery.config import HOST, PORT, POTPLAYER_CANDIDATES, POTPLAYER_PATH, VIDEO_EXTENSIONS, WEB_ROOT


def _resolve_potplayer(settings: dict) -> Path:
    configured = (settings.get("potplayer_path") or "").strip() or str(POTPLAYER_PATH or "").strip()
    if configured:
        player = Path(configured)
        if player.is_file():
            return player
        if configured not in (".", ".."):
            raise HTTPException(500, f"PotPlayer 未找到: {player}")
    for candidate in POTPLAYER_CANDIDATES:
        if candidate.is_file():
            return candidate
    raise HTTPException(
        500,
        "未配置 PotPlayer 路径。请在「设置」中填写 PotPlayerMini64.exe，或切换为「网页 HTML5」播放。",
    )


def _launch_potplayer(player: Path, video_path: str) -> None:
    try:
        subprocess.Popen(
            [str(player), video_path],
            creationflags=subprocess.DETACHED_PROCESS,
            close_fds=False,
        )
    except OSError as exc:
        raise HTTPException(500, f"无法启动 PotPlayer: {exc}") from exc
from avv_gallery.file_stability import is_incomplete_filename, notify_file_activity, set_stable_callback
from avv_gallery.favorite_store import (
    batch_favorites,
    get_added_at,
    get_favorite_count,
    get_favorite_ids,
    is_favorite,
    list_favorite_ids_sorted,
    prune_missing as prune_favorites,
    remove_favorites,
    toggle_favorite,
)
from avv_gallery.file_ops import delete_videos, move_videos, rename_video
from avv_gallery.history_store import (
    clear_history,
    get_entry as get_history_entry,
    get_history_count,
    list_history_ids_sorted,
    prune_missing as prune_history,
    record_play,
    remove_history,
)
from avv_gallery import hls_manager
from avv_gallery.media_probe import get_playback_plan, schedule_probe_for_ids
from avv_gallery.library_context import set_thread_library
from avv_gallery.library_store import (
    add_library,
    get_active_library_id,
    get_library,
    list_libraries,
    pick_folder_windows,
    remove_library,
    set_active_library,
    update_library,
)
from avv_gallery.scanner import (
    get_all, get_by_id, get_categories, get_folder_tree, get_version, refresh_all_libraries,
    refresh_cache,
)
from avv_gallery.settings_store import load_settings, save_settings
from avv_gallery.thumb_manager import (
    Priority,
    cleanup_orphans,
    ensure_scheduled,
    get_failed_items,
    get_status,
    get_thumb_path,
    get_thumb_version,
    get_video_thumb_status,
    get_video_thumb_error,
    get_worker_health,
    init_manager,
    is_paused,
    is_thumb_ready,
    pause_queue,
    regenerate_category,
    regenerate_failed,
    reconcile_deferred_thumbs,
    regenerate_ids,
    register_progress_callback,
    remove_thumbs,
    resume_queue,
    schedule_ids,
    shutdown_manager,
    start_idle_scan_background,
    stop_idle_scan_background,
    sync_index_with_videos,
)


class RegenerateRequest(BaseModel):
    ids: list[str] = []
    thumb_position: float | None = None
    thumb_random: bool = False


class PriorityRequest(BaseModel):
    ids: list[str] = []


class DeleteRequest(BaseModel):
    ids: list[str] = []


class RenameRequest(BaseModel):
    id: str
    new_name: str


class MoveRequest(BaseModel):
    ids: list[str] = []
    category: str


class CategoryStarRequest(BaseModel):
    name: str
    starred: bool


class CategoryReorderRequest(BaseModel):
    order: list[str]


class CategorySortRequest(BaseModel):
    sort_mode: str


class SettingsUpdate(BaseModel):
    thumb_position: float | None = None
    thumb_random_min: float | None = None
    thumb_random_max: float | None = None
    thumb_workers: int | None = None
    thumb_idle_scan: bool | None = None
    default_page_size: int | None = None
    potplayer_path: str | None = None
    player_mode: str | None = None
    history_retention_days: int | None = None


class FavoriteToggleRequest(BaseModel):
    id: str


class FavoriteBatchRequest(BaseModel):
    ids: list[str] = []
    action: str  # add | remove


class SettingsUpdate(BaseModel):
    thumb_position: float | None = None
    thumb_random_min: float | None = None
    thumb_random_max: float | None = None
    thumb_workers: int | None = None
    thumb_idle_scan: bool | None = None
    default_page_size: int | None = None
    potplayer_path: str | None = None
    player_mode: str | None = None
    history_retention_days: int | None = None
    scope: str | None = None  # global | library


class LibraryCreateRequest(BaseModel):
    alias: str
    path: str


class LibraryUpdateRequest(BaseModel):
    alias: str | None = None
    path: str | None = None


class LibraryDeleteRequest(BaseModel):
    delete_data: bool = False


_observers: dict[str, Observer] = {}
_sse_queues: list[asyncio.Queue] = []


def resolve_library_id(library_id: str | None = Query(None)) -> str:
    lid = (library_id or "").strip() or get_active_library_id()
    if not get_library(lid):
        raise HTTPException(404, "视频库不存在")
    set_thread_library(lid)
    return lid


def _on_library_changed(library_id: str) -> None:
    """文件库变更：刷新索引，并为新/变更视频排队缩略图与格式分析。"""
    set_thread_library(library_id)
    refresh_cache(library_id)
    reconcile_deferred_thumbs()
    _prune_user_data(library_id)
    changed_ids = sync_index_with_videos()
    if changed_ids:
        schedule_ids(changed_ids, Priority.NORMAL)
        schedule_probe_for_ids(changed_ids, library_id)
    _broadcast("version", library_id, str(get_version(library_id)))
    _broadcast("progress", library_id)


def _broadcast(event_type: str = "version", library_id: str | None = None, data: str | None = None):
    lid = library_id or get_active_library_id()
    if data is None:
        data = str(get_version(lid))
    payload = f"{lid}:{data}" if event_type == "version" else data
    for q in _sse_queues:
        try:
            q.put_nowait(f"{event_type}:{payload}")
        except Exception:
            pass


class _ChangeHandler(FileSystemEventHandler):
    def __init__(self, library_id: str):
        self.library_id = library_id

    def on_any_event(self, event):
        if event.is_directory:
            return
        path = Path(event.src_path)
        if is_incomplete_filename(path.name):
            return
        if path.suffix.lower() not in VIDEO_EXTENSIONS:
            return
        if event.event_type == "deleted":
            _on_library_changed(self.library_id)
            return
        set_thread_library(self.library_id)
        notify_file_activity(path, self.library_id)


def _start_watchers() -> None:
    global _observers
    for lib in list_libraries():
        if not lib.exists():
            continue
        handler = _ChangeHandler(lib.id)
        obs = Observer()
        obs.schedule(handler, str(lib.path_obj), recursive=True)
        obs.start()
        _observers[lib.id] = obs


def _stop_watchers() -> None:
    for obs in _observers.values():
        obs.stop()
        obs.join()
    _observers.clear()


def _restart_watchers() -> None:
    _stop_watchers()
    _start_watchers()


@asynccontextmanager
async def lifespan(app: FastAPI):
    def _stable_cb():
        from avv_gallery.library_context import current_library_id
        _on_library_changed(current_library_id())

    set_stable_callback(_stable_cb)
    refresh_all_libraries()
    for lib in list_libraries():
        set_thread_library(lib.id)
        _prune_user_data(lib.id)
    init_manager()
    register_progress_callback(lambda: _broadcast("progress", get_active_library_id()))

    _start_watchers()

    yield

    set_stable_callback(None)
    shutdown_manager()
    hls_manager.shutdown()
    _stop_watchers()


app = FastAPI(title="Loc Gallery", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(WEB_ROOT / "static")), name="static")
app.mount(
    "/demo",
    StaticFiles(directory=str(WEB_ROOT / "static" / "demo"), html=True),
    name="demo",
)


def _prune_user_data(library_id: str) -> None:
    valid = {v.id for v in get_all(library_id)}
    prune_favorites(library_id, valid)
    prune_history(library_id, valid)


def _video_to_dict(library_id: str, v) -> dict:
    hist = get_history_entry(library_id, v.id)
    fav_at = None
    if is_favorite(library_id, v.id):
        fav_at = get_added_at(library_id, v.id)
    return {
        "id": v.id,
        "title": v.title,
        "filename": v.filename,
        "path": v.path,
        "category": v.category,
        "subfolder": v.subfolder,
        "size": v.size,
        "mtime": v.mtime,
        "thumbStatus": get_video_thumb_status(v.id),
        "thumbReady": is_thumb_ready(v.id),
        "thumbError": get_video_thumb_error(v.id),
        "thumbVersion": get_thumb_version(v.id) or "",
        "favorited": fav_at is not None,
        "favoritedAt": fav_at,
        "playedAt": hist.get("played_at") if hist else None,
        "playCount": hist.get("play_count") if hist else None,
    }


def _filter_videos_list(
    library_id: str,
    *,
    category: str | None = None,
    folder: str | None = None,
    q: str | None = None,
    sort: str = "mtime_desc",
    favorites: bool = False,
    history: bool = False,
) -> list:
    if favorites and history:
        raise HTTPException(400, "不能同时筛选收藏与最近播放")

    if favorites:
        order_idx = {vid: i for i, vid in enumerate(list_favorite_ids_sorted(library_id))}
        items = [v for v in get_all(library_id) if v.id in order_idx]
        items.sort(key=lambda v: order_idx.get(v.id, 10_000))
    elif history:
        order_idx = {vid: i for i, vid in enumerate(list_history_ids_sorted(library_id))}
        items = [v for v in get_all(library_id) if v.id in order_idx]
        items.sort(key=lambda v: order_idx.get(v.id, 10_000))
    else:
        folder_filter = folder if category else None
        if category and folder is None and not q:
            folder_filter = ""
        items = _filter_videos(library_id, category, folder_filter, q, sort)
        return items

    if q:
        query = q.lower().strip()
        items = [
            v for v in items
            if query in v.title.lower()
            or query in v.filename.lower()
            or query in v.category.lower()
        ]
    return items


def _filter_videos(
    library_id: str,
    category: str | None = None,
    folder: str | None = None,
    q: str | None = None,
    sort: str = "mtime_desc",
) -> list:
    items = get_all(library_id)
    if category:
        items = [v for v in items if v.category == category]
        if folder is not None:
            items = [v for v in items if v.subfolder == folder]
    if q:
        query = q.lower().strip()
        items = [
            v for v in items
            if query in v.title.lower()
            or query in v.filename.lower()
            or query in v.category.lower()
        ]

    sort_key = {
        "mtime_desc": lambda v: v.mtime,
        "mtime_asc": lambda v: v.mtime,
        "title_asc": lambda v: v.title.lower(),
        "title_desc": lambda v: v.title.lower(),
        "size_desc": lambda v: v.size,
        "size_asc": lambda v: v.size,
        "category_asc": lambda v: v.category.lower(),
    }.get(sort, lambda v: v.mtime)

    reverse = sort in ("mtime_desc", "title_desc", "size_desc")
    items.sort(key=sort_key, reverse=reverse)
    return items


@app.get("/")
async def index():
    return FileResponse(
        WEB_ROOT / "static" / "index.html",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache",
        },
    )


@app.get("/api/libraries")
async def api_libraries_list():
    libs = list_libraries()
    active = get_active_library_id()
    return {
        "active_library_id": active,
        "items": [lib.to_dict() for lib in libs],
    }


@app.post("/api/libraries")
async def api_libraries_create(req: LibraryCreateRequest):
    try:
        lib = add_library(req.alias, req.path)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    set_thread_library(lib.id)
    refresh_cache(lib.id)
    _restart_watchers()
    _on_library_changed(lib.id)
    return {"ok": True, "library": lib.to_dict(), "active_library_id": get_active_library_id()}


@app.patch("/api/libraries/{library_id}")
async def api_libraries_update(library_id: str, req: LibraryUpdateRequest):
    try:
        lib = update_library(library_id, alias=req.alias, path=req.path)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    set_thread_library(lib.id)
    refresh_cache(lib.id)
    _restart_watchers()
    _on_library_changed(lib.id)
    return {"ok": True, "library": lib.to_dict()}


@app.delete("/api/libraries/{library_id}")
async def api_libraries_delete(library_id: str, req: LibraryDeleteRequest | None = None):
    delete_data = bool(req and req.delete_data)
    try:
        remove_library(library_id, delete_data=delete_data)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    _restart_watchers()
    return {"ok": True, "active_library_id": get_active_library_id()}


@app.post("/api/libraries/{library_id}/activate")
async def api_libraries_activate(library_id: str):
    try:
        lib = set_active_library(library_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    set_thread_library(lib.id)
    refresh_cache(lib.id)
    return {"ok": True, "library": lib.to_dict(), "active_library_id": lib.id}


@app.post("/api/libraries/pick-folder")
async def api_libraries_pick_folder():
    try:
        selected = pick_folder_windows()
    except OSError as exc:
        raise HTTPException(500, str(exc)) from exc
    if not selected:
        return {"ok": False, "cancelled": True}
    return {"ok": True, "path": selected}


@app.get("/api/categories")
async def api_categories(library_id: str = Depends(resolve_library_id)):
    return {
        "items": get_categories(library_id),
        "sort_mode": get_meta(library_id).get("sort_mode", "custom"),
    }


@app.post("/api/categories/star")
async def api_category_star(req: CategoryStarRequest, library_id: str = Depends(resolve_library_id)):
    if not req.name:
        raise HTTPException(400, "分类名不能为空")
    meta = set_starred(library_id, req.name, req.starred)
    return {"ok": True, "starred": req.name in meta.get("starred", []), "items": get_categories(library_id)}


@app.post("/api/categories/reorder")
async def api_category_reorder(req: CategoryReorderRequest, library_id: str = Depends(resolve_library_id)):
    if not req.order:
        raise HTTPException(400, "顺序不能为空")
    set_order(library_id, req.order)
    return {"ok": True, "items": get_categories(library_id)}


@app.post("/api/categories/sort-mode")
async def api_category_sort_mode(req: CategorySortRequest, library_id: str = Depends(resolve_library_id)):
    try:
        set_sort_mode(library_id, req.sort_mode)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "sort_mode": req.sort_mode, "items": get_categories(library_id)}


@app.get("/api/folders")
async def api_folders(category: str, library_id: str = Depends(resolve_library_id)):
    if not category:
        raise HTTPException(400, "需要指定分类")
    return get_folder_tree(library_id, category)


@app.get("/api/videos")
async def api_videos(
    category: str | None = None,
    folder: str | None = None,
    q: str | None = None,
    sort: str = "mtime_desc",
    page: int = 1,
    page_size: int = 32,
    favorites: bool = False,
    history: bool = False,
    library_id: str = Depends(resolve_library_id),
):
    items = _filter_videos_list(
        library_id,
        category=category if not favorites and not history else None,
        folder=folder if not favorites and not history else None,
        q=q,
        sort=sort,
        favorites=favorites,
        history=history,
    )
    total = len(items)

    if page_size <= 0:
        page_items = items
        page = 1
        total_pages = 1
        effective_size = total
    else:
        total_pages = max(1, (total + page_size - 1) // page_size)
        page = max(1, min(page, total_pages))
        start = (page - 1) * page_size
        page_items = items[start:start + page_size]
        effective_size = page_size

    return {
        "items": [_video_to_dict(library_id, v) for v in page_items],
        "total": total,
        "page": page,
        "pageSize": effective_size,
        "totalPages": total_pages,
        "view": "favorites" if favorites else ("history" if history else "browse"),
        "library_id": library_id,
    }


@app.get("/api/videos/{video_id}")
async def api_video_item(video_id: str, library_id: str = Depends(resolve_library_id)):
    item = get_by_id(library_id, video_id)
    if not item:
        raise HTTPException(404, "视频不存在")
    return _video_to_dict(library_id, item)


@app.get("/api/favorites/summary")
async def api_favorites_summary(library_id: str = Depends(resolve_library_id)):
    return {"count": get_favorite_count(library_id)}


@app.post("/api/favorites/toggle")
async def api_favorites_toggle(req: FavoriteToggleRequest, library_id: str = Depends(resolve_library_id)):
    if not req.id or not get_by_id(library_id, req.id):
        raise HTTPException(404, "视频不存在")
    starred = toggle_favorite(library_id, req.id)
    return {
        "ok": True,
        "id": req.id,
        "favorited": starred,
        "favoritedAt": get_added_at(library_id, req.id),
        "count": get_favorite_count(library_id),
    }


@app.post("/api/favorites/batch")
async def api_favorites_batch(req: FavoriteBatchRequest, library_id: str = Depends(resolve_library_id)):
    if req.action not in ("add", "remove"):
        raise HTTPException(400, "action 须为 add 或 remove")
    ids = [i for i in req.ids if get_by_id(library_id, i)]
    result = batch_favorites(library_id, ids, req.action)
    result["count"] = get_favorite_count(library_id)
    return {"ok": True, **result}


@app.get("/api/history/summary")
async def api_history_summary(library_id: str = Depends(resolve_library_id)):
    return {"count": get_history_count(library_id)}


@app.post("/api/history/record")
async def api_history_record(req: FavoriteToggleRequest, library_id: str = Depends(resolve_library_id)):
    if not req.id or not get_by_id(library_id, req.id):
        raise HTTPException(404, "视频不存在")
    entry = record_play(library_id, req.id)
    return {"ok": True, "id": req.id, **entry}


@app.post("/api/history/clear")
async def api_history_clear(library_id: str = Depends(resolve_library_id)):
    removed = clear_history(library_id)
    return {"ok": True, "removed": removed}


@app.get("/api/thumb/status")
async def api_thumb_status(
    category: str | None = None,
    page_ids: str | None = None,
    library_id: str = Depends(resolve_library_id),
):
    ids = [x.strip() for x in page_ids.split(",") if x.strip()] if page_ids else None
    result = get_status(category, ids)
    result["worker"] = get_worker_health()
    return result


@app.get("/api/thumb/failed")
async def api_thumb_failed(library_id: str = Depends(resolve_library_id)):
    items = get_failed_items()
    return {"items": items, "total": len(items)}


@app.get("/api/thumb/{video_id}")
async def api_thumb(video_id: str, library_id: str = Depends(resolve_library_id)):
    item = get_by_id(library_id, video_id)
    if not item:
        raise HTTPException(404, "视频不存在")

    thumb = get_thumb_path(item)
    if not thumb:
        st = get_video_thumb_status(video_id)
        if st == "missing":
            ensure_scheduled(video_id, Priority.HIGH)
        raise HTTPException(404, "缩略图生成中")

    return FileResponse(
        thumb,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache",
        },
    )


@app.get("/api/stream/{video_id}")
async def api_stream(video_id: str, library_id: str = Depends(resolve_library_id)):
    item = get_by_id(library_id, video_id)
    if not item:
        raise HTTPException(404, "视频不存在")
    path = Path(item.path)
    if not path.is_file():
        raise HTTPException(404, "文件不存在")
    media_type, _ = mimetypes.guess_type(str(path))
    if not media_type or not media_type.startswith("video/"):
        media_type = "application/octet-stream"
    return FileResponse(path, media_type=media_type, filename=path.name)


@app.get("/api/play/info/{video_id}")
async def api_play_info(video_id: str, library_id: str = Depends(resolve_library_id)):
    item = get_by_id(library_id, video_id)
    if not item:
        raise HTTPException(404, "视频不存在")
    plan = get_playback_plan(Path(item.path))
    return {"id": video_id, "title": item.title, "path": item.path, **plan}


@app.post("/api/play/prepare/{video_id}")
async def api_play_prepare(video_id: str, library_id: str = Depends(resolve_library_id)):
    item = get_by_id(library_id, video_id)
    if not item:
        raise HTTPException(404, "视频不存在")
    plan = get_playback_plan(Path(item.path))
    if plan["mode"] != "hls":
        return {"ok": True, "mode": plan["mode"], **plan}
    result = hls_manager.prepare(
        video_id,
        Path(item.path),
        transcode=bool(plan.get("transcode")),
        input_format=plan.get("input_format"),
        input_offset=int((plan.get("structure") or {}).get("h264_offset") or 0),
    )
    return {"ok": result.get("ok", True), "mode": "hls", **result}


@app.get("/api/play/status/{video_id}")
async def api_play_status(video_id: str, library_id: str = Depends(resolve_library_id)):
    return hls_manager.get_status(video_id)


@app.post("/api/play/stop")
async def api_play_stop(library_id: str = Depends(resolve_library_id)):
    had = hls_manager.stop_playback(force=True)
    return {"ok": True, "was_active": had}


@app.get("/api/hls/{video_id}/{filename}")
async def api_hls_file(video_id: str, filename: str, library_id: str = Depends(resolve_library_id)):
    path = hls_manager.resolve_hls_file(video_id, filename)
    if not path:
        raise HTTPException(404, "HLS 文件不存在")
    media = "application/vnd.apple.mpegurl" if filename.endswith(".m3u8") else "video/mp2t"
    return FileResponse(
        path,
        media_type=media,
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/play/{video_id}")
async def api_play(video_id: str, library_id: str = Depends(resolve_library_id)):
    item = get_by_id(library_id, video_id)
    if not item:
        raise HTTPException(404, "视频不存在")

    settings = load_settings(library_id)
    if settings.get("player_mode") == "html5":
        plan = get_playback_plan(Path(item.path))
        return {
            "ok": True,
            "mode": "html5",
            "playback": plan,
            "stream_url": f"/api/stream/{video_id}?library_id={library_id}",
        }

    player = _resolve_potplayer(settings)
    _launch_potplayer(player, item.path)
    record_play(library_id, video_id)
    return {"ok": True, "mode": "potplayer", "path": item.path}


@app.post("/api/play-external/{video_id}")
async def api_play_external(video_id: str, library_id: str = Depends(resolve_library_id)):
    """始终使用 PotPlayer 打开（HTML5 模式下也可从播放器面板调用）。"""
    item = get_by_id(library_id, video_id)
    if not item:
        raise HTTPException(404, "视频不存在")
    settings = load_settings(library_id)
    player = _resolve_potplayer(settings)
    _launch_potplayer(player, item.path)
    record_play(library_id, video_id)
    return {"ok": True, "path": item.path}


@app.post("/api/open-folder/{video_id}")
async def api_open_folder(video_id: str, library_id: str = Depends(resolve_library_id)):
    item = get_by_id(library_id, video_id)
    if not item:
        raise HTTPException(404, "视频不存在")
    folder = str(Path(item.path).parent)
    os.startfile(folder)
    return {"ok": True, "folder": folder}


def _after_file_change(library_id: str, old_ids: list[str] | None = None) -> None:
    set_thread_library(library_id)
    if old_ids:
        remove_thumbs(old_ids)
        remove_favorites(library_id, old_ids)
        remove_history(library_id, old_ids)
    sync_index_with_videos()
    cleanup_orphans()
    _prune_user_data(library_id)
    _broadcast("version", library_id, str(get_version(library_id)))
    _broadcast("progress", library_id)


@app.post("/api/videos/delete")
async def api_videos_delete(req: DeleteRequest, library_id: str = Depends(resolve_library_id)):
    if not req.ids:
        raise HTTPException(400, "未选择视频")
    result = delete_videos(library_id, req.ids)
    if result["deleted"]:
        _after_file_change(library_id, result["deleted"])
    return result


@app.post("/api/videos/rename")
async def api_videos_rename(req: RenameRequest, library_id: str = Depends(resolve_library_id)):
    old_id = req.id
    try:
        item = rename_video(library_id, old_id, req.new_name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except OSError as exc:
        raise HTTPException(500, str(exc)) from exc
    _after_file_change(library_id, [old_id])
    return {
        "ok": True,
        "old_id": old_id,
        "id": item.id,
        "title": item.title,
        "filename": item.filename,
        "category": item.category,
    }


@app.post("/api/videos/move")
async def api_videos_move(req: MoveRequest, library_id: str = Depends(resolve_library_id)):
    if not req.ids:
        raise HTTPException(400, "未选择视频")
    if not req.category:
        raise HTTPException(400, "未指定目标分类")
    result = move_videos(library_id, req.ids, req.category)
    if result["moved"]:
        old_ids = [m["old_id"] for m in result["moved"]]
        _after_file_change(library_id, old_ids)
    return result


@app.post("/api/rescan")
async def api_rescan(library_id: str = Depends(resolve_library_id)):
    refresh_cache(library_id)
    reconcile_deferred_thumbs()
    sync_index_with_videos()
    cleanup_orphans()
    _prune_user_data(library_id)
    _broadcast("progress", library_id)
    return {"version": get_version(library_id), "count": len(get_all(library_id))}


@app.post("/api/thumb/priority")
async def api_thumb_priority(req: PriorityRequest, library_id: str = Depends(resolve_library_id)):
    count = schedule_ids(req.ids, Priority.HIGH)
    return {"queued": count}


@app.post("/api/thumb/regenerate")
async def api_thumb_regenerate(
    req: RegenerateRequest,
    category: str | None = None,
    library_id: str = Depends(resolve_library_id),
):
    if category:
        count, versions, _positions = regenerate_category(category)
        positions = {}
    else:
        count, versions, positions = regenerate_ids(
            req.ids,
            position=req.thumb_position,
            random_position=req.thumb_random,
        )
    return {"regenerated": count, "versions": versions, "positions": positions}


@app.post("/api/thumb/regenerate-failed")
async def api_thumb_regenerate_failed(library_id: str = Depends(resolve_library_id)):
    count, versions, _positions = regenerate_failed()
    return {"regenerated": count, "versions": versions}


@app.post("/api/thumb/pause")
async def api_thumb_pause(library_id: str = Depends(resolve_library_id)):
    pause_queue()
    return {"paused": True}


@app.post("/api/thumb/resume")
async def api_thumb_resume(library_id: str = Depends(resolve_library_id)):
    resume_queue()
    return {"paused": False}


@app.post("/api/thumb/cleanup")
async def api_thumb_cleanup(library_id: str = Depends(resolve_library_id)):
    removed = cleanup_orphans()
    sync_index_with_videos()
    return {"removed": removed}


@app.get("/api/settings")
async def api_get_settings(
    library_id: str = Depends(resolve_library_id),
    scope: str = Query("merged"),
):
    if scope == "global":
        return load_settings()
    if scope == "library":
        return load_settings(library_id)
    merged = load_settings(library_id)
    merged["scope"] = "merged"
    return merged


@app.post("/api/settings")
async def api_save_settings(body: SettingsUpdate, library_id: str = Depends(resolve_library_id)):
    scope = body.scope or "library"
    payload = body.model_dump(exclude_none=True, exclude={"scope"})
    if scope == "global":
        current = load_settings()
        old_idle = current.get("thumb_idle_scan")
        current.update(payload)
        saved = save_settings(current)
    else:
        current = load_settings(library_id)
        old_idle = current.get("thumb_idle_scan")
        current.update(payload)
        saved = save_settings(current, library_id)
    if saved.get("thumb_idle_scan") and not old_idle:
        start_idle_scan_background()
    elif not saved.get("thumb_idle_scan") and old_idle:
        stop_idle_scan_background()
    return saved


@app.get("/api/events")
async def api_events(library_id: str | None = Query(None)):
    lid = (library_id or "").strip() or get_active_library_id()
    set_thread_library(lid)
    queue: asyncio.Queue = asyncio.Queue()
    _sse_queues.append(queue)

    async def stream():
        try:
            yield f"data: version:{lid}:{get_version(lid)}\n\n"
            while True:
                msg = await queue.get()
                yield f"data: {msg}\n\n"
        finally:
            if queue in _sse_queues:
                _sse_queues.remove(queue)

    return StreamingResponse(stream(), media_type="text/event-stream")


def run():
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    run()
