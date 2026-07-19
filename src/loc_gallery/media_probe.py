# -*- coding: utf-8 -*-
"""MP4 结构探测与播放兼容性分析。"""
from __future__ import annotations

import json
import struct
import subprocess
import threading
import time
from pathlib import Path

from loc_gallery.thumb_manager import ffprobe_path, _get_duration_mpegts
from loc_gallery.process_util import hidden_subprocess_kwargs
from loc_gallery.config import LARGE_FILE_HLS_BYTES, playback_plans_file
from loc_gallery.file_stability import is_ready_for_processing
from loc_gallery.library_context import current_library_id, set_thread_library
from loc_gallery.settings_store import get_setting

_BROWSER_UNSUPPORTED_VIDEO = {
    "mpeg2video", "vc1", "wmv1", "wmv2", "wmv3", "msmpeg4v2", "msmpeg4v3",
}
_HLS_TRANSCODE_VIDEO = {"av1", "hevc", "h265", "vp9"}
_IMAGE_CODECS = {"png", "mjpeg", "jpeg", "apng", "gif", "bmp", "webp"}
_BROWSER_NATIVE_EXTENSIONS = {".mp4", ".m4v", ".mov"}
_WEB_DIRECT_EXTENSIONS = {".webm", ".ogv"}
_PLAN_VERSION = 14
_H264_NAL_SIGS = (
    b"\x00\x00\x00\x01\x67", b"\x00\x00\x00\x01\x68", b"\x00\x00\x00\x01\x65",
    b"\x00\x00\x01\x67", b"\x00\x00\x01\x68",
)

_plan_cache: dict[str, tuple[float, int, dict]] = {}
_plan_lock = threading.Lock()
_disk_caches: dict[str, dict[str, dict]] = {}
_disk_dirty_libs: set[str] = set()
_disk_flush_timer: threading.Timer | None = None
_DISK_FLUSH_SEC = 1.0


def _disk_path() -> Path:
    return playback_plans_file(current_library_id())


def _load_disk_cache() -> dict[str, dict]:
    lid = current_library_id()
    cached = _disk_caches.get(lid)
    if cached is not None:
        return cached
    path = _disk_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.is_file():
        _disk_caches[lid] = {}
        return _disk_caches[lid]
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        _disk_caches[lid] = raw if isinstance(raw, dict) else {}
    except (json.JSONDecodeError, OSError):
        _disk_caches[lid] = {}
    return _disk_caches[lid]


def _schedule_disk_flush() -> None:
    global _disk_flush_timer
    _disk_dirty_libs.add(current_library_id())

    def _flush() -> None:
        global _disk_flush_timer
        lids = list(_disk_dirty_libs)
        for lid in lids:
            with _plan_lock:
                store = _disk_caches.get(lid)
                if store is None:
                    _disk_dirty_libs.discard(lid)
                    continue
                data = store
            path = playback_plans_file(lid)
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_suffix(".tmp")
                tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                tmp.replace(path)
                _disk_dirty_libs.discard(lid)
            except OSError:
                pass
        with _plan_lock:
            _disk_flush_timer = None

    with _plan_lock:
        if _disk_flush_timer is not None:
            _disk_flush_timer.cancel()
        _disk_flush_timer = threading.Timer(_DISK_FLUSH_SEC, _flush)
        _disk_flush_timer.daemon = True
        _disk_flush_timer.start()


def _hls_policy_tag() -> str:
    large = bool(get_setting("hls_large_h264"))
    moov = bool(get_setting("hls_moov_end_h264"))
    frag = str(get_setting("html5_fragmented_mp4") or "external").strip().lower()
    if frag not in ("external", "hls"):
        frag = "external"
    return f"v{_PLAN_VERSION}:{int(large)}{int(moov)}:{frag}"


def _disk_cache_get(key: str, mtime: float, size: int) -> dict | None:
    entry = _load_disk_cache().get(key)
    if not entry or not isinstance(entry, dict):
        return None
    plan = entry.get("plan")
    if not isinstance(plan, dict):
        return None
    if entry.get("mtime") != mtime or entry.get("size") != size:
        return None
    if entry.get("v", 1) < _PLAN_VERSION:
        return None
    if entry.get("policy") != _hls_policy_tag():
        return None
    return dict(plan)


def _disk_cache_put(key: str, mtime: float, size: int, plan: dict) -> None:
    with _plan_lock:
        store = _load_disk_cache()
        store[key] = {
            "mtime": mtime,
            "size": size,
            "v": _PLAN_VERSION,
            "policy": _hls_policy_tag(),
            "plan": {k: v for k, v in plan.items() if k != "cached"},
            "at": time.time(),
        }
    _schedule_disk_flush()


def _mp4_has_box(path: Path, box_type: str, max_bytes: int = 64 * 1024 * 1024) -> bool:
    """在文件前部扫描 ISO BMFF box（用于识别 fMP4 的 moof）。"""
    try:
        size = path.stat().st_size
    except OSError:
        return False
    limit = min(size, max_bytes)
    pos = 0
    with path.open("rb") as f:
        while pos + 8 <= limit:
            f.seek(pos)
            hdr = f.read(8)
            if len(hdr) < 8:
                break
            box_size = struct.unpack(">I", hdr[:4])[0]
            bt = hdr[4:8].decode("latin1", "replace")
            if bt == box_type:
                return True
            if box_size < 8:
                break
            pos += box_size
    return False


def analyze_mp4_structure(path: Path) -> dict:
    size = path.stat().st_size
    pos = 0
    mdat_count = 0
    moov_pos: int | None = None
    with path.open("rb") as f:
        while pos < size:
            f.seek(pos)
            hdr = f.read(8)
            if len(hdr) < 8:
                break
            box_size = struct.unpack(">I", hdr[:4])[0]
            box_type = hdr[4:8].decode("latin1", "replace")
            if box_size < 8:
                break
            if box_type == "mdat":
                mdat_count += 1
            if box_type == "moov" and moov_pos is None:
                moov_pos = pos
            if mdat_count > 3:
                break
            if moov_pos is not None and mdat_count >= 1:
                break
            pos += box_size

    if moov_pos is None and size > 0:
        moov_pos = _find_moov_near_end(path, size)

    if mdat_count > 3:
        kind = "fragmented"
    elif _mp4_has_box(path, "moof"):
        kind = "fragmented"
    elif moov_pos is not None and moov_pos / size > 0.5:
        kind = "moov_end"
    else:
        kind = "standard"
    return {
        "kind": kind,
        "mdat_count": mdat_count,
        "moov_pos_pct": round(moov_pos / size * 100, 2) if moov_pos is not None else None,
        "size_bytes": size,
    }


def _find_moov_near_end(path: Path, size: int) -> int | None:
    """在文件尾部扫描 moov（moov 在末尾时无需遍历整文件）。"""
    scan = min(size, 32 * 1024 * 1024)
    with path.open("rb") as f:
        f.seek(size - scan)
        chunk = f.read(scan)
    off = 0
    while off + 8 <= len(chunk):
        box_size = struct.unpack(">I", chunk[off:off + 4])[0]
        box_type = chunk[off + 4:off + 8].decode("latin1", "replace")
        if box_size < 8:
            break
        if box_type == "moov":
            return size - scan + off
        off += box_size
    return None


def detect_disguised_mpegts(path: Path) -> dict | None:
    """部分站点下载：PNG 文件头 + MPEG-TS 流（与缩略图、PotPlayer 相同解析方式）。"""
    try:
        with path.open("rb") as f:
            if f.read(8) != b"\x89PNG\r\n\x1a\n":
                return None
    except OSError:
        return None

    duration = _get_duration_mpegts(str(path))
    if not duration or duration < 1:
        return None
    st = path.stat()
    return {
        "kind": "disguised_mpegts",
        "header": "png",
        "duration_sec": round(duration, 1),
        "size_bytes": st.st_size,
    }


# 兼容旧引用
detect_disguised_h264 = detect_disguised_mpegts


def sniff_container_kind(path: Path) -> str:
    """根据文件头判断真实容器类型。"""
    try:
        with path.open("rb") as f:
            head = f.read(16)
    except OSError:
        return "unknown"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image"
    if head.startswith(b"\xff\xd8\xff"):
        return "image"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image"
    if len(head) >= 8 and head[4:8] == b"ftyp":
        return "mp4"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "mkv"
    if head.startswith(b"RIFF") and head[8:12] == b"AVI ":
        return "avi"
    return "unknown"


def _plan_needs_rebuild(path: Path, plan: dict) -> bool:
    """旧版错误缓存需重建。"""
    disguised = detect_disguised_mpegts(path)
    if disguised:
        if plan.get("mode") != "hls" or not plan.get("disguised"):
            return True
        if plan.get("input_format") != "mpegts":
            return True
        kind = (plan.get("structure") or {}).get("kind")
        if kind not in ("disguised_mpegts",):
            return True
        return False
    if plan.get("disguised"):
        return True
    codec = (plan.get("codec") or "").lower()
    if codec in _IMAGE_CODECS and plan.get("mode") != "unsupported":
        return True
    if sniff_container_kind(path) == "image" and plan.get("mode") != "unsupported":
        return True
    return False


def _purge_hls_for_path(path: Path) -> None:
    try:
        import hashlib

        from loc_gallery.config import VIDEO_ROOT
        from loc_gallery import hls_manager

        rel = path.resolve().relative_to(VIDEO_ROOT.resolve()).as_posix()
        video_id = hashlib.md5(rel.encode("utf-8")).hexdigest()
        hls_manager.purge_cache(video_id)
    except Exception:
        pass


def probe_video_codec(path: Path) -> str:
    try:
        result = subprocess.run(
            [
                ffprobe_path(),
                "-v", "error",
                "-show_entries", "stream=codec_type,codec_name",
                "-of", "json",
                str(path),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
            **hidden_subprocess_kwargs(),
        )
        data = json.loads(result.stdout or "{}")
        video_codecs: list[str] = []
        for stream in data.get("streams") or []:
            if stream.get("codec_type") != "video":
                continue
            name = (stream.get("codec_name") or "").strip().lower()
            if name:
                video_codecs.append(name)
        for name in video_codecs:
            if name not in _IMAGE_CODECS:
                return name
        return video_codecs[0] if video_codecs else "unknown"
    except Exception:
        return "unknown"


def _peek_cached_plan(path: Path) -> dict | None:
    """仅读内存/磁盘缓存，不触发 ffprobe。"""
    if not path.is_file():
        return None
    key = str(path.resolve())
    try:
        st = path.stat()
    except OSError:
        return None
    with _plan_lock:
        cached = _plan_cache.get(key)
        if cached and cached[0] == st.st_mtime and cached[1] == st.st_size:
            plan = dict(cached[2])
            if plan.get("_policy") == _hls_policy_tag():
                plan.pop("_policy", None)
                return plan
        return _disk_cache_get(key, st.st_mtime, st.st_size)


def get_format_badge(path: Path) -> str | None:
    """已分析过的非标准格式角标；未缓存则返回 None。"""
    plan = _peek_cached_plan(path)
    if not plan:
        return None
    kind = (plan.get("structure") or {}).get("kind")
    if plan.get("disguised") or kind in ("fragmented", "disguised_mpegts"):
        return "non_standard"
    return None


def get_format_badges(paths: dict[str, Path]) -> dict[str, str]:
    """批量读取角标（仅缓存命中）。"""
    out: dict[str, str] = {}
    for vid, path in paths.items():
        badge = get_format_badge(path)
        if badge:
            out[vid] = badge
    return out


def invalidate_playback_plan(path: Path) -> None:
    """清除播放策略缓存（文件被修复/替换后调用）。"""
    key = str(path.resolve())
    with _plan_lock:
        _plan_cache.pop(key, None)
        store = _load_disk_cache()
        if key in store:
            store.pop(key, None)
            _schedule_disk_flush()
    _purge_hls_for_path(path)


def get_playback_plan(path: Path) -> dict:
    if not path.is_file():
        return {"mode": "error", "reason": "文件不存在", "cached": False}

    if not is_ready_for_processing(path):
        return {"mode": "pending", "reason": "文件正在写入，暂不分析", "cached": False}

    key = str(path.resolve())
    try:
        st = path.stat()
    except OSError:
        return {"mode": "error", "reason": "文件不存在", "cached": False}

    with _plan_lock:
        cached = _plan_cache.get(key)
        if cached and cached[0] == st.st_mtime and cached[1] == st.st_size:
            if cached[2].get("_policy") == _hls_policy_tag() and not _plan_needs_rebuild(path, cached[2]):
                plan = dict(cached[2])
                plan.pop("_policy", None)
                plan["cached"] = True
                return plan

        disk = _disk_cache_get(key, st.st_mtime, st.st_size)
        if disk and not _plan_needs_rebuild(path, disk):
            tagged = {**disk, "_policy": _hls_policy_tag()}
            _plan_cache[key] = (st.st_mtime, st.st_size, tagged)
            plan = dict(disk)
            plan["cached"] = True
            return plan
        if disk and _plan_needs_rebuild(path, disk):
            store = _load_disk_cache()
            store.pop(key, None)
            _plan_cache.pop(key, None)
            _purge_hls_for_path(path)

    plan = _build_playback_plan(path)
    plan["_policy"] = _hls_policy_tag()
    with _plan_lock:
        _plan_cache[key] = (st.st_mtime, st.st_size, plan)
    _disk_cache_put(key, st.st_mtime, st.st_size, plan)
    out = dict(plan)
    out.pop("_policy", None)
    out["cached"] = False
    return out


def schedule_probe_for_ids(video_ids: list[str], library_id: str | None = None) -> int:
    """后台预分析播放策略并写入 playback_plans.json。"""
    if not video_ids:
        return 0
    from loc_gallery.scanner import get_by_id

    lid = library_id or current_library_id()
    paths: list[Path] = []
    for vid in video_ids:
        item = get_by_id(lid, vid)
        if item:
            p = Path(item.path)
            if is_ready_for_processing(p):
                paths.append(p)
    if not paths:
        return 0
    threading.Thread(
        target=_probe_paths_worker,
        args=(lid, paths),
        daemon=True,
        name="playback-probe",
    ).start()
    return len(paths)


def _probe_paths_worker(library_id: str, paths: list[Path]) -> None:
    set_thread_library(library_id)
    for path in paths:
        try:
            get_playback_plan(path)
        except Exception:
            pass


def _plan_non_native_container(path: Path, ext: str, sniff: str) -> dict:
    """WMV/AVI/MKV 等：浏览器 <video> 不能当 MP4 直连，按编码走 HLS。"""
    codec = probe_video_codec(path)
    label = sniff if sniff and sniff not in ("unknown", "image") else ext.lstrip(".").upper()

    if codec in _IMAGE_CODECS:
        return {
            "mode": "unsupported",
            "reason": f"视频流为图片编码（{codec.upper()}），无法播放",
            "codec": codec,
            "container": label,
        }

    if codec in _BROWSER_UNSUPPORTED_VIDEO:
        return {
            "mode": "hls",
            "transcode": True,
            "reason": f"{label} / {codec.upper()}，浏览器不支持，将转码后播放",
            "codec": codec,
            "container": label,
        }

    if codec in _HLS_TRANSCODE_VIDEO:
        return {
            "mode": "hls",
            "transcode": True,
            "reason": f"{codec.upper()} 编码，将转码后播放",
            "codec": codec,
            "container": label,
        }

    if codec == "h264":
        return {
            "mode": "hls",
            "transcode": False,
            "reason": f"非 MP4 容器（{label}），边切边播",
            "codec": codec,
            "container": label,
        }

    return {
        "mode": "hls",
        "transcode": True,
        "reason": f"非 MP4 容器（{label}），将转码后播放",
        "codec": codec,
        "container": label,
    }


def _build_playback_plan(path: Path) -> dict:
    ext = path.suffix.lower()
    disguised = detect_disguised_mpegts(path)
    if disguised:
        mins = int(disguised["duration_sec"] // 60)
        return {
            "mode": "hls",
            "transcode": False,
            "input_format": "mpegts",
            "disguised": True,
            "reason": f"站点伪装格式（MPEG-TS），边切边播（约 {mins} 分钟）",
            "codec": "h264",
            "structure": disguised,
        }

    sniff = sniff_container_kind(path)

    if sniff == "image":
        return {
            "mode": "unsupported",
            "reason": "该文件实为图片，不是可播放视频",
            "codec": probe_video_codec(path),
            "container": "image",
        }

    if ext not in _BROWSER_NATIVE_EXTENSIONS:
        if ext in _WEB_DIRECT_EXTENSIONS:
            codec = probe_video_codec(path)
            if codec in _IMAGE_CODECS:
                return {
                    "mode": "unsupported",
                    "reason": f"视频流为图片编码（{codec.upper()}），无法播放",
                    "codec": codec,
                    "container": sniff,
                }
            if codec in _HLS_TRANSCODE_VIDEO:
                return {
                    "mode": "hls",
                    "transcode": True,
                    "reason": f"{codec.upper()} 编码，将转码后播放",
                    "codec": codec,
                }
            return {
                "mode": "direct",
                "reason": f"{ext[1:].upper()} 容器，尝试直接播放",
                "codec": codec,
            }
        return _plan_non_native_container(path, ext, sniff)

    codec = probe_video_codec(path)

    if codec in _IMAGE_CODECS:
        return {
            "mode": "unsupported",
            "reason": f"视频流为图片编码（{codec.upper()}），无法播放",
            "codec": codec,
            "container": sniff,
        }

    if codec in _BROWSER_UNSUPPORTED_VIDEO:
        return {
            "mode": "unsupported",
            "reason": f"浏览器不支持 {codec.upper()} 编码，请用 PotPlayer",
            "codec": codec,
        }

    structure = analyze_mp4_structure(path)
    kind = structure["kind"]

    if codec in _HLS_TRANSCODE_VIDEO:
        return {
            "mode": "hls",
            "transcode": True,
            "reason": f"{codec.upper()} 编码，将转码后播放",
            "codec": codec,
            "structure": structure,
        }

    if kind == "fragmented":
        frag_mode = str(get_setting("html5_fragmented_mp4") or "external").strip().lower()
        if frag_mode == "hls":
            return {
                "mode": "hls",
                "transcode": False,
                "reason": "碎片化 MP4，将边切边播",
                "codec": codec,
                "structure": structure,
            }
        return {
            "mode": "external",
            "transcode": False,
            "reason": "碎片化 MP4，浏览器无法直连；可修复为标准 MP4 或用 PotPlayer",
            "codec": codec,
            "structure": structure,
        }

    size_bytes = structure.get("size_bytes") or 0
    moov_hls = bool(get_setting("hls_moov_end_h264"))
    large_hls = bool(get_setting("hls_large_h264"))

    if moov_hls and kind == "moov_end":
        return {
            "mode": "hls",
            "transcode": False,
            "reason": "索引在文件末尾，边切边播以加快起播",
            "codec": codec,
            "structure": structure,
        }

    if large_hls and size_bytes >= LARGE_FILE_HLS_BYTES:
        return {
            "mode": "hls",
            "transcode": False,
            "reason": f"大文件（{size_bytes // (1024 * 1024)}MB），边切边播以加快起播",
            "codec": codec,
            "structure": structure,
        }

    if kind == "moov_end":
        reason = "H.264 MP4，直接播放（索引在文件末尾，起播可能稍慢）"
    else:
        reason = "H.264 MP4，直接播放"

    return {
        "mode": "direct",
        "transcode": False,
        "reason": reason,
        "codec": codec,
        "structure": structure,
    }
