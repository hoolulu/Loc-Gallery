# -*- coding: utf-8 -*-
import json
import threading
from copy import deepcopy

from avv_gallery.config import (
    DEFAULT_PAGE_SIZE,
    HISTORY_RETENTION_DAYS,
    PLAYER_MODE,
    POTPLAYER_PATH,
    SETTINGS_FILE,
    THUMB_IDLE_SCAN,
    THUMB_POSITION,
    THUMB_RANDOM_MAX,
    THUMB_RANDOM_MIN,
    THUMB_WORKERS,
)

_lock = threading.Lock()

_DEFAULTS = {
    "thumb_position": THUMB_POSITION,
    "thumb_random_min": THUMB_RANDOM_MIN,
    "thumb_random_max": THUMB_RANDOM_MAX,
    "thumb_workers": THUMB_WORKERS,
    "thumb_idle_scan": THUMB_IDLE_SCAN,
    "default_page_size": DEFAULT_PAGE_SIZE,
    "potplayer_path": str(POTPLAYER_PATH),
    "player_mode": PLAYER_MODE,
    "history_retention_days": HISTORY_RETENTION_DAYS,
}


def load_settings() -> dict:
    with _lock:
        if SETTINGS_FILE.exists():
            try:
                data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
                merged = deepcopy(_DEFAULTS)
                merged.update(data)
                return merged
            except (json.JSONDecodeError, OSError):
                pass
        return deepcopy(_DEFAULTS)


def save_settings(data: dict) -> dict:
    with _lock:
        merged = deepcopy(_DEFAULTS)
        merged.update(data)
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_FILE.write_text(
            json.dumps(merged, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return merged


def get_setting(key: str):
    return load_settings().get(key, _DEFAULTS.get(key))
