# -*- coding: utf-8 -*-
"""分类星标、排序与自定义顺序。"""
import json
import threading
from copy import deepcopy

from avv_gallery.config import CATEGORY_META_FILE
_lock = threading.Lock()

_DEFAULTS = {
    "starred": [],
    "order": [],
    "sort_mode": "custom",
}

SORT_MODES = ("custom", "name_asc", "name_desc", "count_desc", "count_asc")


def _load_raw() -> dict:
    if CATEGORY_META_FILE.exists():
        try:
            data = json.loads(CATEGORY_META_FILE.read_text(encoding="utf-8"))
            merged = deepcopy(_DEFAULTS)
            merged.update(data)
            if merged["sort_mode"] not in SORT_MODES:
                merged["sort_mode"] = "custom"
            return merged
        except (json.JSONDecodeError, OSError):
            pass
    return deepcopy(_DEFAULTS)


def _save_raw(data: dict) -> dict:
    CATEGORY_META_FILE.parent.mkdir(parents=True, exist_ok=True)
    merged = deepcopy(_DEFAULTS)
    merged.update(data)
    if merged["sort_mode"] not in SORT_MODES:
        merged["sort_mode"] = "custom"
    CATEGORY_META_FILE.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return merged


def get_meta() -> dict:
    with _lock:
        return _load_raw()


def sort_categories(counts: dict[str, int]) -> list[dict]:
    with _lock:
        meta = _load_raw()

    starred_set = set(meta.get("starred") or [])
    order = meta.get("order") or []
    mode = meta.get("sort_mode", "custom")
    order_idx = {name: i for i, name in enumerate(order)}

    items = [
        {"name": name, "count": counts[name], "starred": name in starred_set}
        for name in counts
    ]
    starred = [i for i in items if i["starred"]]
    normal = [i for i in items if not i["starred"]]

    def _sort_group(group: list[dict]) -> list[dict]:
        if mode == "custom":
            group.sort(key=lambda x: (order_idx.get(x["name"], 10_000), x["name"].lower()))
        elif mode == "name_asc":
            group.sort(key=lambda x: x["name"].lower())
        elif mode == "name_desc":
            group.sort(key=lambda x: x["name"].lower(), reverse=True)
        elif mode == "count_desc":
            group.sort(key=lambda x: (-x["count"], x["name"].lower()))
        elif mode == "count_asc":
            group.sort(key=lambda x: (x["count"], x["name"].lower()))
        return group

    sorted_items = _sort_group(starred) + _sort_group(normal)

    # 新分类追加到 order，便于下次拖拽
    known = set(order)
    new_names = [i["name"] for i in sorted_items if i["name"] not in known]
    if new_names:
        with _lock:
            meta = _load_raw()
            meta["order"] = (meta.get("order") or []) + new_names
            _save_raw(meta)

    return sorted_items


def set_starred(name: str, starred: bool) -> dict:
    with _lock:
        meta = _load_raw()
        stars = set(meta.get("starred") or [])
        if starred:
            stars.add(name)
        else:
            stars.discard(name)
        meta["starred"] = sorted(stars)
        return _save_raw(meta)


def set_order(order: list[str]) -> dict:
    with _lock:
        meta = _load_raw()
        meta["order"] = order
        return _save_raw(meta)


def set_sort_mode(mode: str) -> dict:
    if mode not in SORT_MODES:
        raise ValueError("无效的排序方式")
    with _lock:
        meta = _load_raw()
        meta["sort_mode"] = mode
        return _save_raw(meta)
