# -*- coding: utf-8 -*-
"""最近播放记录（按库隔离）。"""
from __future__ import annotations

import json
import threading
import time

from loc_gallery.config import history_file
from loc_gallery.settings_store import get_setting

_lock = threading.Lock()


def _load_raw(library_id: str) -> dict:
    path = history_file(library_id)
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("items"), dict):
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return {"items": {}}


def _save_raw(library_id: str, data: dict) -> None:
    path = history_file(library_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def retention_days(library_id: str) -> int:
    days = int(get_setting("history_retention_days", library_id) or 180)
    return max(1, min(days, 3650))


def _cutoff_ts(library_id: str) -> float:
    return time.time() - retention_days(library_id) * 86400


def get_entry(library_id: str, video_id: str) -> dict | None:
    with _lock:
        entry = (_load_raw(library_id).get("items") or {}).get(video_id)
    return dict(entry) if entry else None


def record_play(library_id: str, video_id: str) -> dict:
    now = time.time()
    with _lock:
        data = _load_raw(library_id)
        items = data.setdefault("items", {})
        entry = items.get(video_id) or {}
        entry["played_at"] = now
        entry["play_count"] = int(entry.get("play_count", 0)) + 1
        items[video_id] = entry
        _save_raw(library_id, data)
        return dict(entry)


def list_history_ids_sorted(library_id: str) -> list[str]:
    cutoff = _cutoff_ts(library_id)
    with _lock:
        items = _load_raw(library_id).get("items") or {}
    filtered = [
        (vid, float(entry.get("played_at", 0)))
        for vid, entry in items.items()
        if float(entry.get("played_at", 0)) >= cutoff
    ]
    filtered.sort(key=lambda x: x[1], reverse=True)
    return [vid for vid, _ in filtered]


def get_history_count(library_id: str) -> int:
    return len(list_history_ids_sorted(library_id))


def clear_history(library_id: str) -> int:
    with _lock:
        data = _load_raw(library_id)
        count = len(data.get("items") or {})
        data["items"] = {}
        _save_raw(library_id, data)
        return count


def remove_history(library_id: str, video_ids: list[str]) -> None:
    if not video_ids:
        return
    with _lock:
        data = _load_raw(library_id)
        items = data.get("items") or {}
        for vid in video_ids:
            items.pop(vid, None)
        data["items"] = items
        _save_raw(library_id, data)


def prune_missing(library_id: str, valid_ids: set[str]) -> int:
    with _lock:
        data = _load_raw(library_id)
        items = data.get("items") or {}
        before = len(items)
        data["items"] = {k: v for k, v in items.items() if k in valid_ids}
        removed = before - len(data["items"])
        if removed:
            _save_raw(library_id, data)
        return removed
