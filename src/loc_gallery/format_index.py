# -*- coding: utf-8 -*-
"""视频格式分类索引：后台探测、磁盘持久化，前台只读。"""
from __future__ import annotations

import json
import queue
import threading
import time
from pathlib import Path

from loc_gallery.config import format_index_file
from loc_gallery.file_stability import is_ready_for_processing
from loc_gallery.library_context import set_thread_library

_INDEX_VERSION = 1
_index_lock = threading.Lock()
_indexes: dict[str, dict[str, dict]] = {}  # library_id -> video_id -> entry
_index_dirty: set[str] = set()
_index_flush_timer: threading.Timer | None = None
_INDEX_FLUSH_SEC = 2.0

_probe_queue: queue.Queue[tuple[str, str]] = queue.Queue()
_probe_pending: set[tuple[str, str]] = set()
_probe_worker: threading.Thread | None = None
_probe_stop = False
_PROBE_INTERVAL_SEC = 0.35


def _policy_tag() -> str:
    from loc_gallery.media_probe import _hls_policy_tag

    return _hls_policy_tag()


def _load_index(library_id: str) -> dict[str, dict]:
    cached = _indexes.get(library_id)
    if cached is not None:
        return cached
    path = format_index_file(library_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    data: dict[str, dict] = {}
    if path.is_file():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, dict) and raw.get("policy") == _policy_tag():
                entries = raw.get("by_id")
                if isinstance(entries, dict):
                    data = {k: v for k, v in entries.items() if isinstance(v, dict)}
        except (json.JSONDecodeError, OSError):
            pass
    _indexes[library_id] = data
    return data


def _schedule_index_flush() -> None:
    global _index_flush_timer

    def _flush() -> None:
        global _index_flush_timer
        lids = list(_index_dirty)
        for lid in lids:
            with _index_lock:
                entries = _indexes.get(lid)
                if entries is None:
                    _index_dirty.discard(lid)
                    continue
                payload = entries
            path = format_index_file(lid)
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_suffix(".tmp")
                tmp.write_text(
                    json.dumps(
                        {"v": _INDEX_VERSION, "policy": _policy_tag(), "by_id": payload},
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )
                tmp.replace(path)
                _index_dirty.discard(lid)
            except OSError:
                pass
        with _index_lock:
            _index_flush_timer = None

    with _index_lock:
        if _index_flush_timer is not None:
            _index_flush_timer.cancel()
        _index_flush_timer = threading.Timer(_INDEX_FLUSH_SEC, _flush)
        _index_flush_timer.daemon = True
        _index_flush_timer.start()


def set_format_kind(
    library_id: str,
    video_id: str,
    mtime: float,
    size: int,
    kind: str | None,
) -> None:
    with _index_lock:
        store = _load_index(library_id)
        store[video_id] = {"mtime": mtime, "size": size, "kind": kind or ""}
        _index_dirty.add(library_id)
    _schedule_index_flush()


def get_format_kind_for_item(
    library_id: str,
    video_id: str,
    mtime: float,
    size: int,
) -> str | None:
    entry = _load_index(library_id).get(video_id)
    if not entry:
        return None
    if entry.get("mtime") != mtime or entry.get("size") != size:
        return None
    kind = entry.get("kind") or ""
    return kind or None


def filter_items_by_format(items, fmt: str, library_id: str) -> list:
    if not fmt or fmt == "all":
        return items
    index = _load_index(library_id)
    out = []
    for v in items:
        entry = index.get(v.id)
        if not entry or entry.get("mtime") != v.mtime or entry.get("size") != v.size:
            continue
        kind = entry.get("kind") or None
        if not kind:
            continue
        if fmt == "non_standard":
            out.append(v)
        elif kind == fmt:
            out.append(v)
    return out


def get_format_status(library_id: str) -> dict:
    from loc_gallery.scanner import get_all

    index = _load_index(library_id)
    all_items = get_all(library_id)
    total = len(all_items)
    indexed = 0
    for v in all_items:
        entry = index.get(v.id)
        if entry and entry.get("mtime") == v.mtime and entry.get("size") == v.size:
            indexed += 1
    pending = max(0, total - indexed)
    with _index_lock:
        scanning = _probe_queue.qsize() + len(_probe_pending)
    return {
        "total": total,
        "indexed": indexed,
        "pending": pending,
        "scanning": scanning,
        "ready": pending == 0 and scanning == 0,
    }


def rebuild_format_index_from_plans(library_id: str) -> int:
    """从 playback_plans 缓存重建格式索引（不触发 ffprobe）。"""
    from loc_gallery.media_probe import _load_disk_cache, classify_format_plan
    from loc_gallery.scanner import get_all

    set_thread_library(library_id)
    store = _load_disk_cache()
    updated = 0
    with _index_lock:
        index = _load_index(library_id)
        for v in get_all(library_id):
            key = str(Path(v.path).resolve())
            entry = store.get(key)
            if not entry or not isinstance(entry, dict):
                continue
            if entry.get("mtime") != v.mtime or entry.get("size") != v.size:
                continue
            kind = entry.get("format_kind")
            if not kind:
                plan = entry.get("plan")
                if isinstance(plan, dict):
                    kind = classify_format_plan(plan) or ""
            if kind is None:
                kind = ""
            prev = index.get(v.id)
            new_entry = {"mtime": v.mtime, "size": v.size, "kind": kind}
            if prev != new_entry:
                index[v.id] = new_entry
                updated += 1
        if updated:
            _index_dirty.add(library_id)
    if updated:
        _schedule_index_flush()
    return updated


def enqueue_format_probe(library_id: str, video_ids: list[str]) -> int:
    if not video_ids:
        return 0
    added = 0
    with _index_lock:
        for vid in video_ids:
            key = (library_id, vid)
            if key in _probe_pending:
                continue
            _probe_pending.add(key)
            _probe_queue.put(key)
            added += 1
    _ensure_probe_worker()
    return added


def enqueue_missing_format_probe(library_id: str, *, limit: int = 0) -> int:
    from loc_gallery.scanner import get_all

    index = _load_index(library_id)
    missing = []
    for v in get_all(library_id):
        entry = index.get(v.id)
        if entry and entry.get("mtime") == v.mtime and entry.get("size") == v.size:
            continue
        missing.append(v.id)
        if limit and len(missing) >= limit:
            break
    return enqueue_format_probe(library_id, missing)


def _ensure_probe_worker() -> None:
    global _probe_worker
    if _probe_worker and _probe_worker.is_alive():
        return

    def _run() -> None:
        from loc_gallery.media_probe import classify_format_plan, get_playback_plan
        from loc_gallery.scanner import get_by_id

        while not _probe_stop:
            try:
                library_id, video_id = _probe_queue.get(timeout=1.5)
            except queue.Empty:
                continue
            try:
                set_thread_library(library_id)
                item = get_by_id(library_id, video_id)
                if item:
                    path = Path(item.path)
                    if is_ready_for_processing(path):
                        plan = get_playback_plan(path)
                        kind = classify_format_plan(plan)
                        set_format_kind(library_id, video_id, item.mtime, item.size, kind)
                time.sleep(_PROBE_INTERVAL_SEC)
            except Exception:
                pass
            finally:
                with _index_lock:
                    _probe_pending.discard((library_id, video_id))
                _probe_queue.task_done()

    _probe_worker = threading.Thread(target=_run, daemon=True, name="format-probe")
    _probe_worker.start()


def start_format_index_background(library_id: str) -> None:
    def _run() -> None:
        set_thread_library(library_id)
        rebuild_format_index_from_plans(library_id)
        enqueue_missing_format_probe(library_id)

    threading.Thread(
        target=_run,
        daemon=True,
        name=f"format-index-{library_id}",
    ).start()


def shutdown_format_index() -> None:
    global _probe_stop, _index_flush_timer
    _probe_stop = True
    if _index_flush_timer:
        _index_flush_timer.cancel()
    with _index_lock:
        for lid in list(_index_dirty):
            entries = _indexes.get(lid)
            if not entries:
                continue
            path = format_index_file(lid)
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(
                    json.dumps(
                        {"v": _INDEX_VERSION, "policy": _policy_tag(), "by_id": entries},
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )
            except OSError:
                pass
        _index_dirty.clear()
