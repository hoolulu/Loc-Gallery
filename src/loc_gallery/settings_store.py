# -*- coding: utf-8 -*-
import json
import threading
from copy import deepcopy

from pathlib import Path

from loc_gallery.config import (
    DEFAULT_PAGE_SIZE,
    HISTORY_RETENTION_DAYS,
    HLS_LARGE_H264,
    HLS_MOOV_END_H264,
    HTML5_FRAGMENTED_MP4,
    PLAYER_MODE,
    SETTINGS_FILE,
    THUMB_IDLE_SCAN,
    THUMB_POSITION,
    THUMB_RANDOM_MAX,
    THUMB_RANDOM_MIN,
    THUMB_WORKERS,
    detect_potplayer_path,
    library_settings_file,
)

_lock = threading.Lock()

_DEFAULTS = {
    "thumb_position": THUMB_POSITION,
    "thumb_random_min": THUMB_RANDOM_MIN,
    "thumb_random_max": THUMB_RANDOM_MAX,
    "thumb_workers": THUMB_WORKERS,
    "thumb_idle_scan": THUMB_IDLE_SCAN,
    "default_page_size": DEFAULT_PAGE_SIZE,
    "potplayer_path": detect_potplayer_path(),
    "player_mode": PLAYER_MODE,
    "history_retention_days": HISTORY_RETENTION_DAYS,
    "hls_large_h264": HLS_LARGE_H264,
    "hls_moov_end_h264": HLS_MOOV_END_H264,
    "html5_fragmented_mp4": HTML5_FRAGMENTED_MP4,
}

_LIBRARY_OVERRIDE_KEYS = {
    "thumb_position",
    "thumb_random_min",
    "thumb_random_max",
    "thumb_workers",
    "thumb_idle_scan",
    "default_page_size",
    "potplayer_path",
    "player_mode",
    "history_retention_days",
    "hls_large_h264",
    "hls_moov_end_h264",
    "html5_fragmented_mp4",
}


def _resolve_potplayer_setting(stored: str) -> str:
    stored = (stored or "").strip()
    if stored:
        path = Path(stored)
        if path.is_file():
            return str(path)
    return detect_potplayer_path()


def _load_global() -> dict:
    if SETTINGS_FILE.exists():
        try:
            data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            merged = deepcopy(_DEFAULTS)
            merged.update(data)
            merged["potplayer_path"] = _resolve_potplayer_setting(merged.get("potplayer_path"))
            return merged
        except (json.JSONDecodeError, OSError):
            pass
    merged = deepcopy(_DEFAULTS)
    # 无全局 settings.json 时，继承 lib-default 库内配置（单库升级后的常见情况）
    from loc_gallery.library_store import DEFAULT_LIBRARY_ID

    fallback = library_settings_file(DEFAULT_LIBRARY_ID)
    if fallback.exists():
        try:
            data = json.loads(fallback.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                merged.update({k: v for k, v in data.items() if k in _DEFAULTS})
        except (json.JSONDecodeError, OSError):
            pass
    merged["potplayer_path"] = _resolve_potplayer_setting(merged.get("potplayer_path"))
    return merged


def _load_library_overrides(library_id: str) -> dict:
    path = library_settings_file(library_id)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {}
        return {k: v for k, v in data.items() if k in _LIBRARY_OVERRIDE_KEYS}
    except (json.JSONDecodeError, OSError):
        return {}


def load_settings(library_id: str | None = None) -> dict:
    with _lock:
        merged = _load_global()
        if library_id:
            merged.update(_load_library_overrides(library_id))
        return merged


def save_settings(data: dict, library_id: str | None = None) -> dict:
    with _lock:
        if library_id:
            path = library_settings_file(library_id)
            path.parent.mkdir(parents=True, exist_ok=True)
            overrides = {k: data[k] for k in _LIBRARY_OVERRIDE_KEYS if k in data}
            path.write_text(json.dumps(overrides, ensure_ascii=False, indent=2), encoding="utf-8")
            merged = _load_global()
            merged.update(overrides)
            return merged
        merged = deepcopy(_DEFAULTS)
        merged.update(data)
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_FILE.write_text(
            json.dumps(merged, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return merged


def get_setting(key: str, library_id: str | None = None):
    return load_settings(library_id).get(key, _DEFAULTS.get(key))
