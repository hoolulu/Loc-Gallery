# -*- coding: utf-8 -*-
"""最近播放记录（服务端持久化）。"""
from __future__ import annotations

import json
import threading
import time

from avv_gallery.config import HISTORY_FILE
from avv_gallery.settings_store import get_setting

_lock = threading.Lock()


def _load_raw() -> dict:
    if HISTORY_FILE.exists():
        try:
            data = json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("items"), dict):
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return {"items": {}}


def _save_raw(data: dict) -> None:
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def retention_days() -> int:
    days = int(get_setting("history_retention_days") or 180)
    return max(1, min(days, 3650))


def _cutoff_ts() -> float:
    return time.time() - retention_days() * 86400


def get_entry(video_id: str) -> dict | None:
    with _lock:
        entry = (_load_raw().get("items") or {}).get(video_id)
    return dict(entry) if entry else None


def record_play(video_id: str) -> dict:
    now = time.time()
    with _lock:
        data = _load_raw()
        items = data.setdefault("items", {})
        entry = items.get(video_id) or {}
        entry["played_at"] = now
        entry["play_count"] = int(entry.get("play_count", 0)) + 1
        items[video_id] = entry
        _save_raw(data)
        return dict(entry)


def list_history_ids_sorted() -> list[str]:
    cutoff = _cutoff_ts()
    with _lock:
        items = _load_raw().get("items") or {}
    filtered = [
        (vid, float(entry.get("played_at", 0)))
        for vid, entry in items.items()
        if float(entry.get("played_at", 0)) >= cutoff
    ]
    filtered.sort(key=lambda x: x[1], reverse=True)
    return [vid for vid, _ in filtered]


def get_history_count() -> int:
    return len(list_history_ids_sorted())


def clear_history() -> int:
    with _lock:
        data = _load_raw()
        count = len(data.get("items") or {})
        data["items"] = {}
        _save_raw(data)
        return count


def remove_history(video_ids: list[str]) -> None:
    if not video_ids:
        return
    with _lock:
        data = _load_raw()
        items = data.get("items") or {}
        for vid in video_ids:
            items.pop(vid, None)
        data["items"] = items
        _save_raw(data)


def prune_missing(valid_ids: set[str]) -> int:
    with _lock:
        data = _load_raw()
        items = data.get("items") or {}
        before = len(items)
        data["items"] = {k: v for k, v in items.items() if k in valid_ids}
        removed = before - len(data["items"])
        if removed:
            _save_raw(data)
        return removed
