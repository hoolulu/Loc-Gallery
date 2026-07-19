# -*- coding: utf-8 -*-
"""视频收藏（按库隔离）。"""
from __future__ import annotations

import json
import threading
import time

from avv_gallery.config import favorites_file

_lock = threading.Lock()


def _load_raw(library_id: str) -> dict:
    path = favorites_file(library_id)
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("items"), dict):
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return {"items": {}}


def _save_raw(library_id: str, data: dict) -> dict:
    path = favorites_file(library_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def get_favorite_ids(library_id: str) -> set[str]:
    with _lock:
        return set(_load_raw(library_id).get("items") or {})


def get_favorite_count(library_id: str) -> int:
    return len(get_favorite_ids(library_id))


def get_added_at(library_id: str, video_id: str) -> float | None:
    with _lock:
        entry = (_load_raw(library_id).get("items") or {}).get(video_id)
    if not entry:
        return None
    return float(entry.get("added_at", 0))


def is_favorite(library_id: str, video_id: str) -> bool:
    with _lock:
        return video_id in (_load_raw(library_id).get("items") or {})


def list_favorite_ids_sorted(library_id: str) -> list[str]:
    with _lock:
        items = _load_raw(library_id).get("items") or {}
    return sorted(items.keys(), key=lambda vid: float(items[vid].get("added_at", 0)), reverse=True)


def toggle_favorite(library_id: str, video_id: str) -> bool:
    with _lock:
        data = _load_raw(library_id)
        items = data.setdefault("items", {})
        if video_id in items:
            del items[video_id]
            _save_raw(library_id, data)
            return False
        items[video_id] = {"added_at": time.time()}
        _save_raw(library_id, data)
        return True


def batch_favorites(library_id: str, video_ids: list[str], action: str) -> dict:
    add = action == "add"
    changed = 0
    skipped = 0
    with _lock:
        data = _load_raw(library_id)
        items = data.setdefault("items", {})
        now = time.time()
        for vid in video_ids:
            if not vid:
                continue
            if add:
                if vid in items:
                    skipped += 1
                else:
                    items[vid] = {"added_at": now}
                    changed += 1
            else:
                if vid in items:
                    del items[vid]
                    changed += 1
                else:
                    skipped += 1
        if changed:
            _save_raw(library_id, data)
    return {"changed": changed, "skipped": skipped, "count": len(items)}


def remove_favorites(library_id: str, video_ids: list[str]) -> None:
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
