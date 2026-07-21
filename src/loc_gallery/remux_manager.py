# -*- coding: utf-8 -*-
"""视频重封装：碎片化 MP4 → 标准 MP4（改名 .bak 后原地写出，保留时间戳）。"""
from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from loc_gallery.file_ops import delete_backup_file
from loc_gallery.file_stability import clear_path_pending
from loc_gallery.library_context import set_thread_library
from loc_gallery.media_probe import can_remux_from_plan, get_playback_plan, seed_direct_playback_plan
from loc_gallery.process_util import FileTimestamps, capture_file_timestamps, restore_file_timestamps
from loc_gallery.remux_core import remux_to_file
from loc_gallery.scanner import get_by_id, refresh_video_item_stat

_lock = threading.RLock()
_jobs: dict[str, "RemuxJob"] = {}
_suppress_lock = threading.Lock()
_suppressed_paths: set[str] = set()


def _remux_path_keys(path: Path) -> set[str]:
    resolved = path.resolve()
    keys = {str(resolved)}
    name = resolved.name.lower()
    if name.endswith(".mp4.bak") or name.endswith(".m4v.bak"):
        keys.add(str(resolved.with_name(resolved.name[:-4])))
    elif resolved.suffix.lower() in {".mp4", ".m4v"}:
        keys.add(str(resolved.with_suffix(resolved.suffix + ".bak")))
    return keys


def suppress_remux_paths(*paths: Path) -> None:
    keys: set[str] = set()
    for path in paths:
        keys.update(_remux_path_keys(path))
    with _suppress_lock:
        _suppressed_paths.update(keys)


def unsuppress_remux_paths(*paths: Path) -> None:
    keys: set[str] = set()
    for path in paths:
        keys.update(_remux_path_keys(path))
    with _suppress_lock:
        _suppressed_paths.difference_update(keys)


def is_remux_path_suppressed(path: Path) -> bool:
    keys = _remux_path_keys(path)
    with _suppress_lock:
        return bool(keys & _suppressed_paths)


@dataclass
class RemuxJob:
    video_id: str
    library_id: str
    source: Path
    state: str = "queued"  # queued | running | done | error
    progress_pct: float = 0.0
    message: str = ""
    error: str | None = None
    backup_name: str | None = None
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None


def _job_key(library_id: str, video_id: str) -> str:
    return f"{library_id}:{video_id}"


def _job_to_dict(job: RemuxJob, video_id: str) -> dict:
    return {
        "video_id": video_id,
        "state": job.state,
        "progress_pct": round(job.progress_pct, 1),
        "message": job.message,
        "error": job.error,
        "backup_name": job.backup_name,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }


def _backup_path(source: Path) -> Path:
    return source.with_suffix(source.suffix + ".bak")


def _legacy_temp_path(source: Path, video_id: str) -> Path:
    return source.parent / f".locgallery-remux-{video_id[:8]}.tmp.mp4"


def _rollback_from_backup(backup: Path, source: Path) -> None:
    if source.is_file():
        source.unlink()
    if backup.is_file():
        os.rename(backup, source)


def can_remux_path(path: Path) -> tuple[bool, str]:
    if path.suffix.lower() not in {".mp4", ".m4v"}:
        return False, "仅支持 MP4 文件重封装"
    plan = get_playback_plan(path)
    return can_remux_from_plan(plan)


def can_remux_video(library_id: str, video_id: str) -> tuple[bool, str]:
    item = get_by_id(library_id, video_id)
    if not item:
        return False, "视频不存在"
    return can_remux_path(Path(item.path))


def _set_job(job: RemuxJob, **kwargs) -> None:
    with _lock:
        for k, v in kwargs.items():
            setattr(job, k, v)


def _release_playback_locks(video_id: str) -> None:
    try:
        from loc_gallery import hls_manager

        hls_manager.stop_playback(force=True)
        hls_manager.purge_cache(video_id)
    except Exception:
        pass


def _notify_library_sse(library_id: str) -> None:
    try:
        from loc_gallery.server import notify_library_sse

        notify_library_sse(library_id)
    except Exception:
        pass


def _delete_backup_async(library_id: str, backup: Path, source: Path) -> None:
    set_thread_library(library_id)
    try:
        delete_backup_file(library_id, backup, recycle=False)
    finally:
        unsuppress_remux_paths(source, backup)


def _finish_remuxed_file(
    job: RemuxJob,
    source: Path,
    timestamps: FileTimestamps,
) -> None:
    """快速收尾：恢复时间戳并写入 direct 播放计划（无 ffprobe）。"""
    restore_file_timestamps(source, timestamps)
    refresh_video_item_stat(job.library_id, job.video_id)
    clear_path_pending(source)
    seed_direct_playback_plan(source)


def _remux_and_finalize(
    job: RemuxJob,
    backup: Path,
    source: Path,
    timestamps: FileTimestamps,
) -> None:
    def on_progress(pct: float, msg: str) -> None:
        _set_job(job, progress_pct=pct, message=msg)

    remux_to_file(backup, source, on_progress=on_progress)
    _finish_remuxed_file(job, source, timestamps)
    _set_job(
        job,
        state="done",
        progress_pct=100.0,
        message="修复完成",
        backup_name=None,
        finished_at=time.time(),
    )
    _notify_library_sse(job.library_id)
    threading.Thread(
        target=_delete_backup_async,
        args=(job.library_id, backup, source),
        daemon=True,
        name=f"remux-cleanup-{job.video_id[:8]}",
    ).start()


def _worker(job: RemuxJob) -> None:
    set_thread_library(job.library_id)
    source = job.source.resolve()
    backup = _backup_path(source)
    _legacy_temp_path(source, job.video_id).unlink(missing_ok=True)
    timestamps: FileTimestamps | None = None

    try:
        _release_playback_locks(job.video_id)
        suppress_remux_paths(source, backup)
        _set_job(
            job,
            state="running",
            message="正在重封装（流复制，不重新编码）…",
            progress_pct=0.0,
            backup_name=backup.name,
        )

        if source.is_file() and not backup.is_file():
            timestamps = capture_file_timestamps(source)
            _set_job(job, message="正在准备原文件…", progress_pct=0.1)
            os.rename(source, backup)
        elif not source.is_file() and backup.is_file():
            timestamps = capture_file_timestamps(backup)
        elif source.is_file() and backup.is_file():
            timestamps = capture_file_timestamps(backup)
            source.unlink(missing_ok=True)
        else:
            raise FileNotFoundError(f"源文件不存在: {source}")

        assert timestamps is not None
        _remux_and_finalize(job, backup, source, timestamps)
    except Exception as exc:
        unsuppress_remux_paths(source, backup)
        try:
            if backup.is_file() and not source.is_file():
                os.rename(backup, source)
            elif backup.is_file() and source.is_file():
                _rollback_from_backup(backup, source)
        except OSError:
            pass
        _set_job(
            job,
            state="error",
            error=str(exc),
            message="修复失败",
            finished_at=time.time(),
        )


def get_status(library_id: str, video_id: str) -> dict:
    with _lock:
        job = _jobs.get(_job_key(library_id, video_id))
        if not job:
            return {"state": "idle", "video_id": video_id}
        return _job_to_dict(job, video_id)


def start_remux(library_id: str, video_id: str) -> dict:
    ok, reason = can_remux_video(library_id, video_id)
    if not ok:
        return {"ok": False, "error": reason}
    item = get_by_id(library_id, video_id)
    assert item is not None
    source = Path(item.path).resolve()

    started = False
    resume_existing = False
    with _lock:
        key = _job_key(library_id, video_id)
        existing = _jobs.get(key)
        if existing and existing.state in ("queued", "running"):
            resume_existing = True
        elif existing and existing.state == "done":
            return {"ok": True, "started": False, **_job_to_dict(existing, video_id)}
        else:
            for other in _jobs.values():
                if other.state == "running" and other.video_id != video_id:
                    return {"ok": False, "error": "已有其他视频正在修复，请稍后再试"}
            job = RemuxJob(
                video_id=video_id,
                library_id=library_id,
                source=source,
                state="queued",
                message="排队中…",
            )
            _jobs[key] = job
            started = True

    if resume_existing:
        return {"ok": True, "started": False, **get_status(library_id, video_id)}

    if started:
        threading.Thread(
            target=_worker,
            args=(job,),
            daemon=True,
            name=f"remux-{video_id[:8]}",
        ).start()
    return {"ok": True, "started": started, **get_status(library_id, video_id)}
