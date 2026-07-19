# -*- coding: utf-8 -*-
"""HLS 切片：按视频缓存 + LRU 淘汰（默认上限 5GB）。"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

from avv_gallery.config import HLS_CACHE_DIR, HLS_CACHE_MAX_BYTES, service_environ
from avv_gallery.process_util import hidden_subprocess_kwargs
from avv_gallery.thumb_manager import ffmpeg_path

_lock = threading.RLock()
_current_id: str | None = None
_process: subprocess.Popen | None = None
_process_pid: int | None = None
_started_at = 0.0
_error: str | None = None

HLS_SEGMENT_SECONDS = 6
MIN_SEGMENTS_TO_PLAY = 1
_LRU_FILE = "_lru.json"
_COMPLETE_MARK = ".complete"
_META_FILE = ".meta.json"


def _ensure_root() -> None:
    HLS_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _work_dir(video_id: str) -> Path:
    return HLS_CACHE_DIR / video_id


def _load_lru() -> dict:
    path = HLS_CACHE_DIR / _LRU_FILE
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_lru(data: dict) -> None:
    _ensure_root()
    path = HLS_CACHE_DIR / _LRU_FILE
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for p in path.rglob("*"):
        if p.is_file():
            try:
                total += p.stat().st_size
            except OSError:
                pass
    return total


def _list_cache_dirs() -> list[Path]:
    _ensure_root()
    out: list[Path] = []
    for p in HLS_CACHE_DIR.iterdir():
        if p.is_dir() and not p.name.startswith("_"):
            out.append(p)
    return out


def touch_lru(video_id: str) -> None:
    with _lock:
        lru = _load_lru()
        lru[video_id] = {"at": time.time(), "bytes": _dir_size(_work_dir(video_id))}
        _save_lru(lru)


def _evict_lru_if_needed(*, keep: str | None = None) -> None:
    """超出上限时按最近最少使用淘汰（不淘汰 keep 与当前切片中的视频）。"""
    with _lock:
        lru = _load_lru()
        dirs = {p.name: p for p in _list_cache_dirs()}
        for vid, path in dirs.items():
            if vid not in lru:
                lru[vid] = {"at": path.stat().st_mtime, "bytes": _dir_size(path)}

        def total_bytes() -> int:
            return sum(_dir_size(dirs[v]) for v in dirs if v in dirs)

        protected = {keep, _current_id} - {None}
        while total_bytes() > HLS_CACHE_MAX_BYTES:
            candidates = [
                (info.get("at", 0), vid)
                for vid, info in lru.items()
                if vid in dirs and vid not in protected
            ]
            if not candidates:
                break
            candidates.sort()
            _, victim = candidates[0]
            _remove_video_cache(victim)
            dirs.pop(victim, None)
            lru.pop(victim, None)
        _save_lru(lru)


def _remove_video_cache(video_id: str) -> None:
    path = _work_dir(video_id)
    if not path.exists():
        return
    # 正在切片的不删
    if video_id == _current_id and _process is not None and _process.poll() is None:
        return
    import shutil
    shutil.rmtree(path, ignore_errors=True)


def _clear_video_cache(video_id: str) -> None:
    path = _work_dir(video_id)
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)
    path.mkdir(parents=True, exist_ok=True)
    lru = _load_lru()
    lru.pop(video_id, None)
    _save_lru(lru)


def purge_cache(video_id: str) -> None:
    """删除某视频的 HLS 磁盘缓存并停止相关切片进程。"""
    global _current_id
    with _lock:
        if _current_id == video_id:
            _kill_process_only()
            _current_id = None
        path = _work_dir(video_id)
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)
        lru = _load_lru()
        lru.pop(video_id, None)
        _save_lru(lru)


def _read_meta(work: Path) -> dict | None:
    meta = work / _META_FILE
    if not meta.is_file():
        return None
    try:
        return json.loads(meta.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_meta(
    work: Path,
    source: Path,
    *,
    transcode: bool,
    input_format: str | None = None,
    input_offset: int = 0,
) -> None:
    st = source.stat()
    meta = {
        "transcode": transcode,
        "input_format": input_format,
        "input_offset": input_offset,
        "source_mtime": st.st_mtime,
        "source_size": st.st_size,
        "created_at": time.time(),
    }
    (work / _META_FILE).write_text(json.dumps(meta), encoding="utf-8")


def _cache_meta_valid(
    work: Path,
    source: Path,
    *,
    transcode: bool,
    input_format: str | None = None,
    input_offset: int = 0,
) -> bool:
    meta = _read_meta(work)
    if not meta:
        return False
    if bool(meta.get("transcode")) != bool(transcode):
        return False
    if (meta.get("input_format") or None) != (input_format or None):
        return False
    if int(meta.get("input_offset") or 0) != int(input_offset or 0):
        return False
    try:
        st = source.stat()
    except OSError:
        return False
    return (
        meta.get("source_mtime") == st.st_mtime
        and meta.get("source_size") == st.st_size
    )


def _count_segments(work: Path) -> int:
    return len(list(work.glob("seg*.ts")))


def _cache_playable(work: Path) -> bool:
    playlist = work / "playlist.m3u8"
    return playlist.is_file() and _count_segments(work) >= MIN_SEGMENTS_TO_PLAY


def _cache_complete(work: Path) -> bool:
    return _cache_playable(work) and (work / _COMPLETE_MARK).is_file()


def _kill_pid_tree(pid: int) -> None:
    if pid <= 0:
        return
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            **hidden_subprocess_kwargs(),
        )
    else:
        try:
            import os
            import signal
            os.killpg(os.getpgid(pid), signal.SIGTERM)
        except Exception:
            try:
                import os
                os.kill(pid, 9)
            except Exception:
                pass


def _kill_process_only() -> None:
    """仅终止 ffmpeg 进程，保留磁盘缓存。"""
    global _process, _process_pid
    proc = _process
    pid = _process_pid
    _process = None
    _process_pid = None

    pids: set[int] = set()
    if pid and pid > 0:
        pids.add(pid)
    if proc is not None and proc.pid and proc.pid > 0:
        pids.add(proc.pid)

    for p in pids:
        _kill_pid_tree(p)

    if proc is not None and proc.poll() is None:
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            for p in pids:
                _kill_pid_tree(p)
            try:
                proc.kill()
            except Exception:
                pass
            try:
                proc.wait(timeout=2)
            except Exception:
                pass


def _watch_process(proc: subprocess.Popen, video_id: str, work: Path) -> None:
    global _error, _current_id
    try:
        proc.wait()
    except Exception:
        return
    with _lock:
        if _process is not proc:
            return
        if proc.returncode == 0:
            try:
                (work / _COMPLETE_MARK).write_text("1", encoding="utf-8")
            except OSError:
                pass
            touch_lru(video_id)
            return
        _error = f"ffmpeg 退出码 {proc.returncode}"


def stop_playback(video_id: str | None = None, *, force: bool = False) -> bool:
    """停止当前 ffmpeg 切片进程，保留已缓存的 HLS 文件。返回是否曾有活跃进程。"""
    global _current_id, _error, _started_at
    with _lock:
        was_active = _current_id is not None or (
            _process is not None and _process.poll() is None
        )
        if not force and video_id is not None and _current_id not in (None, video_id):
            return False
        _kill_process_only()
        _current_id = None
        _error = None
        _started_at = 0.0
        return was_active


def shutdown() -> None:
    stop_playback(force=True)


def _status_dict(
    video_id: str,
    *,
    state: str,
    ready: bool,
    segments: int,
    processing: bool,
    cached: bool = False,
) -> dict:
    elapsed = round(time.time() - _started_at, 1) if _started_at else 0
    return {
        "video_id": video_id,
        "state": state,
        "ready": ready,
        "segments": segments,
        "processing": processing,
        "elapsed_sec": elapsed,
        "error": _error,
        "cached": cached,
        "playlist_url": f"/api/hls/{video_id}/playlist.m3u8" if ready else None,
    }


def get_status(video_id: str) -> dict:
    work = _work_dir(video_id)
    with _lock:
        active = _current_id == video_id
        segments = _count_segments(work) if work.exists() else 0
        proc_alive = active and _process is not None and _process.poll() is None
        ready = _cache_playable(work)

        if not active:
            if ready and _cache_complete(work):
                touch_lru(video_id)
                return _status_dict(
                    video_id,
                    state="cached",
                    ready=True,
                    segments=segments,
                    processing=False,
                    cached=True,
                )
            return _status_dict(
                video_id,
                state="idle",
                ready=False,
                segments=segments,
                processing=False,
            )

        if _error:
            state = "error"
        elif ready and proc_alive:
            state = "playing"
        elif ready:
            state = "ready"
        elif proc_alive:
            state = "preparing"
        else:
            state = "idle"
        return _status_dict(
            video_id,
            state=state,
            ready=ready,
            segments=segments,
            processing=proc_alive,
            cached=_cache_complete(work),
        )


def _start_ffmpeg(
    video_id: str,
    source: Path,
    work: Path,
    *,
    transcode: bool,
    input_format: str | None = None,
    input_offset: int = 0,
) -> dict:
    global _current_id, _process, _process_pid, _started_at, _error

    playlist = work / "playlist.m3u8"
    segment_pattern = str(work / "seg%05d.ts")

    if input_format == "mpegts":
        cmd = [
            ffmpeg_path(),
            "-hide_banner",
            "-loglevel", "error",
            "-y",
            "-fflags", "+genpts+ignidx+discardcorrupt",
            "-err_detect", "ignore_err",
            "-f", "mpegts",
            "-i", str(source),
            "-map", "0:v:0?",
            "-map", "0:a:0?",
            "-c", "copy",
            "-f", "hls",
            "-hls_time", str(HLS_SEGMENT_SECONDS),
            "-hls_list_size", "0",
            "-hls_flags", "independent_segments+temp_file",
            "-hls_segment_filename", segment_pattern,
            str(playlist),
        ]
        stdin = subprocess.DEVNULL
    elif transcode:
        cmd = [
            ffmpeg_path(),
            "-hide_banner",
            "-loglevel", "error",
            "-y",
            "-i", str(source),
            "-map", "0:v:0?",
            "-map", "0:a:0?",
            "-vf", "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "128k",
            "-f", "hls",
            "-hls_time", str(HLS_SEGMENT_SECONDS),
            "-hls_list_size", "0",
            "-hls_flags", "independent_segments+temp_file",
            "-hls_segment_filename", segment_pattern,
            str(playlist),
        ]
        stdin = subprocess.DEVNULL
    else:
        cmd = [
            ffmpeg_path(),
            "-hide_banner",
            "-loglevel", "error",
            "-y",
            "-i", str(source),
            "-map", "0:v:0?",
            "-map", "0:a:0?",
            "-c", "copy",
            "-f", "hls",
            "-hls_time", str(HLS_SEGMENT_SECONDS),
            "-hls_list_size", "0",
            "-hls_flags", "independent_segments+temp_file",
            "-hls_segment_filename", segment_pattern,
            str(playlist),
        ]
        stdin = subprocess.DEVNULL

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=stdin,
            env=service_environ(),
            **hidden_subprocess_kwargs(),
        )
    except Exception as exc:
        _error = str(exc)
        return {"ok": False, "error": _error}

    _write_meta(
        work, source,
        transcode=transcode,
        input_format=input_format,
        input_offset=input_offset,
    )
    (work / _COMPLETE_MARK).unlink(missing_ok=True)
    _process = proc
    _process_pid = proc.pid
    _current_id = video_id
    _started_at = time.time()
    _error = None
    threading.Thread(
        target=_watch_process,
        args=(proc, video_id, work),
        daemon=True,
    ).start()
    touch_lru(video_id)
    return {"ok": True, **get_status(video_id)}


def prepare(
    video_id: str,
    source: Path,
    *,
    transcode: bool = False,
    input_format: str | None = None,
    input_offset: int = 0,
) -> dict:
    global _current_id, _error
    source = source.resolve()
    if not source.is_file():
        return {"ok": False, "error": "文件不存在"}

    _ensure_root()
    work = _work_dir(video_id)

    with _lock:
        touch_lru(video_id)
        _evict_lru_if_needed(keep=video_id)

        # 同一视频：进程仍在跑
        if _current_id == video_id and _process is not None and _process.poll() is None:
            return {"ok": True, **get_status(video_id)}

        # 换片：只停旧进程，不删缓存
        if _current_id is not None and _current_id != video_id:
            _kill_process_only()
            _current_id = None
            _error = None

        # 缓存命中（已完整切片）
        if work.exists() and _cache_meta_valid(
            work, source,
            transcode=transcode,
            input_format=input_format,
            input_offset=input_offset,
        ):
            if _cache_complete(work):
                touch_lru(video_id)
                return {"ok": True, "cached": True, **get_status(video_id)}

            # 未完成但可播（极少见：进程异常退出）
            if _cache_playable(work):
                _kill_process_only()
                _clear_video_cache(video_id)
            else:
                _clear_video_cache(video_id)
        elif work.exists():
            _clear_video_cache(video_id)

        work.mkdir(parents=True, exist_ok=True)
        return _start_ffmpeg(
            video_id, source, work,
            transcode=transcode,
            input_format=input_format,
            input_offset=input_offset,
        )


def resolve_hls_file(video_id: str, filename: str) -> Path | None:
    if filename != "playlist.m3u8" and not (filename.startswith("seg") and filename.endswith(".ts")):
        return None
    root = _work_dir(video_id).resolve()
    path = (root / filename).resolve()
    if path.parent != root:
        return None
    if not path.is_file():
        return None
    touch_lru(video_id)
    return path


def cache_stats() -> dict:
    """供调试/状态接口：缓存占用与条目数。"""
    dirs = _list_cache_dirs()
    total = sum(_dir_size(d) for d in dirs)
    lru = _load_lru()
    return {
        "entries": len(dirs),
        "bytes": total,
        "max_bytes": HLS_CACHE_MAX_BYTES,
        "percent": round(total / HLS_CACHE_MAX_BYTES * 100, 2) if HLS_CACHE_MAX_BYTES else 0,
        "active_video_id": _current_id,
        "lru_count": len(lru),
    }
