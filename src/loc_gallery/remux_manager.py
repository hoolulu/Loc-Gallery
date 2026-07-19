# -*- coding: utf-8 -*-
"""视频重封装任务：碎片化 MP4 → 标准 MP4，完成后替换原片并备份。"""
from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from loc_gallery.library_context import current_library_id, set_thread_library
from loc_gallery.media_probe import get_playback_plan, invalidate_playback_plan
from loc_gallery.remux_core import remux_to_file
from loc_gallery.scanner import get_by_id, refresh_cache
from loc_gallery.thumb_manager import Priority, schedule_ids

_lock = threading.RLock()
_jobs: dict[str, "RemuxJob"] = {}


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


def _allocate_backup(source: Path) -> Path:
    base = source.with_suffix(source.suffix + ".bak")
    if not base.exists():
        return base
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return source.with_name(f"{source.stem}.bak.{stamp}{source.suffix}")


def _temp_path(source: Path, video_id: str) -> Path:
    return source.parent / f".locgallery-remux-{video_id[:8]}.tmp.mp4"


def _replace_with_retry(src: Path, dst: Path, *, attempts: int = 60, delay_sec: float = 2.0) -> None:
    """Windows 上若文件仍被播放/扫描占用，replace 可能长时间阻塞；重试并给出明确错误。"""
    last_err: OSError | None = None
    for attempt in range(attempts):
        try:
            os.replace(src, dst)
            return
        except OSError as exc:
            last_err = exc
            time.sleep(delay_sec)
    raise RuntimeError(
        f"无法替换文件（可能被网页播放或其它程序占用，请先关闭播放页）: {last_err}"
    )


def can_remux_video(library_id: str, video_id: str) -> tuple[bool, str]:
    item = get_by_id(library_id, video_id)
    if not item:
        return False, "视频不存在"
    path = Path(item.path)
    if path.suffix.lower() not in {".mp4", ".m4v"}:
        return False, "仅支持 MP4 文件重封装"
    plan = get_playback_plan(path)
    kind = (plan.get("structure") or {}).get("kind")
    codec = (plan.get("codec") or "").lower()
    if kind != "fragmented":
        return False, "仅碎片化 MP4 需要重封装"
    if codec not in ("h264", "avc1"):
        if codec in ("av1", "hevc", "h265", "vp9"):
            return (
                False,
                f"{codec.upper()} 不能「修复」为 H.264：修复仅重排 MP4 容器（流复制）。"
                "请用 PotPlayer；HTML5 模式下将自动转码播放。",
            )
        return False, f"暂不支持 {codec.upper()} 重封装，请用 PotPlayer"
    if plan.get("transcode"):
        return False, "该视频需要转码，无法流复制重封装"
    return True, ""


def get_status(library_id: str, video_id: str) -> dict:
    with _lock:
        job = _jobs.get(_job_key(library_id, video_id))
        if not job:
            return {"state": "idle", "video_id": video_id}
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


def _set_job(job: RemuxJob, **kwargs) -> None:
    with _lock:
        for k, v in kwargs.items():
            setattr(job, k, v)


def _worker(job: RemuxJob) -> None:
    set_thread_library(job.library_id)
    source = job.source.resolve()
    temp = _temp_path(source, job.video_id)
    temp.unlink(missing_ok=True)
    try:
        _set_job(job, state="running", message="正在重封装（流复制，不重新编码）…", progress_pct=0.0)

        def on_progress(pct: float, msg: str) -> None:
            _set_job(job, progress_pct=pct, message=msg)

        remux_to_file(source, temp, on_progress=on_progress)
        backup = _allocate_backup(source)
        size_gb = source.stat().st_size / (1024**3)
        _set_job(
            job,
            message=(
                f"正在替换原文件并备份（约 {size_gb:.1f}GB）…"
                "若长时间无进展，请先关闭本页播放再重试"
            ),
            progress_pct=99.5,
        )
        _replace_with_retry(source, backup)
        try:
            _replace_with_retry(temp, source)
        except Exception:
            _replace_with_retry(backup, source)
            raise
        invalidate_playback_plan(source)
        refresh_cache(job.library_id)
        schedule_ids([job.video_id], Priority.HIGH)
        _set_job(
            job,
            state="done",
            progress_pct=100.0,
            message="修复完成",
            backup_name=backup.name,
            finished_at=time.time(),
        )
    except Exception as exc:
        temp.unlink(missing_ok=True)
        _set_job(
            job,
            state="error",
            error=str(exc),
            message="修复失败",
            finished_at=time.time(),
        )


def start_remux(library_id: str, video_id: str) -> dict:
    ok, reason = can_remux_video(library_id, video_id)
    if not ok:
        return {"ok": False, "error": reason}
    item = get_by_id(library_id, video_id)
    assert item is not None
    source = Path(item.path).resolve()

    with _lock:
        key = _job_key(library_id, video_id)
        existing = _jobs.get(key)
        if existing and existing.state in ("queued", "running"):
            return {"ok": True, "started": False, **get_status(library_id, video_id)}
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

    threading.Thread(
        target=_worker,
        args=(job,),
        daemon=True,
        name=f"remux-{video_id[:8]}",
    ).start()
    return {"ok": True, "started": True, **get_status(library_id, video_id)}
