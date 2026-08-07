# -*- coding: utf-8 -*-
import asyncio
import mimetypes
import os
import random
import shutil
import subprocess
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer


class ImmutableStaticFiles(StaticFiles):
    """Vite 带 hash 的构建产物：允许浏览器长期缓存。"""

    def __init__(
        self,
        *args,
        cache_control: str = "public, max-age=31536000, immutable",
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self._cache_control = cache_control

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers.setdefault("Cache-Control", self._cache_control)
        return response


def _static_cache_control(relative_path: str) -> str | None:
    name = relative_path.rsplit("/", 1)[-1]
    if relative_path.startswith("assets/"):
        return "public, max-age=31536000, immutable"
    if name in ("favicon.svg", "icons.svg"):
        return "public, max-age=86400"
    return None

from loc_gallery.category_store import get_meta, set_order, set_sort_mode, set_starred, sort_categories
from loc_gallery.config import HOST, PORT, POTPLAYER_CANDIDATES, POTPLAYER_PATH, VIDEO_EXTENSIONS, WEB_ROOT
from loc_gallery.range_stream import stream_file_with_disconnect


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
from loc_gallery.file_stability import is_incomplete_filename, notify_file_activity, set_stable_callback
from loc_gallery.favorite_store import (
    batch_favorites,
    get_added_at,
    get_favorite_count,
    get_favorite_ids,
    get_favorites_map,
    is_favorite,
    list_favorite_ids_sorted,
    prune_missing as prune_favorites,
    remove_favorites,
    toggle_favorite,
)
from loc_gallery.album_store import (
    add_videos as album_add_videos,
    create_album,
    delete_album,
    get_album,
    get_album_ids_for_video,
    get_album_map_for_videos,
    list_albums,
    list_album_video_ids_sorted,
    prune_missing as prune_albums,
    remove_video_from_all_albums,
    remove_videos as album_remove_videos,
    reorder_albums,
    reorder_videos as album_reorder_videos,
    set_cover as album_set_cover,
    update_album,
)
from loc_gallery.file_ops import delete_videos, move_videos, rename_video
from loc_gallery.history_store import (
    clear_history,
    get_entry as get_history_entry,
    get_history_count,
    get_history_map,
    list_history_ids_sorted,
    prune_missing as prune_history,
    record_play,
    remove_history,
    save_position,
)
from loc_gallery import hls_manager
from loc_gallery.format_index import (
    enqueue_missing_format_probe,
    filter_items_by_format,
    get_format_status,
    rebuild_format_index_from_plans,
    set_format_kind,
    shutdown_format_index,
    start_format_index_background,
)
from loc_gallery.media_probe import (
    can_remux_from_plan,
    classify_format_plan,
    force_probe_playback_plan,
    get_format_badge_for_item,
    get_format_badges,
    get_playback_plan,
)
from loc_gallery.remux_manager import (
    begin_remux_batch,
    end_remux_batch,
    get_status as remux_status,
    is_remux_watcher_paused,
    start_remux,
)
from loc_gallery.library_context import set_thread_library
from loc_gallery.library_store import (
    add_library,
    get_active_library_id,
    get_library,
    list_libraries,
    pick_folder_windows,
    remove_library,
    set_active_library,
    update_library,
)
from loc_gallery.scanner import (
    get_all, get_by_id, get_categories, get_category_sorted_ids, get_folder_tree,
    get_sorted_ids, get_version,
    refresh_cache, upsert_video_from_path,
)
from loc_gallery.settings_store import load_settings, save_settings
from loc_gallery.service_ctl import schedule_service_restart
from loc_gallery.thumb_manager import (
    Priority,
    _thumb_file,
    cleanup_orphans,
    ensure_scheduled,
    generate_thumb_candidates,
    get_candidate_path,
    get_failed_items,
    get_status,
    get_thumb_path,
    get_thumb_version,
    get_video_thumb_status,
    get_video_thumb_error,
    get_video_duration_sec,
    get_durations_for_ids,
    get_duration_status,
    duration_sec_from_index_entry,
    enqueue_duration_probe,
    enqueue_missing_durations,
    backfill_durations_from_history,
    batch_regenerate_with_candidates,
    start_duration_probe_background,
    get_worker_health,
    init_manager,
    is_paused,
    is_thumb_ready,
    pause_queue,
    pick_thumb_candidate,
    regenerate_category,
    regenerate_failed,
    reconcile_deferred_thumbs,
    regenerate_ids,
    register_progress_callback,
    remove_thumbs,
    resolve_thumb_fields_for_list,
    resume_queue,
    schedule_ids,
    shutdown_manager,
    snapshot_thumb_list_state,
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
    auto_select: bool = True


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


class FavoriteToggleRequest(BaseModel):
    id: str


class HistoryPositionRequest(BaseModel):
    id: str
    position_sec: float
    duration_sec: float | None = None


class FavoriteBatchRequest(BaseModel):
    ids: list[str] = []
    action: str  # add | remove


class AlbumCreateRequest(BaseModel):
    name: str
    description: str | None = None


class AlbumUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    cover_video_id: str | None = None


class AlbumReorderRequest(BaseModel):
    order: list[str]


class AlbumVideosRequest(BaseModel):
    ids: list[str] = []


class AlbumVideosReorderRequest(BaseModel):
    order: list[str]


class AlbumCoverRequest(BaseModel):
    video_id: str


class SettingsUpdate(BaseModel):
    thumb_position: float | None = None
    thumb_random_min: float | None = None
    thumb_random_max: float | None = None
    thumb_workers: int | None = None
    thumb_idle_scan: bool | None = None
    thumb_progress_bar: str | None = None  # auto | always | never
    thumb_candidate_count: int | None = None
    thumb_auto_select_best: bool | None = None
    thumb_batch_auto_select: bool | None = None
    thumb_jitter_pct: int | None = None
    thumb_jitter_min: int | None = None
    thumb_jitter_max: int | None = None
    default_page_size: int | None = None
    potplayer_path: str | None = None
    player_mode: str | None = None
    history_retention_days: int | None = None
    hls_large_h264: bool | None = None
    hls_moov_end_h264: bool | None = None
    html5_fragmented_mp4: str | None = None
    html5_playlist_autoplay: bool | None = None
    html5_resume_playback: bool | None = None
    html5_wheel_seek_sec: int | None = None
    html5_modern_codecs_direct: bool | None = None
    html5_player_prev_key: str | None = None
    html5_player_next_key: str | None = None
    ui_theme: str | None = None  # dark | light
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


def notify_library_sse(library_id: str) -> None:
    """轻量通知前端刷新（不触发全库扫描）。"""
    _broadcast("version", library_id, str(get_version(library_id)))


def schedule_library_refresh(library_id: str) -> None:
    """后台补一次库索引刷新（批量修复结束后等场景）。"""
    threading.Thread(
        target=_on_library_changed,
        args=(library_id,),
        daemon=True,
        name=f"library-refresh-{library_id[:8]}",
    ).start()


async def _playback_plan(path: Path) -> dict:
    """在后台线程执行播放策略分析，避免阻塞事件循环。"""
    return await asyncio.to_thread(get_playback_plan, path)


def _on_library_changed(library_id: str) -> None:
    """文件库变更：刷新索引，并为新/变更视频排队缩略图与格式分析。"""
    set_thread_library(library_id)
    refresh_cache(library_id)
    reconcile_deferred_thumbs()
    _prune_user_data(library_id)
    changed_ids = sync_index_with_videos()
    if changed_ids:
        schedule_ids(changed_ids, Priority.NORMAL)
        # Duration/format probes deferred — _process_one enqueues per-video after thumb generation
    _broadcast("version", library_id, str(get_version(library_id)))
    _broadcast("progress", library_id)


def _on_video_stable(library_id: str, path: Path) -> None:
    """单个文件写入稳定后增量入库（新下载完成）。"""
    set_thread_library(library_id)
    item = upsert_video_from_path(library_id, path)
    if not item:
        _on_library_changed(library_id)
        return
    reconcile_deferred_thumbs()
    changed_ids = sync_index_with_videos()
    thumb_ids = [item.id]
    if changed_ids:
        thumb_ids = list(dict.fromkeys([item.id, *changed_ids]))
    schedule_ids(thumb_ids, Priority.NORMAL)
    _broadcast("version", library_id, str(get_version(library_id)))
    _broadcast("progress", library_id)


class _ChangeHandler(FileSystemEventHandler):
    def __init__(self, library_id: str):
        self.library_id = library_id

    def _candidate_paths(self, event) -> list[Path]:
        out: list[Path] = []
        dest = getattr(event, "dest_path", None)
        if dest and not Path(dest).is_dir():
            out.append(Path(dest))
        src = getattr(event, "src_path", None)
        if src:
            src_path = Path(src)
            if not src_path.is_dir() and src_path not in out:
                out.append(src_path)
        return out

    def _handle_path(self, path: Path, event_type: str) -> None:
        if is_remux_watcher_paused(self.library_id):
            return
        if is_incomplete_filename(path.name):
            return
        if path.suffix.lower() not in VIDEO_EXTENSIONS:
            return
        if event_type == "deleted":
            _on_library_changed(self.library_id)
            return
        set_thread_library(self.library_id)
        notify_file_activity(path, self.library_id)

    def on_any_event(self, event):
        if event.is_directory:
            return
        for path in self._candidate_paths(event):
            self._handle_path(path, event.event_type)


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
    def _stable_cb(path: Path | None = None):
        from loc_gallery.library_context import current_library_id

        library_id = current_library_id()
        if path is not None:
            _on_video_stable(library_id, path)
        else:
            _on_library_changed(library_id)

    set_stable_callback(_stable_cb)
    active_id = get_active_library_id()
    refresh_cache(active_id)
    for lib in list_libraries():
        if lib.id == active_id:
            set_thread_library(lib.id)
            _prune_user_data(lib.id)
    init_manager(sync_videos=False)
    register_progress_callback(lambda: _broadcast("progress", get_active_library_id()))
    _start_watchers()
    hls_manager.enforce_cache_limits_all_libraries([lib.id for lib in list_libraries()])

    def _startup_background() -> None:
        from loc_gallery.thumb_manager import complete_startup_sync

        for lib in list_libraries():
            if lib.id == active_id:
                continue
            refresh_cache(lib.id)
        for lib in list_libraries():
            if lib.id == active_id:
                continue
            set_thread_library(lib.id)
            _prune_user_data(lib.id)
        complete_startup_sync()
        for lib in list_libraries():
          start_format_index_background(lib.id)

    threading.Thread(target=_startup_background, daemon=True, name="startup-bg").start()

    yield

    set_stable_callback(None)
    shutdown_format_index()
    shutdown_manager()
    hls_manager.shutdown()
    _stop_watchers()


app = FastAPI(title="Loc Gallery", lifespan=lifespan)
_SERVER_BOOT_ID = uuid.uuid4().hex
_static_dir = WEB_ROOT / "static"
if _static_dir.is_dir():
    app.mount("/static", StaticFiles(directory=str(_static_dir)), name="static")
_demo_dir = WEB_ROOT / "static" / "demo"
if _demo_dir.is_dir():
    app.mount(
        "/demo",
        StaticFiles(directory=str(_demo_dir), html=True),
        name="demo",
    )

_dist_dir = WEB_ROOT / "frontend" / "dist"
_dist_assets = _dist_dir / "assets"
if _dist_assets.is_dir():
    app.mount(
        "/assets",
        ImmutableStaticFiles(directory=str(_dist_assets)),
        name="frontend-assets",
    )


def _prune_user_data(library_id: str) -> None:
    valid = {v.id for v in get_all(library_id)}
    if not valid:
        # 索引为空时跳过清理：扫描可能因文件处于 20 秒写入窗口/瞬时状态而暂时为空，
        # 此时按空集合 prune 会误删全部收藏/历史/专辑（不可逆）。
        import logging

        logging.getLogger("loc_gallery").warning(
            "跳过用户数据清理：库 %s 当前索引为空（可能为瞬时扫描空，而非真实删除）",
            library_id,
        )
        return
    prune_favorites(library_id, valid)
    prune_history(library_id, valid)
    prune_albums(library_id, valid)


def _video_to_dict(library_id: str, v, *, album_ids: list[str] | None = None) -> dict:
    hist = get_history_entry(library_id, v.id)
    fav_at = None
    if is_favorite(library_id, v.id):
        fav_at = get_added_at(library_id, v.id)
    duration = get_video_duration_sec(v.id, mtime=v.mtime, size=v.size)
    if not duration and hist:
        duration = hist.get("duration_sec")
    return {
        "id": v.id,
        "title": v.title,
        "filename": v.filename,
        "path": v.path,
        "category": v.category,
        "subfolder": v.subfolder,
        "size": v.size,
        "mtime": v.mtime,
        "thumbStatus": get_video_thumb_status(v.id, library_id),
        "thumbReady": is_thumb_ready(v.id, library_id),
        "thumbError": get_video_thumb_error(v.id, library_id),
        "thumbVersion": get_thumb_version(v.id, library_id) or "",
        "favorited": fav_at is not None,
        "favoritedAt": fav_at,
        "playedAt": hist.get("played_at") if hist else None,
        "playCount": hist.get("play_count") if hist else None,
        "playPosition": hist.get("position_sec") if hist else None,
        "playDuration": hist.get("duration_sec") if hist else None,
        "durationSec": duration,
        "albumIds": album_ids if album_ids is not None else get_album_ids_for_video(library_id, v.id),
        "formatBadge": get_format_badge_for_item(
            library_id, v.id, v.mtime, v.size, Path(v.path),
        ),
    }


def _videos_to_dicts(
    library_id: str,
    items: list,
    album_map: dict[str, list[str]],
) -> list[dict]:
    """列表 API：一次读取收藏/历史/缩略图索引，避免逐条读盘。"""
    if not items:
        return []
    fav_map = get_favorites_map(library_id)
    hist_map = get_history_map(library_id)
    thumb_index, generating, queued = snapshot_thumb_list_state(library_id)
    out: list[dict] = []
    for v in items:
        fav_entry = fav_map.get(v.id)
        hist = hist_map.get(v.id)
        thumb_status, thumb_ready, thumb_error, thumb_version = resolve_thumb_fields_for_list(
            v.id,
            thumb_index=thumb_index,
            generating=generating,
            queued=queued,
        )
        duration = duration_sec_from_index_entry(
            thumb_index.get(v.id),
            mtime=v.mtime,
            size=v.size,
        )
        if not duration and hist:
            duration = hist.get("duration_sec")
        out.append({
            "id": v.id,
            "title": v.title,
            "filename": v.filename,
            "path": v.path,
            "category": v.category,
            "subfolder": v.subfolder,
            "size": v.size,
            "mtime": v.mtime,
            "thumbStatus": thumb_status,
            "thumbReady": thumb_ready,
            "thumbError": thumb_error,
            "thumbVersion": thumb_version,
            "favorited": fav_entry is not None,
            "favoritedAt": float(fav_entry.get("added_at", 0)) if fav_entry else None,
            "playedAt": hist.get("played_at") if hist else None,
            "playCount": hist.get("play_count") if hist else None,
            "playPosition": hist.get("position_sec") if hist else None,
            "playDuration": hist.get("duration_sec") if hist else None,
            "durationSec": duration,
            "albumIds": album_map.get(v.id, []),
            "formatBadge": get_format_badge_for_item(
                library_id, v.id, v.mtime, v.size, Path(v.path),
            ),
        })
    return out


def _filter_videos_list(
    library_id: str,
    *,
    category: str | None = None,
    folder: str | None = None,
    q: str | None = None,
    sort: str = "mtime_desc",
    seed: int | None = None,
    favorites: bool = False,
    history: bool = False,
    album_id: str | None = None,
    format: str | None = None,
) -> list:
    modes = sum(1 for x in (favorites, history, bool(album_id)) if x)
    if modes > 1:
        raise HTTPException(400, "不能同时筛选收藏、最近播放与专辑")

    if favorites:
        order_idx = {vid: i for i, vid in enumerate(list_favorite_ids_sorted(library_id))}
        items = [v for v in get_all(library_id) if v.id in order_idx]
        items.sort(key=lambda v: order_idx.get(v.id, 10_000))
    elif history:
        order_idx = {vid: i for i, vid in enumerate(list_history_ids_sorted(library_id))}
        items = [v for v in get_all(library_id) if v.id in order_idx]
        items.sort(key=lambda v: order_idx.get(v.id, 10_000))
    elif album_id:
        order_idx = {vid: i for i, vid in enumerate(list_album_video_ids_sorted(library_id, album_id))}
        items = [v for v in get_all(library_id) if v.id in order_idx]
        items.sort(key=lambda v: order_idx.get(v.id, 10_000))
    else:
        folder_filter = folder if category else None
        if category and folder is None and not q:
            folder_filter = ""
        items = _filter_videos(library_id, category, folder_filter, q, sort, seed)

    if favorites or history or album_id:
        if q:
            query = q.lower().strip()
            items = [
                v for v in items
                if query in v.title.lower()
                or query in v.filename.lower()
                or query in v.category.lower()
            ]

    if format and format not in ("", "all"):
        items = filter_items_by_format(items, format, library_id)
    return items


_filter_ids_cache: dict[tuple, tuple[int, list[str]]] = {}


def _filter_cache_key(
    library_id: str,
    *,
    category: str | None,
    folder: str | None,
    q: str | None,
    sort: str,
    seed: int | None,
    favorites: bool,
    history: bool,
    album_id: str | None,
    format: str | None,
) -> tuple:
    return (
        library_id,
        category,
        folder,
        (q or "").strip().lower(),
        sort,
        seed,
        favorites,
        history,
        album_id,
        format or "",
    )


def _get_filtered_video_ids(
    library_id: str,
    *,
    category: str | None = None,
    folder: str | None = None,
    q: str | None = None,
    sort: str = "mtime_desc",
    seed: int | None = None,
    favorites: bool = False,
    history: bool = False,
    album_id: str | None = None,
    format: str | None = None,
) -> list[str]:
    """缓存过滤+排序后的视频 ID 列表，翻页时避免重复全库遍历。"""
    key = _filter_cache_key(
        library_id,
        category=category,
        folder=folder,
        q=q,
        sort=sort,
        seed=seed,
        favorites=favorites,
        history=history,
        album_id=album_id,
        format=format,
    )
    ver = get_version(library_id)
    hit = _filter_ids_cache.get(key)
    if hit and hit[0] == ver:
        return hit[1]

    ids: list[str] | None = None
    if not favorites and not history and not album_id and not q:
        if sort == "random":
            items = _filter_videos_list(
                library_id,
                category=category,
                folder=folder,
                q=q,
                sort=sort,
                seed=seed,
                favorites=False,
                history=False,
                album_id=None,
                format=None,
            )
            ids = [v.id for v in items]
        elif category:
            ids = get_category_sorted_ids(library_id, category, sort)
            if folder is not None and folder:
                filtered: list[str] = []
                for vid in ids:
                    item = get_by_id(library_id, vid)
                    if not item:
                        continue
                    if item.subfolder == folder or item.subfolder.startswith(folder + "/"):
                        filtered.append(vid)
                ids = filtered
        else:
            sorted_ids = get_sorted_ids(library_id, sort)
            if sorted_ids is not None:
                ids = sorted_ids

    if ids is None:
        items = _filter_videos_list(
            library_id,
            category=category,
            folder=folder,
            q=q,
            sort=sort,
            seed=seed,
            favorites=favorites,
            history=history,
            album_id=album_id,
            format=None,
        )
        ids = [v.id for v in items]

    if format and format not in ("", "all"):
        fmt_items = [v for vid in ids if (v := get_by_id(library_id, vid))]
        ids = [v.id for v in filter_items_by_format(fmt_items, format, library_id)]

    _filter_ids_cache[key] = (ver, ids)

    stale = [k for k, (cached_ver, _) in _filter_ids_cache.items() if k[0] == library_id and cached_ver != ver]
    for k in stale:
        _filter_ids_cache.pop(k, None)
    return ids


def _filter_videos(
    library_id: str,
    category: str | None = None,
    folder: str | None = None,
    q: str | None = None,
    sort: str = "mtime_desc",
    seed: int | None = None,
) -> list:
    items = get_all(library_id)
    if category:
        items = [v for v in items if v.category == category]
        if folder is not None and folder:
            items = [v for v in items if v.subfolder == folder or v.subfolder.startswith(folder + "/")]
    if q:
        query = q.lower().strip()
        items = [
            v for v in items
            if query in v.title.lower()
            or query in v.filename.lower()
            or query in v.category.lower()
        ]

    if sort == "random":
        rng = random.Random(seed) if seed is not None else random
        rng.shuffle(items)
        return items

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
    index_file = _frontend_index()
    if index_file:
        return FileResponse(
            index_file,
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate",
                "Pragma": "no-cache",
            },
        )
    return {"ok": True, "service": "Loc Gallery Vue API", "health": "/api/health"}


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


def _do_rescan(library_id: str) -> None:
    refresh_cache(library_id)
    reconcile_deferred_thumbs()
    sync_index_with_videos()
    cleanup_orphans()
    _prune_user_data(library_id)
    rebuild_format_index_from_plans(library_id)
    enqueue_missing_format_probe(library_id)
    backfill_durations_from_history(library_id)
    enqueue_missing_durations(library_id)


def _schedule_rescan(library_id: str) -> None:
    """Trigger rescan in background thread so API returns immediately."""
    import threading
    threading.Thread(target=_do_rescan, args=(library_id,), daemon=True, name="bg-rescan").start()


@app.post("/api/folders/delete")
async def api_folders_delete(req: Request, library_id: str = Depends(resolve_library_id)):
    """Delete all videos in a folder (and subfolders). Files moved to recycle bin."""
    from loc_gallery.file_ops import delete_path_to_recycle_bin

    body = await req.json()
    category = (body.get("category") or "").strip()
    folder = (body.get("folder") or "").strip()
    ftype = body.get("type", "subdir")
    if not category:
        raise HTTPException(400, "需要指定分类")

    if ftype == "cat":
        # Deleting a top-level category directory
        items = _filter_videos_list(library_id, category=folder)
    else:
        items = _filter_videos_list(library_id, category=category, folder=folder)
    deleted = 0
    errors = 0
    for v in items:
        path = Path(v.path)
        if not path.is_file():
            continue
        try:
            delete_path_to_recycle_bin(library_id, path)
            deleted += 1
        except (ValueError, OSError):
            errors += 1
    if deleted:
        refresh_cache(library_id)
        _schedule_rescan(library_id)
    return {"ok": True, "deleted": deleted, "errors": errors}


@app.post("/api/folders/rename")
async def api_folders_rename(
    req: Request,
    library_id: str = Depends(resolve_library_id),
):
    """Rename a folder on disk and trigger rescan."""
    category = req.query_params.get("category", "").strip()
    old_path = req.query_params.get("old_path", "").strip()
    new_name = req.query_params.get("new_name", "").strip()
    ftype = req.query_params.get("type", "subdir")
    if not category or not old_path or not new_name:
        raise HTTPException(400, "需要 category, old_path, new_name")

    lib = get_library(library_id)
    if not lib:
        raise HTTPException(404, "视频库不存在")

    if ftype == "cat":
        # Rename top-level category directory
        old_dir = lib.path_obj / old_path
        new_dir = lib.path_obj / new_name
    else:
        cat_dir = lib.path_obj / category
        if not cat_dir.is_dir():
            raise HTTPException(404, "分类目录不存在")
        old_dir = cat_dir / old_path
        new_dir = cat_dir / new_name

    if not old_dir.is_dir():
        raise HTTPException(404, f"目录不存在: {old_path}")
    if new_dir.exists():
        raise HTTPException(409, f"目标目录已存在: {new_name}")

    shutil.move(str(old_dir), str(new_dir))
    refresh_cache(library_id)
    _schedule_rescan(library_id)
    if ftype == "cat":
        return {"ok": True, "renamed": old_path, "to": new_name}
    return {"ok": True, "renamed": True}


@app.post("/api/folders/move")
async def api_folders_move(
    req: Request,
    library_id: str = Depends(resolve_library_id),
):
    """Move a folder to a different parent directory on disk."""
    category = req.query_params.get("category", "").strip()
    src_path = req.query_params.get("src_path", "").strip()
    dest_path = req.query_params.get("dest_path", "").strip()
    ftype = req.query_params.get("type", "subdir")
    if not category or not src_path:
        raise HTTPException(400, "需要 category, src_path")

    lib = get_library(library_id)
    if not lib:
        raise HTTPException(404, "视频库不存在")

    if ftype == "cat":
        src = lib.path_obj / src_path
        dest = lib.path_obj / dest_path / src.name if dest_path else lib.path_obj / src.name
    else:
        cat_dir = lib.path_obj / category
        src = cat_dir / src_path
        dest = lib.path_obj / dest_path / src.name if dest_path else lib.path_obj / src.name

    if not src.is_dir():
        raise HTTPException(404, f"目录不存在: {src_path}")
    if dest.exists():
        raise HTTPException(409, f"目标路径已存在: {dest_path}")
    dest.parent.mkdir(parents=True, exist_ok=True)

    shutil.move(str(src), str(dest))
    refresh_cache(library_id)
    _schedule_rescan(library_id)
    return {"ok": True, "moved": True}


@app.get("/api/videos")
async def api_videos(
    category: str | None = None,
    folder: str | None = None,
    q: str | None = None,
    sort: str = "mtime_desc",
    seed: int | None = None,
    page: int = 1,
    page_size: int = 32,
    favorites: bool = False,
    history: bool = False,
    album_id: str | None = None,
    format: str | None = None,
    library_id: str = Depends(resolve_library_id),
):
    if album_id and not get_album(library_id, album_id):
        raise HTTPException(404, "专辑不存在")
    filter_category = category if not favorites and not history and not album_id else None
    filter_folder = folder if not favorites and not history and not album_id else None
    ids = _get_filtered_video_ids(
        library_id,
        category=filter_category,
        folder=filter_folder,
        q=q,
        sort=sort,
        seed=seed,
        favorites=favorites,
        history=history,
        album_id=album_id,
        format=format,
    )
    total = len(ids)

    if page_size <= 0:
        page_ids = ids
        page = 1
        total_pages = 1
        effective_size = total
    else:
        total_pages = max(1, (total + page_size - 1) // page_size)
        page = max(1, min(page, total_pages))
        start = (page - 1) * page_size
        page_ids = ids[start:start + page_size]
        effective_size = page_size

    page_items = [v for vid in page_ids if (v := get_by_id(library_id, vid))]

    album_map = get_album_map_for_videos(library_id, [v.id for v in page_items])
    page_dicts = _videos_to_dicts(library_id, page_items, album_map)
    missing_dur = [d["id"] for d in page_dicts if not d.get("durationSec")]
    if missing_dur:
        enqueue_duration_probe(library_id, missing_dur)

    return {
        "items": page_dicts,
        "total": total,
        "page": page,
        "pageSize": effective_size,
        "totalPages": total_pages,
        "view": (
            "favorites" if favorites else (
                "history" if history else ("album" if album_id else "browse")
            )
        ),
        "album_id": album_id,
        "library_id": library_id,
    }


@app.get("/api/play/badges")
async def api_play_badges(
    ids: str = "",
    library_id: str = Depends(resolve_library_id),
):
    """批量读取已缓存的格式角标（不触发分析）。"""
    id_list = [x.strip() for x in ids.split(",") if x.strip()]
    paths: dict[str, Path] = {}
    for vid in id_list[:128]:
        item = get_by_id(library_id, vid)
        if item:
            paths[vid] = Path(item.path)
    badges = get_format_badges(paths, library_id)
    return {"badges": badges}


@app.get("/api/durations")
async def api_durations(
    ids: str = "",
    library_id: str = Depends(resolve_library_id),
):
    """批量读取已缓存时长；缺失项会排队后台探测。"""
    id_list = [x.strip() for x in ids.split(",") if x.strip()][:128]
    durations = get_durations_for_ids(library_id, id_list)
    missing = [vid for vid in id_list if vid not in durations]
    if missing:
        enqueue_duration_probe(library_id, missing)
    return {"durations": durations}


@app.get("/api/duration/status")
async def api_duration_status(library_id: str = Depends(resolve_library_id)):
    """全库视频时长探测进度。"""
    return get_duration_status(library_id)


@app.post("/api/duration/scan")
async def api_duration_scan(library_id: str = Depends(resolve_library_id)):
    """触发后台补全缺失的视频时长。"""
    backfill_durations_from_history(library_id)
    queued = enqueue_missing_durations(library_id)
    return {"ok": True, "queued": queued, **get_duration_status(library_id)}


@app.get("/api/format/status")
async def api_format_status(library_id: str = Depends(resolve_library_id)):
    return get_format_status(library_id)


@app.post("/api/format/scan")
async def api_format_scan(library_id: str = Depends(resolve_library_id)):
    """触发后台格式索引补全（异步，不阻塞前台）。"""
    queued = enqueue_missing_format_probe(library_id)
    return {"ok": True, "queued": queued, **get_format_status(library_id)}


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


@app.get("/api/albums")
async def api_albums_list(library_id: str = Depends(resolve_library_id)):
    return {"items": list_albums(library_id)}


@app.post("/api/albums")
async def api_albums_create(req: AlbumCreateRequest, library_id: str = Depends(resolve_library_id)):
    try:
        album = create_album(library_id, req.name, description=req.description or "")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "album": album}


@app.get("/api/albums/{album_id}")
async def api_albums_get(album_id: str, library_id: str = Depends(resolve_library_id)):
    album = get_album(library_id, album_id)
    if not album:
        raise HTTPException(404, "专辑不存在")
    total_dur = 0.0
    for vid in album.get("video_ids") or []:
        item = get_by_id(library_id, vid)
        if not item:
            continue
        d = get_video_duration_sec(vid, mtime=item.mtime, size=item.size)
        if d:
            total_dur += d
    album["total_duration_sec"] = round(total_dur, 1)
    return album


@app.patch("/api/albums/{album_id}")
async def api_albums_update(
    album_id: str,
    req: AlbumUpdateRequest,
    library_id: str = Depends(resolve_library_id),
):
    try:
        album = update_album(
            library_id,
            album_id,
            name=req.name,
            description=req.description,
            cover_video_id=req.cover_video_id,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not album:
        raise HTTPException(404, "专辑不存在")
    return {"ok": True, "album": album}


@app.delete("/api/albums/{album_id}")
async def api_albums_delete(album_id: str, library_id: str = Depends(resolve_library_id)):
    if not delete_album(library_id, album_id):
        raise HTTPException(404, "专辑不存在")
    return {"ok": True}


@app.post("/api/albums/reorder")
async def api_albums_reorder(req: AlbumReorderRequest, library_id: str = Depends(resolve_library_id)):
    items = reorder_albums(library_id, req.order)
    return {"ok": True, "items": items}


@app.post("/api/albums/{album_id}/videos")
async def api_albums_videos_add(
    album_id: str,
    req: AlbumVideosRequest,
    library_id: str = Depends(resolve_library_id),
):
    ids = [i for i in req.ids if get_by_id(library_id, i)]
    album = album_add_videos(library_id, album_id, ids)
    if not album:
        raise HTTPException(404, "专辑不存在")
    return {"ok": True, **album}


@app.post("/api/albums/{album_id}/videos/remove")
async def api_albums_videos_remove(
    album_id: str,
    req: AlbumVideosRequest,
    library_id: str = Depends(resolve_library_id),
):
    album = album_remove_videos(library_id, album_id, req.ids)
    if not album:
        raise HTTPException(404, "专辑不存在")
    return {"ok": True, **album}


@app.post("/api/albums/{album_id}/videos/reorder")
async def api_albums_videos_reorder(
    album_id: str,
    req: AlbumVideosReorderRequest,
    library_id: str = Depends(resolve_library_id),
):
    album = album_reorder_videos(library_id, album_id, req.order)
    if not album:
        raise HTTPException(404, "专辑不存在")
    return {"ok": True, **album}


@app.post("/api/albums/{album_id}/cover")
async def api_albums_cover(
    album_id: str,
    req: AlbumCoverRequest,
    library_id: str = Depends(resolve_library_id),
):
    if not get_by_id(library_id, req.video_id):
        raise HTTPException(404, "视频不存在")
    try:
        album = album_set_cover(library_id, album_id, req.video_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not album:
        raise HTTPException(404, "专辑不存在")
    return {"ok": True, "album": album}


@app.get("/api/history/summary")
async def api_history_summary(library_id: str = Depends(resolve_library_id)):
    return {"count": get_history_count(library_id)}


@app.post("/api/history/record")
async def api_history_record(req: FavoriteToggleRequest, library_id: str = Depends(resolve_library_id)):
    if not req.id or not get_by_id(library_id, req.id):
        raise HTTPException(404, "视频不存在")
    entry = record_play(library_id, req.id)
    return {"ok": True, "id": req.id, **entry}


@app.post("/api/history/position")
async def api_history_position(req: HistoryPositionRequest, library_id: str = Depends(resolve_library_id)):
    if not req.id or not get_by_id(library_id, req.id):
        raise HTTPException(404, "视频不存在")
    if req.position_sec < 0:
        raise HTTPException(400, "position_sec 无效")
    entry = save_position(
        library_id,
        req.id,
        req.position_sec,
        duration_sec=req.duration_sec,
    )
    return {
        "ok": True,
        "id": req.id,
        "position_sec": entry.get("position_sec"),
        "duration_sec": entry.get("duration_sec"),
    }


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
    path = _thumb_file(video_id, library_id)
    if not path.is_file():
        raise HTTPException(404, "缩略图不存在")
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "public, max-age=86400",
        },
    )


@app.head("/api/stream/{video_id}")
async def api_stream_head(
    video_id: str,
    library_id: str = Depends(resolve_library_id),
):
    """HEAD 请求：返回文件大小与媒体类型，不流式传输正文（供 movi-player HttpSource 探测用）。"""
    item = get_by_id(library_id, video_id)
    if not item:
        raise HTTPException(404, "视频不存在")
    path = Path(item.path)
    if not path.is_file():
        raise HTTPException(404, "文件不存在")
    size = path.stat().st_size
    media_type, _ = mimetypes.guess_type(str(path))
    if not media_type or not media_type.startswith("video/"):
        media_type = "application/octet-stream"
    return Response(
        status_code=200,
        headers={
            "Content-Type": media_type,
            "Content-Length": str(size),
            "Accept-Ranges": "bytes",
        },
    )

@app.get("/api/stream/{video_id}")
async def api_stream(
    request: Request,
    video_id: str,
    library_id: str = Depends(resolve_library_id),
):
    item = get_by_id(library_id, video_id)
    if not item:
        raise HTTPException(404, "视频不存在")
    path = Path(item.path)
    if not path.is_file():
        raise HTTPException(404, "文件不存在")
    media_type, _ = mimetypes.guess_type(str(path))
    if not media_type or not media_type.startswith("video/"):
        media_type = "application/octet-stream"
    return await stream_file_with_disconnect(
        request,
        path,
        media_type=media_type,
    )


@app.get("/api/play/info/{video_id}")
async def api_play_info(video_id: str, library_id: str = Depends(resolve_library_id)):
    item = get_by_id(library_id, video_id)
    if not item:
        raise HTTPException(404, "视频不存在")
    plan = await _playback_plan(Path(item.path))
    remuxable, remux_reason = can_remux_from_plan(plan)
    hist = get_history_entry(library_id, video_id) or {}
    return {
        "id": video_id,
        "title": item.title,
        "path": item.path,
        "filename": item.filename,
        "remuxable": remuxable,
        "remux_reason": remux_reason,
        "playPosition": hist.get("position_sec"),
        "playDuration": hist.get("duration_sec"),
        **plan,
    }


@app.post("/api/videos/{video_id}/remux")
async def api_video_remux_start(video_id: str, library_id: str = Depends(resolve_library_id)):
    result = start_remux(library_id, video_id)
    if not result.get("ok"):
        raise HTTPException(400, result.get("error") or "无法开始修复")
    return result


@app.post("/api/remux/batch/begin")
async def api_remux_batch_begin(library_id: str = Depends(resolve_library_id)):
    begin_remux_batch(library_id)
    return {"ok": True}


@app.post("/api/remux/batch/end")
async def api_remux_batch_end(library_id: str = Depends(resolve_library_id)):
    end_remux_batch(library_id)
    return {"ok": True}


@app.get("/api/videos/{video_id}/remux")
async def api_video_remux_status(video_id: str, library_id: str = Depends(resolve_library_id)):
    return remux_status(library_id, video_id)


@app.post("/api/play/prepare/{video_id}")
async def api_play_prepare(video_id: str, library_id: str = Depends(resolve_library_id)):
    item = get_by_id(library_id, video_id)
    if not item:
        raise HTTPException(404, "视频不存在")
    plan = await _playback_plan(Path(item.path))
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


@app.post("/api/play/pause")
async def api_play_pause(library_id: str = Depends(resolve_library_id)):
    paused = hls_manager.pause_playback_slicing()
    return {"ok": True, "paused": paused}


class PlayCatchupRequest(BaseModel):
    position_sec: float = 0.0


@app.post("/api/play/resume")
async def api_play_resume(library_id: str = Depends(resolve_library_id)):
    resumed = hls_manager.resume_playback_slicing()
    return {"ok": True, "resumed": resumed}


@app.post("/api/play/catchup/{video_id}")
async def api_play_catchup(
    video_id: str,
    body: PlayCatchupRequest,
    library_id: str = Depends(resolve_library_id),
):
    item = get_by_id(library_id, video_id)
    if not item:
        raise HTTPException(404, "视频不存在")
    return hls_manager.catchup_from_position(video_id, Path(item.path), body.position_sec)


@app.get("/api/hls/{video_id}/{filename}")
async def api_hls_file(video_id: str, filename: str, library_id: str = Depends(resolve_library_id)):
    path = hls_manager.resolve_hls_file(video_id, filename)
    if not path:
        raise HTTPException(404, "HLS 文件不存在")
    media = "application/vnd.apple.mpegurl" if filename.endswith(".m3u8") else "video/mp2t"
    headers = {"Cache-Control": "no-store"}
    if filename.endswith(".m3u8"):
        try:
            body = hls_manager.normalize_playlist_m3u8(path.read_text(encoding="utf-8"))
        except OSError:
            raise HTTPException(404, "HLS 文件不存在") from None
        return Response(content=body, media_type=media, headers=headers)
    return FileResponse(path, media_type=media, headers=headers)


@app.post("/api/play/{video_id}")
async def api_play(video_id: str, library_id: str = Depends(resolve_library_id)):
    item = get_by_id(library_id, video_id)
    if not item:
        raise HTTPException(404, "视频不存在")

    settings = load_settings(library_id)
    if (settings.get("player_mode") or "").strip().lower() in ("html5", "smart"):
        plan = await _playback_plan(Path(item.path))
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
    subprocess.Popen(["explorer", folder])
    return {"ok": True, "folder": folder}


def _after_file_change(library_id: str, old_ids: list[str] | None = None) -> None:
    set_thread_library(library_id)
    if old_ids:
        remove_thumbs(old_ids)
        remove_favorites(library_id, old_ids)
        remove_history(library_id, old_ids)
        remove_video_from_all_albums(library_id, old_ids)
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
        _after_file_change(library_id, [old_id])
        # 强制同步 probe 格式，跳过稳定性检查，使筛选立即生效
        from pathlib import Path
        p = Path(item.path)
        if p.is_file():
            plan = force_probe_playback_plan(p)
            kind = classify_format_plan(plan)
            if kind is not None:
                set_format_kind(library_id, item.id, item.mtime, item.size, kind)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except (OSError, RuntimeError) as exc:
        raise HTTPException(500, str(exc)) from exc
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
    _do_rescan(library_id)
    _broadcast("progress", library_id)
    return {"version": get_version(library_id), "count": len(get_all(library_id))}


@app.get("/api/debug/thumb-path/{video_id}")
async def api_debug_thumb_path(video_id: str, library_id: str = Depends(resolve_library_id)):
    """Debug: check actual thumbnail file path and existence."""
    from loc_gallery.thumb_manager import _thumb_file, _tdir, get_thumb_version, _idx
    from loc_gallery.library_context import current_library_id
    current_lid = current_library_id()
    thumb_explicit = _thumb_file(video_id, library_id)
    thumb_implicit = _thumb_file(video_id)
    td_explicit = _tdir(library_id)
    td_implicit = _tdir()
    entry = _idx(library_id).get(video_id, {})
    return {
        "library_id_param": library_id,
        "current_library_id": current_lid,
        "match": library_id == current_lid,
        "thumb_file_explicit": str(thumb_explicit),
        "thumb_file_implicit": str(thumb_implicit),
        "tdir_explicit": str(td_explicit),
        "tdir_implicit": str(td_implicit),
        "exists_explicit": thumb_explicit.exists(),
        "exists_implicit": thumb_implicit.exists(),
        "version": get_thumb_version(video_id, library_id),
        "index_entry": {
            "status": entry.get("status"),
            "thumb_file": entry.get("thumb_file"),
        },
    }


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


@app.post("/api/thumb/batch-regenerate")
async def api_thumb_batch_regenerate(
    req: PriorityRequest,
    library_id: str = Depends(resolve_library_id),
):
    count, versions = batch_regenerate_with_candidates(req.ids, auto_select=req.auto_select)
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


@app.post("/api/thumb/{video_id}/candidates")
async def api_thumb_candidates(
    video_id: str,
    req: Request,
    library_id: str = Depends(resolve_library_id),
):
    """Generate candidate thumbnails for manual selection. Query param jitter=true for randomized positions."""
    raw = req.query_params.get("jitter", "").lower()
    jitter = raw in ("1", "true", "yes")
    try:
        cands = generate_thumb_candidates(video_id, library_id, jitter=jitter)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    version = str(time.time())
    return {"ok": True, "version": version, "candidates": cands}


@app.post("/api/thumb/{video_id}/pick")
async def api_thumb_pick(
    video_id: str,
    req: Request,
    library_id: str = Depends(resolve_library_id),
):
    """Select a candidate thumbnail (by index) as the main thumbnail."""
    body = await req.json()
    index = body.get("index")
    if index is None or not isinstance(index, int) or index < 0 or index > 11:
        raise HTTPException(400, "缺少或无效的 candidate index (0-4)")
    if not pick_thumb_candidate(video_id, index, library_id):
        raise HTTPException(404, "候选缩略图不存在")
    item = get_by_id(library_id, video_id)
    thumb = get_thumb_path(item) if item else None
    version = str(thumb.stat().st_mtime) if thumb and thumb.exists() else str(time.time())
    return {"ok": True, "version": version}


@app.get("/api/thumb/{video_id}/candidate/{index}")
async def api_thumb_candidate_image(
    video_id: str, index: int, library_id: str = Depends(resolve_library_id)
):
    """Serve a candidate thumbnail image."""
    path = get_candidate_path(video_id, index, library_id)
    if not path:
        raise HTTPException(404, "候选缩略图不存在")
    return FileResponse(path, media_type="image/jpeg")


@app.get("/api/health")
async def api_health():
    """轻量健康检查（供重启轮询，不依赖库上下文）。"""
    return {"ok": True, "boot_id": _SERVER_BOOT_ID}


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


_PLAYBACK_POLICY_KEYS = frozenset({
    "html5_modern_codecs_direct",
    "hls_large_h264",
    "hls_moov_end_h264",
    "html5_fragmented_mp4",
})


def _playback_policy_changed(payload: dict, before: dict, after: dict) -> bool:
    for key in _PLAYBACK_POLICY_KEYS:
        if key in payload and before.get(key) != after.get(key):
            return True
    return False


def _rebuild_format_indexes_after_policy_change() -> None:
    from loc_gallery.library_store import list_libraries

    for lib in list_libraries():
        rebuild_format_index_from_plans(lib.id)
        enqueue_missing_format_probe(lib.id)


@app.post("/api/settings")
async def api_save_settings(body: SettingsUpdate, library_id: str = Depends(resolve_library_id)):
    scope = body.scope or "library"
    payload = body.model_dump(exclude_none=True, exclude={"scope"})
    if scope == "global":
        current = load_settings()
        old_idle = current.get("thumb_idle_scan")
        before = dict(current)
        current.update(payload)
        saved = save_settings(current)
    else:
        current = load_settings(library_id)
        old_idle = current.get("thumb_idle_scan")
        before = dict(current)
        current.update(payload)
        saved = save_settings(current, library_id)
    if saved.get("thumb_idle_scan") and not old_idle:
        start_idle_scan_background()
    elif not saved.get("thumb_idle_scan") and old_idle:
        stop_idle_scan_background()
    if _playback_policy_changed(payload, before, saved):
        _rebuild_format_indexes_after_policy_change()
    return saved


@app.post("/api/service/restart")
async def api_service_restart():
    """重启后台服务（不打开新浏览器标签）。"""
    if not schedule_service_restart():
        return {"ok": True, "queued": False, "message": "重启已在进行中", "boot_id": _SERVER_BOOT_ID}
    return {"ok": True, "queued": True, "boot_id": _SERVER_BOOT_ID}


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


def _frontend_index() -> Path | None:
    for candidate in (
        WEB_ROOT / "frontend" / "dist" / "index.html",
        WEB_ROOT / "static" / "index.html",
    ):
        if candidate.is_file():
            return candidate
    return None


@app.get("/{spa_path:path}")
async def spa_fallback(spa_path: str):
    """Vue SPA 路由回退（生产模式）。"""
    if spa_path.startswith("api/") or spa_path.startswith("api"):
        raise HTTPException(404)
    index = _frontend_index()
    if not index:
        raise HTTPException(404, "前端未构建")
    # 静态文件直出
    if spa_path and "." in spa_path.split("/")[-1]:
        file_path = _dist_dir / spa_path
        if file_path.is_file():
            headers = {}
            cache = _static_cache_control(spa_path.replace("\\", "/"))
            if cache:
                headers["Cache-Control"] = cache
            return FileResponse(file_path, headers=headers or None)
    return FileResponse(
        index,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache",
        },
    )


def run():
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    run()
