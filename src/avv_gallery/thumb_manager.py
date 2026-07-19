# -*- coding: utf-8 -*-
import json
import os
import random
import shutil
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path

from avv_gallery.config import THUMB_DIR, THUMB_INDEX_FILE, THUMB_WORKERS, FILE_STABLE_CHECK_DELAY
from avv_gallery.file_stability import is_ready_for_processing, is_ready_for_video
from avv_gallery.process_util import hidden_subprocess_kwargs
from avv_gallery.scanner import VideoItem, get_all, get_by_id
from avv_gallery.settings_store import get_setting

STATUS_MISSING = "missing"
STATUS_QUEUED = "queued"
STATUS_GENERATING = "generating"
STATUS_READY = "ready"
STATUS_FAILED = "failed"

MAX_QUEUE_SIZE = 32
GENERATING_TIMEOUT = 300
FFPROBE_MAX_SIZE = 500 * 1024 * 1024


class Priority(Enum):
    HIGH = 0
    NORMAL = 1
    LOW = 2


@dataclass(order=True)
class QueueItem:
    priority: int
    added_at: float
    video_id: str


_lock = threading.RLock()
_index: dict[str, dict] = {}

_paused = False
_queue: list[QueueItem] = []
_generating: set[str] = set()
_generating_started: dict[str, float] = {}
_position_override: dict[str, float] = {}
_executor: ThreadPoolExecutor | None = None
_worker_thread: threading.Thread | None = None
_stop_worker = False
_index_dirty = False
_flush_lock = threading.Lock()
_flush_timer: threading.Timer | None = None

_progress_callbacks: list = []
_cached_status: dict = {}
_last_notify = 0.0
_idle_scan_thread: threading.Thread | None = None
_ffmpeg_bin: str | None = None
_ffprobe_bin: str | None = None
_last_capture_error: str = ""
_last_capture_seek: float | None = None


def _tool_search_dirs() -> list[Path]:
    home = Path.home()
    return [
        home / "AppData/Local/Microsoft/WinGet/Links",
        Path(r"C:\ffmpeg\bin"),
        Path(r"D:\ffmpeg\bin"),
    ]


def _resolve_tool(name: str) -> str:
    for folder in _tool_search_dirs():
        for fname in (f"{name}.exe", f"{name}.EXE"):
            candidate = folder / fname
            if candidate.exists():
                return str(candidate.resolve())
    found = shutil.which(name)
    if found:
        p = Path(found).resolve()
        if p.suffix.lower() in (".bat", ".cmd"):
            raise FileNotFoundError(f"找到的是脚本 {p}，请安装 {name}.exe")
        return str(p)
    raise FileNotFoundError(
        f"未找到 {name}。请安装 ffmpeg 并加入 PATH，或放到 C:\\ffmpeg\\bin"
    )


def ffmpeg_path() -> str:
    global _ffmpeg_bin
    if not _ffmpeg_bin:
        _ffmpeg_bin = _resolve_tool("ffmpeg")
    return _ffmpeg_bin


def ffprobe_path() -> str:
    global _ffprobe_bin
    if not _ffprobe_bin:
        _ffprobe_bin = _resolve_tool("ffprobe")
    return _ffprobe_bin


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _thumb_file(video_id: str) -> Path:
    return THUMB_DIR / f"{video_id}.jpg"


def _purge_thumb_files(video_id: str) -> None:
    """删除该视频所有缩略图文件（含历史残留）。"""
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    for p in THUMB_DIR.glob(f"{video_id}*.jpg"):
        try:
            p.unlink(missing_ok=True)
        except OSError:
            pass


def _load_index() -> None:
    global _index
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    if THUMB_INDEX_FILE.exists():
        try:
            text = THUMB_INDEX_FILE.read_text(encoding="utf-8").strip()
            _index = json.loads(text) if text else {}
        except (json.JSONDecodeError, OSError):
            backup = THUMB_INDEX_FILE.with_suffix(".json.bak")
            if THUMB_INDEX_FILE.exists():
                THUMB_INDEX_FILE.rename(backup)
            _index = {}
    else:
        _index = {}


def _flush_index_sync() -> None:
    """同步写入索引（仅在启动/关闭时调用）。"""
    global _index_dirty
    if not _index_dirty:
        return
    with _flush_lock:
        if not _index_dirty:
            return
        data = json.dumps(_index, ensure_ascii=False, indent=2)
        tmp = THUMB_INDEX_FILE.with_suffix(".json.tmp")
        for attempt in range(8):
            try:
                tmp.write_text(data, encoding="utf-8")
                tmp.replace(THUMB_INDEX_FILE)
                _index_dirty = False
                return
            except (PermissionError, OSError):
                time.sleep(0.15 * (attempt + 1))
        try:
            THUMB_INDEX_FILE.write_text(data, encoding="utf-8")
            _index_dirty = False
        except OSError:
            pass


def _schedule_flush() -> None:
    """延迟批量写入，避免多线程争用 index.json。"""
    global _flush_timer
    with _flush_lock:
        if _flush_timer and _flush_timer.is_alive():
            return
        _flush_timer = threading.Timer(1.0, _flush_index_sync)
        _flush_timer.daemon = True
        _flush_timer.start()


def _flush_index() -> None:
    _schedule_flush()


def _mark_dirty() -> None:
    global _index_dirty
    _index_dirty = True


def _recover_stale_states() -> None:
    """重启后清理无效状态；失败项保留，避免无限自动重试。"""
    with _lock:
        changed = False
        for entry in _index.values():
            st = entry.get("status")
            if st in (STATUS_QUEUED, STATUS_GENERATING):
                entry["status"] = STATUS_MISSING
                entry["error"] = None
                changed = True
        if changed:
            _mark_dirty()
    _flush_index_sync()


def _has_usable_thumb(video_id: str) -> bool:
    """磁盘上已有可用缩略图（不受队列状态影响）。"""
    if not _thumb_file(video_id).exists():
        return False
    with _lock:
        entry = _index.get(video_id)
        return bool(entry and entry.get("status") == STATUS_READY)


def _prune_ready_from_queue() -> int:
    """从队列移除已有缩略图的任务，避免重复生成并影响展示状态。"""
    removed = 0
    with _lock:
        before = len(_queue)
        _queue[:] = [q for q in _queue if not _has_usable_thumb(q.video_id)]
        removed = before - len(_queue)
    if removed:
        _notify_progress()
    return removed


def _is_failed(video_id: str) -> bool:
    with _lock:
        entry = _index.get(video_id)
        return bool(entry and entry.get("status") == STATUS_FAILED)


def _should_schedule_auto(video_id: str) -> bool:
    """自动队列：跳过已有缩略图、已失败项、以及仍在写入的文件。"""
    if _has_usable_thumb(video_id) or _is_failed(video_id):
        return False
    item = get_by_id(video_id)
    if not item:
        return False
    return _video_is_processable(item)


def _friendly_thumb_error(err: str | None) -> str:
    if not err:
        return "未知错误"
    low = err.lower()
    if "error number -129" in low or "reserved trc:reserved" in low:
        return "AV1 视频色彩元数据异常导致截图失败（请重试生成）"
    if "mjpeg" in low and "invalid argument" in low:
        return "视频截图编码失败（请重试生成）"
    return err.strip()[-200:]


def _video_is_processable(item: VideoItem) -> bool:
    return is_ready_for_video(Path(item.path), size=item.size, mtime=item.mtime)


def reconcile_deferred_thumbs() -> int:
    """下载/写入中的视频若被标为失败，改回等待状态，不计入失败列表。"""
    changed = 0
    with _lock:
        for vid, entry in list(_index.items()):
            item = get_by_id(vid)
            if item and _video_is_processable(item):
                continue
            st = entry.get("status")
            if st in (STATUS_FAILED, STATUS_GENERATING, STATUS_QUEUED):
                entry["status"] = STATUS_MISSING
                entry["error"] = None
                changed += 1
            elif st == STATUS_READY and item and not _has_usable_thumb(vid):
                entry["status"] = STATUS_MISSING
                entry["thumb_file"] = None
                changed += 1
        for vid in list(_generating):
            item = get_by_id(vid)
            if not item or not _video_is_processable(item):
                _generating.discard(vid)
                _generating_started.pop(vid, None)
                changed += 1
        before_q = len(_queue)
        _queue[:] = [
            q for q in _queue
            if (item := get_by_id(q.video_id)) and _video_is_processable(item)
        ]
        if len(_queue) != before_q:
            changed += 1
    if changed:
        _mark_dirty()
        _rebuild_status_cache()
        _notify_progress()
    return changed


def get_failed_items() -> list[dict]:
    reconcile_deferred_thumbs()
    with _lock:
        failed_ids = [vid for vid, e in _index.items() if e.get("status") == STATUS_FAILED]
    result = []
    for vid in failed_ids:
        item = get_by_id(vid)
        if not item or not _video_is_processable(item):
            continue
        with _lock:
            err = _index.get(vid, {}).get("error")
        result.append({
            "id": vid,
            "title": item.title,
            "filename": item.filename,
            "path": item.path,
            "category": item.category,
            "subfolder": item.subfolder,
            "error": _friendly_thumb_error(err),
        })
    result.sort(key=lambda x: (x["category"], x["filename"]))
    return result


def _is_busy(video_id: str) -> bool:
    with _lock:
        if video_id in _generating:
            return True
        return any(q.video_id == video_id for q in _queue)


def init_manager() -> None:
    global _executor, _worker_thread, _stop_worker
    _stop_worker = False
    try:
        ffmpeg_path()
        ffprobe_path()
    except FileNotFoundError as exc:
        print(f"[thumb] 警告: {exc}")
    _load_index()
    _recover_stale_states()
    with _lock:
        _queue.clear()
        _generating.clear()
        _generating_started.clear()
    workers = int(get_setting("thumb_workers") or THUMB_WORKERS)
    _executor = ThreadPoolExecutor(max_workers=workers)
    _worker_thread = threading.Thread(target=_worker_loop, daemon=True, name="thumb-worker")
    _worker_thread.start()
    sync_index_with_videos()
    _flush_index_sync()
    _prune_ready_from_queue()
    reconcile_deferred_thumbs()
    if get_setting("thumb_idle_scan"):
        start_idle_scan_background()


def shutdown_manager() -> None:
    global _stop_worker, _flush_timer
    _stop_worker = True
    if _flush_timer:
        _flush_timer.cancel()
    _flush_index_sync()
    if _executor:
        _executor.shutdown(wait=False, cancel_futures=True)


def _file_matches(item: VideoItem) -> bool:
    thumb = _thumb_file(item.id)
    if not thumb.exists():
        return False
    with _lock:
        entry = _index.get(item.id)
    if not entry:
        return False
    return entry.get("mtime") == item.mtime and entry.get("size") == item.size


def sync_index_with_videos() -> list[str]:
    """同步缩略图索引，返回新增或源文件已变更的视频 id。"""
    videos = {v.id: v for v in get_all()}
    changed_ids: list[str] = []
    with _lock:
        for vid, item in videos.items():
            entry = _index.get(vid)
            if _file_matches(item):
                _index[vid] = {
                    "video_id": vid,
                    "path": item.path,
                    "mtime": item.mtime,
                    "size": item.size,
                    "thumb_file": _thumb_file(vid).name,
                    "status": STATUS_READY,
                    "generated_at": entry.get("generated_at") if entry else _now_iso(),
                    "error": None,
                }
            elif entry is None:
                changed_ids.append(vid)
                _index[vid] = {
                    "video_id": vid,
                    "path": item.path,
                    "mtime": item.mtime,
                    "size": item.size,
                    "thumb_file": None,
                    "status": STATUS_MISSING,
                    "generated_at": None,
                    "error": None,
                }
            else:
                entry["path"] = item.path
                if entry.get("mtime") != item.mtime or entry.get("size") != item.size:
                    changed_ids.append(vid)
                    entry["mtime"] = item.mtime
                    entry["size"] = item.size
                    entry["status"] = STATUS_MISSING
                    entry["thumb_file"] = None
                elif entry.get("status") == STATUS_READY and not _thumb_file(vid).exists():
                    changed_ids.append(vid)
                    entry["status"] = STATUS_MISSING
                    entry["thumb_file"] = None

        for vid in [v for v in _index if v not in videos]:
            del _index[vid]

        _mark_dirty()
    _schedule_flush()
    _rebuild_status_cache()
    return changed_ids


def _rebuild_status_cache() -> None:
    global _cached_status
    items = get_all()
    counts = {
        "total": len(items), "ready": 0, "missing": 0,
        "queued": 0, "generating": 0, "failed": 0,
        "paused": _paused, "queue_size": 0, "percent": 0,
        "idle_scan": bool(get_setting("thumb_idle_scan")),
    }

    with _lock:
        counts["queue_size"] = len(_queue)
        counts["generating"] = len(_generating)
        queued_ids = {q.video_id for q in _queue}
        generating_ids = set(_generating)

        for item in items:
            vid = item.id
            if _has_usable_thumb(vid):
                counts["ready"] += 1
                continue
            if vid in generating_ids:
                counts["generating"] += 1
                continue
            if vid in queued_ids:
                counts["queued"] += 1
                continue
            entry = _index.get(vid, {})
            st = entry.get("status", STATUS_MISSING)
            if st == STATUS_FAILED and _video_is_processable(item):
                counts["failed"] += 1
            else:
                counts["missing"] += 1

    counts["percent"] = round(counts["ready"] / counts["total"] * 100, 1) if counts["total"] else 100
    _cached_status = counts


def get_worker_health() -> dict:
    with _lock:
        return {
            "worker_alive": bool(_worker_thread and _worker_thread.is_alive()),
            "stop_worker": _stop_worker,
            "paused": _paused,
            "queue_len": len(_queue),
            "generating_len": len(_generating),
            "executor": _executor is not None,
        }


def get_status(category: str | None = None, page_ids: list[str] | None = None) -> dict:
    if page_ids:
        counts = {
            "scope": "page",
            "total": len(page_ids), "ready": 0, "missing": 0,
            "queued": 0, "generating": 0, "failed": 0,
            "paused": _paused, "queue_size": len(_queue), "percent": 0,
            "idle_scan": bool(get_setting("thumb_idle_scan")),
        }
        with _lock:
            queued_ids = {q.video_id for q in _queue}
            generating_ids = set(_generating)
        for vid in page_ids:
            if _has_usable_thumb(vid):
                counts["ready"] += 1
            elif vid in generating_ids:
                counts["generating"] += 1
            elif vid in queued_ids:
                counts["queued"] += 1
            else:
                with _lock:
                    st = _index.get(vid, {}).get("status", STATUS_MISSING)
                item = get_by_id(vid)
                if st == STATUS_FAILED and item and _video_is_processable(item):
                    counts["failed"] += 1
                else:
                    counts["missing"] += 1
        counts["percent"] = round(counts["ready"] / counts["total"] * 100, 1) if counts["total"] else 100
        return counts

    if not category:
        _rebuild_status_cache()
        out = dict(_cached_status)
        out["idle_scan"] = bool(get_setting("thumb_idle_scan"))
        out["paused"] = _paused
        with _lock:
            out["queue_size"] = len(_queue)
            out["generating"] = len(_generating)
        return out

    items = [v for v in get_all() if v.category == category]
    counts = {
        "scope": "category",
        "total": len(items), "ready": 0, "missing": 0,
        "queued": 0, "generating": 0, "failed": 0,
        "paused": _paused, "queue_size": len(_queue), "percent": 0,
        "idle_scan": bool(get_setting("thumb_idle_scan")),
    }
    with _lock:
        queued_ids = {q.video_id for q in _queue}
        generating_ids = set(_generating)
    for item in items:
        vid = item.id
        if _has_usable_thumb(vid):
            counts["ready"] += 1
        elif vid in generating_ids:
            counts["generating"] += 1
        elif vid in queued_ids:
            counts["queued"] += 1
        else:
            with _lock:
                st = _index.get(vid, {}).get("status", STATUS_MISSING)
            if st == STATUS_FAILED:
                counts["failed"] += 1
            else:
                counts["missing"] += 1
    counts["percent"] = round(counts["ready"] / counts["total"] * 100, 1) if counts["total"] else 100
    return counts


def get_video_thumb_status_fast(video_id: str) -> str:
    if _has_usable_thumb(video_id):
        return STATUS_READY
    item = get_by_id(video_id)
    if item and not _video_is_processable(item):
        return STATUS_MISSING
    with _lock:
        if video_id in _generating:
            return STATUS_GENERATING
        if any(q.video_id == video_id for q in _queue):
            return STATUS_QUEUED
        entry = _index.get(video_id)
        if entry:
            return entry.get("status", STATUS_MISSING)
    return STATUS_MISSING


def get_video_thumb_status(video_id: str) -> str:
    return get_video_thumb_status_fast(video_id)


def get_thumb_version(video_id: str) -> str | None:
    with _lock:
        entry = _index.get(video_id)
        if entry and entry.get("status") == STATUS_READY:
            generated = entry.get("generated_at")
            seek = entry.get("thumb_seek")
            if generated and seek is not None:
                return f"{generated}@{seek}"
            return generated
    return None


def get_video_thumb_error(video_id: str) -> str | None:
    with _lock:
        entry = _index.get(video_id)
        if entry and entry.get("status") == STATUS_FAILED:
            return entry.get("error")
    return None


def is_thumb_ready(video_id: str) -> bool:
    return _has_usable_thumb(video_id)


def get_thumb_path(item: VideoItem) -> Path | None:
    if not is_thumb_ready(item.id):
        return None
    p = _thumb_file(item.id)
    return p if p.exists() else None


def _notify_progress() -> None:
    global _last_notify
    now = time.time()
    if now - _last_notify < 1.0:
        return
    _last_notify = now
    _rebuild_status_cache()
    for cb in _progress_callbacks:
        try:
            cb()
        except Exception:
            pass


def register_progress_callback(cb) -> None:
    _progress_callbacks.append(cb)


def pause_queue() -> None:
    global _paused
    _paused = True


def resume_queue() -> None:
    global _paused
    _paused = False


def is_paused() -> bool:
    return _paused


def _enqueue(video_id: str, priority: Priority = Priority.NORMAL) -> None:
    if _has_usable_thumb(video_id):
        return
    with _lock:
        if len(_queue) >= MAX_QUEUE_SIZE and priority != Priority.HIGH:
            return
        if video_id in _generating:
            return
        _queue[:] = [q for q in _queue if q.video_id != video_id]
        _queue.append(QueueItem(priority=priority.value, added_at=time.time(), video_id=video_id))
        _queue.sort()
        entry = _index.setdefault(video_id, {"video_id": video_id})
        if entry.get("status") not in (STATUS_GENERATING, STATUS_READY):
            entry["status"] = STATUS_QUEUED
            _mark_dirty()
    _schedule_flush()


def schedule_ids(video_ids: list[str], priority: Priority = Priority.NORMAL) -> int:
    _prune_ready_from_queue()
    if priority == Priority.HIGH:
        with _lock:
            keep = set(video_ids)
            _queue[:] = [
                q for q in _queue
                if q.video_id in keep or q.priority == Priority.HIGH.value
            ]
    count = 0
    for vid in video_ids:
        if not _should_schedule_auto(vid):
            continue
        _enqueue(vid, priority)
        count += 1
    if count:
        _notify_progress()
    return count


def schedule_category(category: str, priority: Priority = Priority.NORMAL) -> int:
    ids = [v.id for v in get_all() if v.category == category and not is_thumb_ready(v.id)]
    return schedule_ids(ids, priority)


def schedule_all_missing(priority: Priority = Priority.LOW) -> int:
    if not get_setting("thumb_idle_scan"):
        return 0
    ids = [v.id for v in get_all() if not is_thumb_ready(v.id)]
    with _lock:
        room = max(0, MAX_QUEUE_SIZE - len(_queue))
    if room == 0:
        return 0
    return schedule_ids(ids[:room], priority)


def _random_thumb_position() -> float:
    lo = float(get_setting("thumb_random_min") or 0.5)
    hi = float(get_setting("thumb_random_max") or 0.8)
    lo = max(0.05, min(0.95, lo))
    hi = max(0.05, min(0.95, hi))
    if lo > hi:
        lo, hi = hi, lo
    if abs(hi - lo) < 1e-6:
        return lo
    return lo + random.random() * (hi - lo)


def regenerate_ids(
    video_ids: list[str],
    priority: Priority = Priority.HIGH,
    position: float | None = None,
    random_position: bool = False,
) -> tuple[int, dict[str, str], dict[str, float]]:
    count = 0
    versions: dict[str, str] = {}
    positions: dict[str, float] = {}
    for vid in video_ids:
        item = get_by_id(vid)
        if not item:
            continue
        _purge_thumb_files(vid)
        bust = str(time.time())
        versions[vid] = bust
        with _lock:
            if vid in _generating:
                _generating.discard(vid)
            _generating_started.pop(vid, None)
            _queue[:] = [q for q in _queue if q.video_id != vid]
            if random_position:
                pos = _random_thumb_position()
                positions[vid] = round(pos, 4)
                _position_override[vid] = pos
            elif position is not None:
                pos = max(0.05, min(0.95, float(position)))
                positions[vid] = round(pos, 4)
                _position_override[vid] = pos
            else:
                _position_override.pop(vid, None)
        _set_entry(vid, status=STATUS_MISSING, thumb_file=None, error=None, generated_at=None)
        _enqueue(vid, priority)
        count += 1
    if count:
        _flush_index_sync()
        _notify_progress()
    return count, versions, positions


def _set_entry(video_id: str, **fields) -> None:
    with _lock:
        entry = _index.setdefault(video_id, {"video_id": video_id})
        entry.update(fields)
        _mark_dirty()
    _schedule_flush()


def regenerate_category(category: str) -> tuple[int, dict[str, str]]:
    ids = [v.id for v in get_all() if v.category == category]
    return regenerate_ids(ids)


def regenerate_failed() -> tuple[int, dict[str, str], dict[str, float]]:
    with _lock:
        failed_ids = [vid for vid, e in _index.items() if e.get("status") == STATUS_FAILED]
    return regenerate_ids(failed_ids)


def remove_thumbs(video_ids: list[str]) -> None:
    with _lock:
        for vid in video_ids:
            _index.pop(vid, None)
            thumb = _thumb_file(vid)
            if thumb.exists():
                thumb.unlink(missing_ok=True)
        _mark_dirty()
    _schedule_flush()


def cleanup_orphans() -> int:
    videos = {v.id for v in get_all()}
    removed = 0
    with _lock:
        for vid in [v for v in _index if v not in videos]:
            del _index[vid]
            thumb = _thumb_file(vid)
            if thumb.exists():
                thumb.unlink(missing_ok=True)
                removed += 1
        _mark_dirty()
    _schedule_flush()
    return removed


def _has_png_header(video_path: str) -> bool:
    try:
        with open(video_path, "rb") as f:
            return f.read(8) == b"\x89PNG\r\n\x1a\n"
    except OSError:
        return False


def _get_duration_mpegts(video_path: str) -> float | None:
    try:
        result = subprocess.run(
            [
                ffprobe_path(), "-v", "error", "-f", "mpegts",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path,
            ],
            capture_output=True, text=True, timeout=30,
            **hidden_subprocess_kwargs(),
        )
        if result.returncode == 0 and result.stdout.strip():
            return float(result.stdout.strip())
    except Exception:
        pass
    return None


def _estimate_duration_from_size(file_size: int) -> float:
    """大文件无法探测时长时，按约 4Mbps 估算（只求大致比例）。"""
    if file_size <= 0:
        return 3600.0
    return max(180.0, file_size * 8 / 4_000_000)


def _get_duration(video_path: str, file_size: int = 0) -> float | None:
    attempts = [
        (["-probesize", "32M", "-analyzeduration", "10M"], 20),
        ([], 60 if file_size > FFPROBE_MAX_SIZE else 15),
    ]
    for extra, timeout in attempts:
        try:
            result = subprocess.run(
                [
                    ffprobe_path(), "-v", "error", *extra,
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    video_path,
                ],
                capture_output=True, text=True, timeout=timeout,
                **hidden_subprocess_kwargs(),
            )
            if result.returncode == 0 and result.stdout.strip():
                return float(result.stdout.strip())
        except Exception:
            pass
    return None


def _recover_stuck_tasks() -> None:
    """释放长时间卡在 generating 的 worker 槽位。"""
    now = time.time()
    stuck: list[str] = []
    with _lock:
        for vid in list(_generating):
            started = _generating_started.get(vid, now)
            if now - started > GENERATING_TIMEOUT:
                stuck.append(vid)
    for vid in stuck:
        if _has_usable_thumb(vid):
            with _lock:
                _generating.discard(vid)
                _generating_started.pop(vid, None)
            continue
        with _lock:
            _generating.discard(vid)
            _generating_started.pop(vid, None)
        _set_entry(vid, status=STATUS_MISSING, error="生成超时，已重新排队")
        _enqueue(vid, Priority.HIGH)
    if stuck:
        _notify_progress()


def _try_capture_thumb(item: VideoItem, seek: float, output: Path, use_mpegts: bool) -> bool:
    global _last_capture_error, _last_capture_seek
    wip = output.parent / f"{output.stem}_wip.jpg"
    wip.unlink(missing_ok=True)
    cmd = [ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y"]
    if use_mpegts:
        cmd += ["-f", "mpegts", "-ss", f"{seek:.2f}", "-i", item.path]
    else:
        cmd += ["-ss", f"{seek:.2f}", "-i", item.path]
    cmd += [
        "-frames:v", "1",
        "-q:v", "3",
        "-vf", "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709,scale=320:-1",
        str(wip),
    ]
    timeout = 90 if seek <= 180 else (150 if item.size > FFPROBE_MAX_SIZE else 90)
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=timeout,
            **hidden_subprocess_kwargs(),
        )
        if result.returncode != 0 or not wip.exists() or wip.stat().st_size <= 0:
            wip.unlink(missing_ok=True)
            err = (result.stderr or b"").decode("utf-8", errors="replace").strip()
            _last_capture_error = err[-240:] if err else f"ffmpeg 退出码 {result.returncode}"
            return False
        if output.exists():
            output.unlink(missing_ok=True)
        wip.replace(output)
        _last_capture_error = ""
        _last_capture_seek = seek
        return True
    except subprocess.TimeoutExpired:
        wip.unlink(missing_ok=True)
        _last_capture_error = f"ffmpeg 超时 ({timeout}s)，位置 {seek:.0f}s"
        return False
    except Exception as exc:
        wip.unlink(missing_ok=True)
        _last_capture_error = str(exc)
        return False


def _generate_thumb_file(
    item: VideoItem,
    position: float | None = None,
    *,
    explicit_position: bool = False,
) -> bool:
    global _last_capture_error, _last_capture_seek
    _last_capture_error = ""
    _last_capture_seek = None
    if position is None:
        position = float(get_setting("thumb_position") or 0.6)
    else:
        position = max(0.05, min(0.95, float(position)))
    output = _thumb_file(item.id)
    THUMB_DIR.mkdir(parents=True, exist_ok=True)

    modes = [True] if _has_png_header(item.path) else [False]

    for use_mpegts in modes:
        duration = None
        if explicit_position:
            duration = (
                _get_duration_mpegts(item.path)
                if use_mpegts
                else _get_duration(item.path, item.size)
            )
            if not duration or duration <= 3:
                duration = _estimate_duration_from_size(item.size)
            target = duration * position
            for seek in (
                target,
                duration * max(0.05, position - 0.1),
                duration * min(0.95, position + 0.1),
                min(180.0, duration * 0.15),
                60.0,
            ):
                if seek <= 1:
                    continue
                if _try_capture_thumb(item, seek, output, use_mpegts):
                    return True
            continue

        # 普通队列：先快速定点，再按比例
        for seek in (60.0, 30.0, 10.0):
            if _try_capture_thumb(item, seek, output, use_mpegts):
                return True

        duration = (
            _get_duration_mpegts(item.path)
            if use_mpegts
            else _get_duration(item.path, item.size)
        )
        if not duration or duration <= 3:
            duration = _estimate_duration_from_size(item.size)

        target = duration * position
        for seek in (target, duration * max(0.1, position - 0.1), min(180.0, duration * 0.15)):
            if seek <= 3:
                continue
            if _try_capture_thumb(item, seek, output, use_mpegts):
                return True
    return False


def _process_one(video_id: str) -> None:
    item = get_by_id(video_id)
    if not item:
        return

    if not _video_is_processable(item):
        with _lock:
            entry = _index.get(video_id)
            if entry and entry.get("status") == STATUS_FAILED:
                entry["status"] = STATUS_MISSING
                entry["error"] = None
                _mark_dirty()
        threading.Timer(
            FILE_STABLE_CHECK_DELAY,
            lambda: _enqueue(video_id, Priority.LOW),
        ).start()
        return

    with _lock:
        has_override = video_id in _position_override
    if not has_override and _has_usable_thumb(video_id):
        return

    with _lock:
        _generating.add(video_id)
        _generating_started[video_id] = time.time()
        pos = _position_override.pop(video_id, None)
    explicit = pos is not None
    _set_entry(video_id, status=STATUS_GENERATING, error=None)

    try:
        ok = _generate_thumb_file(item, position=pos, explicit_position=explicit)
        if ok:
            seek_val = round(_last_capture_seek, 1) if _last_capture_seek is not None else None
            _set_entry(
                video_id,
                path=item.path,
                mtime=item.mtime,
                size=item.size,
                thumb_file=_thumb_file(video_id).name,
                status=STATUS_READY,
                generated_at=_now_iso(),
                thumb_seek=seek_val,
                error=None,
            )
        else:
            err = _last_capture_error or "ffmpeg 生成失败"
            _set_entry(video_id, status=STATUS_FAILED, error=err)
    except Exception as exc:
        _set_entry(video_id, status=STATUS_FAILED, error=str(exc))
    finally:
        with _lock:
            _generating.discard(video_id)
            _generating_started.pop(video_id, None)
        _notify_progress()


def _worker_loop() -> None:
    last_stuck_check = 0.0
    while not _stop_worker:
        try:
            now = time.time()
            if now - last_stuck_check > 15:
                _recover_stuck_tasks()
                last_stuck_check = now

            if _paused:
                time.sleep(0.5)
                continue

            task_id = None
            max_workers = int(get_setting("thumb_workers") or THUMB_WORKERS)
            with _lock:
                if _queue and len(_generating) < max_workers:
                    task_id = _queue.pop(0).video_id

            if task_id and _executor:
                _executor.submit(_process_one, task_id)
            else:
                time.sleep(0.2)
        except Exception:
            time.sleep(1)


def ensure_scheduled(video_id: str, priority: Priority = Priority.HIGH) -> None:
    if is_thumb_ready(video_id) or _is_busy(video_id):
        return
    _enqueue(video_id, priority)
    _notify_progress()


def start_idle_scan_background() -> None:
    """仅当用户开启空闲扫描时，后台持续补全未生成的缩略图。"""
    global _idle_scan_thread
    if _idle_scan_thread and _idle_scan_thread.is_alive():
        return

    def _run():
        time.sleep(2)
        while not _stop_worker:
            if _paused or not get_setting("thumb_idle_scan"):
                time.sleep(2)
                continue
            _prune_ready_from_queue()
            with _lock:
                room = max(0, MAX_QUEUE_SIZE - len(_queue) - len(_generating))
            if room > 0:
                with _lock:
                    busy = set(_generating) | {q.video_id for q in _queue}
                ids = [
                    v.id for v in get_all()
                    if v.id not in busy and _should_schedule_auto(v.id)
                ][:room]
                if ids:
                    schedule_ids(ids, Priority.LOW)
            time.sleep(0.5)

    _idle_scan_thread = threading.Thread(target=_run, daemon=True, name="idle-scan")
    _idle_scan_thread.start()


def stop_idle_scan_background() -> None:
    """关闭空闲扫描并清理低优先级队列。"""
    with _lock:
        _queue[:] = [q for q in _queue if q.priority == Priority.HIGH.value]
    _notify_progress()
