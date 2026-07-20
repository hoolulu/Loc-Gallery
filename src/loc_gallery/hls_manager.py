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

from loc_gallery.config import HLS_CACHE_MAX_BYTES, hls_cache_dir, service_environ
from loc_gallery.library_context import current_library_id
from loc_gallery.process_util import (
    deprioritize_process,
    hidden_subprocess_kwargs,
    resume_process,
    suspend_process,
)
from loc_gallery.thumb_manager import ffmpeg_path

_lock = threading.RLock()
_current_id: str | None = None
_process: subprocess.Popen | None = None
_process_pid: int | None = None
_started_at = 0.0
_error: str | None = None
_slice_paused = False

HLS_SEGMENT_SECONDS = 30
# 本地单用户播放：保留 independent_segments 便于 seek；去掉 temp_file 避免每段双写
HLS_FLAGS = "independent_segments"
HLS_FLAGS_APPEND = "independent_segments+append_list"
MIN_SEGMENTS_TO_PLAY = 1
_LRU_FILE = "_lru.json"
_COMPLETE_MARK = ".complete"
_META_FILE = ".meta.json"


def _hls_root() -> Path:
    return hls_cache_dir(current_library_id())


def _ensure_root() -> None:
    _hls_root().mkdir(parents=True, exist_ok=True)


def _work_dir(video_id: str) -> Path:
    return _hls_root() / video_id


def _load_lru() -> dict:
    path = _hls_root() / _LRU_FILE
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_lru(data: dict) -> None:
    _ensure_root()
    path = _hls_root() / _LRU_FILE
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
    for p in _hls_root().iterdir():
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
        "segment_seconds": HLS_SEGMENT_SECONDS,
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
    if int(meta.get("segment_seconds") or 0) != HLS_SEGMENT_SECONDS:
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


def _active_pid() -> int | None:
    if _process_pid and _process_pid > 0:
        return _process_pid
    if _process is not None and _process.pid and _process.pid > 0:
        return _process.pid
    return None


def pause_playback_slicing() -> bool:
    """挂起 ffmpeg 切片进程（保留缓存与进度，不杀进程）。"""
    global _slice_paused
    with _lock:
        if _process is None or _process.poll() is not None:
            return False
        if _slice_paused:
            return True
        pid = _active_pid()
        if not pid or not suspend_process(pid):
            return False
        _slice_paused = True
        return True


def resume_playback_slicing() -> bool:
    """恢复已挂起的 ffmpeg 切片进程。"""
    global _slice_paused
    with _lock:
        if _process is None or _process.poll() is not None:
            _slice_paused = False
            return False
        if not _slice_paused:
            return True
        pid = _active_pid()
        if not pid or not resume_process(pid):
            return False
        _slice_paused = False
        return True


def stop_playback(video_id: str | None = None, *, force: bool = False) -> bool:
    """停止当前 ffmpeg 切片进程，保留已缓存的 HLS 文件。返回是否曾有活跃进程。"""
    global _current_id, _error, _started_at, _slice_paused
    with _lock:
        was_active = _current_id is not None or (
            _process is not None and _process.poll() is None
        )
        if not force and video_id is not None and _current_id not in (None, video_id):
            return False
        if _slice_paused:
            pid = _active_pid()
            if pid:
                resume_process(pid)
            _slice_paused = False
        _kill_process_only()
        _current_id = None
        _error = None
        _started_at = 0.0
        _slice_paused = False
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
    slice_paused: bool = False,
) -> dict:
    elapsed = round(time.time() - _started_at, 1) if _started_at else 0
    return {
        "video_id": video_id,
        "state": state,
        "ready": ready,
        "segments": segments,
        "segment_seconds": HLS_SEGMENT_SECONDS,
        "produced_end_sec": segments * HLS_SEGMENT_SECONDS,
        "processing": processing,
        "slice_paused": slice_paused,
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
        paused = bool(proc_alive and _slice_paused)

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
        elif paused:
            state = "paused"
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
            slice_paused=paused,
        )


def _build_hls_ffmpeg_cmd(
    source: Path,
    playlist: Path,
    segment_pattern: str,
    *,
    transcode: bool,
    input_format: str | None = None,
    seek_sec: float | None = None,
    start_number: int | None = None,
    append_playlist: bool = False,
) -> list[str]:
    flags = HLS_FLAGS_APPEND if append_playlist else HLS_FLAGS
    cmd: list[str] = [
        ffmpeg_path(),
        "-hide_banner",
        "-loglevel", "error",
        "-y",
    ]
    if seek_sec is not None and seek_sec > 0.05:
        cmd.extend(["-ss", f"{seek_sec:.3f}"])

    if input_format == "mpegts":
        cmd.extend([
            "-fflags", "+genpts+ignidx+discardcorrupt",
            "-err_detect", "ignore_err",
            "-f", "mpegts",
            "-i", str(source),
        ])
    else:
        cmd.extend(["-i", str(source)])

    cmd.extend(["-map", "0:v:0?", "-map", "0:a:0?"])
    if transcode:
        cmd.extend([
            "-vf", "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "128k",
        ])
    else:
        cmd.extend(["-c", "copy"])

    cmd.extend([
        "-f", "hls",
        "-hls_time", str(HLS_SEGMENT_SECONDS),
        "-hls_list_size", "0",
        "-hls_playlist_type", "event",
        "-hls_flags", flags,
    ])
    if start_number is not None and start_number > 0:
        cmd.extend(["-start_number", str(start_number)])
    cmd.extend([
        "-hls_segment_filename", segment_pattern,
        str(playlist),
    ])
    return cmd


def _start_ffmpeg(
    video_id: str,
    source: Path,
    work: Path,
    *,
    transcode: bool,
    input_format: str | None = None,
    input_offset: int = 0,
    seek_sec: float | None = None,
    start_number: int | None = None,
    append_playlist: bool = False,
) -> dict:
    global _current_id, _process, _process_pid, _started_at, _error, _slice_paused

    playlist = work / "playlist.m3u8"
    segment_pattern = str(work / "seg%05d.ts")

    cmd = _build_hls_ffmpeg_cmd(
        source,
        playlist,
        segment_pattern,
        transcode=transcode,
        input_format=input_format,
        seek_sec=seek_sec,
        start_number=start_number,
        append_playlist=append_playlist,
    )
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

    if proc.pid:
        deprioritize_process(proc.pid)

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
    _slice_paused = False
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


def catchup_from_position(video_id: str, source: Path, position_sec: float) -> dict:
    """播放位置接近/超过已切片段末尾时续切；大幅拖进度则从该处 append 切片。"""
    global _slice_paused, _error
    source = source.resolve()
    work = _work_dir(video_id)
    with _lock:
        if not work.exists():
            return {"ok": False, "error": "无 HLS 缓存"}
        if _cache_complete(work):
            return {"ok": True, "action": "complete"}
        if _current_id != video_id:
            return {"ok": True, "action": "skipped", "reason": "not_active"}

        meta = _read_meta(work)
        if not meta:
            return {"ok": False, "error": "无切片元数据"}

        transcode = bool(meta.get("transcode"))
        input_format = meta.get("input_format")
        input_offset = int(meta.get("input_offset") or 0)
        segments = _count_segments(work)
        produced_end = segments * HLS_SEGMENT_SECONDS
        pos = max(0.0, float(position_sec))
        produced_ahead = produced_end - pos
        forward_jump = pos - produced_end

        comfortable = produced_ahead >= HLS_SEGMENT_SECONDS * 3
        if comfortable:
            if _process is not None and _process.poll() is None and _slice_paused:
                resume_playback_slicing()
            return {"ok": True, "action": "ok", "produced_ahead": round(produced_ahead, 2)}

        need_restart = (
            segments > 0
            and forward_jump > HLS_SEGMENT_SECONDS * 1.5
        )
        if need_restart:
            start_number = segments
            seek_to = max(0.0, start_number * HLS_SEGMENT_SECONDS - 2.0)
            _kill_process_only()
            _slice_paused = False
            _error = None
            return _start_ffmpeg(
                video_id,
                source,
                work,
                transcode=transcode,
                input_format=input_format,
                input_offset=input_offset,
                seek_sec=seek_to,
                start_number=start_number,
                append_playlist=True,
            )

        if _process is not None and _process.poll() is None:
            resume_playback_slicing()
        return {
            "ok": True,
            "action": "resume",
            "produced_ahead": round(produced_ahead, 2),
        }


def normalize_playlist_m3u8(text: str) -> str:
    """边切边播清单无 ENDLIST 时，部分播放器会当作直播并从末尾起播。"""
    normalized = text.replace("\r\n", "\n").strip()
    if not normalized:
        return text
    lines = normalized.split("\n")
    if lines[0].strip() != "#EXTM3U":
        return text
    rest = lines[1:]
    has_endlist = any(line.strip() == "#EXT-X-ENDLIST" for line in rest)
    if has_endlist:
        return normalized + "\n"
    inject: list[str] = []
    if not any(line.strip().startswith("#EXT-X-PLAYLIST-TYPE") for line in rest):
        inject.append("#EXT-X-PLAYLIST-TYPE:EVENT")
    if not any(line.strip().startswith("#EXT-X-START") for line in rest):
        inject.append("#EXT-X-START:TIME-OFFSET=0")
    return "\n".join([lines[0], *inject, *rest]) + "\n"


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
