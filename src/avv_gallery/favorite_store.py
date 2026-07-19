# -*- coding: utf-8 -*-
"""视频收藏（服务端持久化）。"""
from __future__ import annotations

import json
import threading
import time
from copy import deepcopy

from avv_gallery.config import FAVORITES_FILE

_lock = threading.Lock()


def _load_raw() -> dict:
    if FAVORITES_FILE.exists():
        try:
            data = json.loads(FAVORITES_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("items"), dict):
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return {"items": {}}


def _save_raw(data: dict) -> dict:
    FAVORITES_FILE.parent.mkdir(parents=True, exist_ok=True)
    FAVORITES_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return data


def get_favorite_ids() -> set[str]:
    with _lock:
        return set(_load_raw().get("items") or {})


def get_favorite_count() -> int:
    return len(get_favorite_ids())


def get_added_at(video_id: str) -> float | None:
    with _lock:
        entry = (_load_raw().get("items") or {}).get(video_id)
    if not entry:
        return None
    return float(entry.get("added_at", 0))


def is_favorite(video_id: str) -> bool:
    with _lock:
        return video_id in (_load_raw().get("items") or {})


def list_favorite_ids_sorted() -> list[str]:
    with _lock:
        items = _load_raw().get("items") or {}
    return sorted(items.keys(), key=lambda vid: float(items[vid].get("added_at", 0)), reverse=True)


def toggle_favorite(video_id: str) -> bool:
    with _lock:
        data = _load_raw()
        items = data.setdefault("items", {})
        if video_id in items:
            del items[video_id]
            _save_raw(data)
            return False
        items[video_id] = {"added_at": time.time()}
        _save_raw(data)
        return True


def batch_favorites(video_ids: list[str], action: str) -> dict:
    add = action == "add"
    changed = 0
    skipped = 0
    with _lock:
        data = _load_raw()
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
            _save_raw(data)
    return {"changed": changed, "skipped": skipped, "count": len(items)}


def remove_favorites(video_ids: list[str]) -> None:
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
