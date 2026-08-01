# -*- coding: utf-8 -*-
"""检测未完成下载/正在写入的视频，避免过早触发自动处理。"""
from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Callable

from loc_gallery.config import (
    FILE_RECENT_MODIFY_SEC,
    FILE_STABLE_CHECK_DELAY,
    FILE_STABLE_SAMPLE_INTERVAL,
    VIDEO_EXTENSIONS,
)

_INCOMPLETE_MARKERS = (
    ".part",
    ".tmp",
    ".crdownload",
    ".download",
    ".partial",
    ".aria2",
    ".ytdl",
    ".temp",
    ".downloading",
    ".!ut",
)

_lock = threading.Lock()
_pending: set[str] = set()
_path_libraries: dict[str, str] = {}
_timers: dict[str, threading.Timer] = {}
_on_stable_callback: Callable[[Path | None], None] | None = None


def set_stable_callback(callback: Callable[[], None] | None) -> None:
    global _on_stable_callback
    _on_stable_callback = callback


def is_incomplete_filename(name: str) -> bool:
    lower = name.lower()
    return any(marker in lower for marker in _INCOMPLETE_MARKERS)


def _stat(path: Path) -> tuple[int, float] | None:
    try:
        st = path.stat()
        return st.st_size, st.st_mtime
    except OSError:
        return None


def is_file_stable(path: Path) -> bool:
    """两次采样 size/mtime 不变则视为写入完成（会短暂 sleep）。"""
    first = _stat(path)
    if not first or first[0] <= 0:
        return False
    time.sleep(FILE_STABLE_SAMPLE_INTERVAL)
    second = _stat(path)
    if not second:
        return False
    return first == second


def is_pending(path: Path) -> bool:
    return str(path.resolve()) in _pending


def is_ready_for_index(path: Path) -> bool:
    """是否可纳入视频库索引（扫描层快速判断，不阻塞）。"""
    if not path.is_file():
        return False
    if path.suffix.lower() not in VIDEO_EXTENSIONS:
        return False
    if is_incomplete_filename(path.name):
        return False
    if is_pending(path):
        return False
    snap = _stat(path)
    if snap and (time.time() - snap[1]) < FILE_RECENT_MODIFY_SEC:
        notify_file_activity(path)
        return False
    return True


def is_ready_for_processing(path: Path) -> bool:
    """处理前二次校验（缩略图 / probe），仅路径、无索引快照。"""
    return is_ready_for_index(path)


def is_ready_for_video(path: Path, *, size: int, mtime: float) -> bool:
    """结合扫描时的 size/mtime，判断文件是否仍在写入。"""
    if not is_ready_for_index(path):
        return False
    snap = _stat(path)
    if not snap:
        return False
    if snap[0] != size or snap[1] != mtime:
        notify_file_activity(path)
        return False
    return True


def clear_path_pending(path: Path) -> None:
    """修复/写入完成后清除待稳定标记，避免播放被误判为正在写入。"""
    key = str(path.resolve())
    timer = None
    with _lock:
        _pending.discard(key)
        timer = _timers.pop(key, None)
        _path_libraries.pop(key, None)
    if timer:
        timer.cancel()


def notify_file_activity(path: Path, library_id: str | None = None) -> None:
    """文件系统事件：加入待稳定队列，延迟后再触发库刷新。"""
    if is_incomplete_filename(path.name):
        return
    if path.suffix.lower() not in VIDEO_EXTENSIONS:
        return
    if not path.exists():
        return

    key = str(path.resolve())
    with _lock:
        _pending.add(key)
        if library_id:
            _path_libraries[key] = library_id
        old = _timers.pop(key, None)
        if old:
            old.cancel()
        timer = threading.Timer(FILE_STABLE_CHECK_DELAY, _run_stability_check, args=(path,))
        timer.daemon = True
        _timers[key] = timer
        timer.start()


def _invoke_stable_callback(path: Path | None, library_id: str | None) -> None:
    if not _on_stable_callback:
        return
    if library_id:
        from loc_gallery.library_context import set_thread_library

        set_thread_library(library_id)
    _on_stable_callback(path)


def _run_stability_check(path: Path) -> None:
    key = str(path.resolve())
    library_id = None
    if not path.is_file():
        with _lock:
            _pending.discard(key)
            _timers.pop(key, None)
            library_id = _path_libraries.pop(key, None)
        _invoke_stable_callback(None, library_id)
        return

    if is_file_stable(path):
        with _lock:
            _pending.discard(key)
            _timers.pop(key, None)
            library_id = _path_libraries.pop(key, None)
        _invoke_stable_callback(path, library_id)
        return

    with _lock:
        library_id = _path_libraries.get(key)
    notify_file_activity(path, library_id)
