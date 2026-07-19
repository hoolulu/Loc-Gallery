# -*- coding: utf-8 -*-
import hashlib
import threading
from dataclasses import dataclass
from pathlib import Path

from avv_gallery.config import IGNORE_DIRS, VIDEO_EXTENSIONS, VIDEO_ROOT, WEB_ROOT
from avv_gallery.file_stability import is_ready_for_index
from avv_gallery.title import extract_title


@dataclass
class VideoItem:
    id: str
    path: str
    category: str
    subfolder: str
    title: str
    filename: str
    size: int
    mtime: float


_lock = threading.Lock()
_cache: dict[str, VideoItem] = {}
_version = 0


def _make_id(rel_path: str) -> str:
    return hashlib.md5(rel_path.encode("utf-8")).hexdigest()


def _is_video(path: Path) -> bool:
    return is_ready_for_index(path)


def _should_skip_dir(path: Path) -> bool:
    return path.name in IGNORE_DIRS or path == WEB_ROOT


def scan_all() -> list[VideoItem]:
    """全量扫描视频库，仅收录视频文件。"""
    items: list[VideoItem] = []

    if not VIDEO_ROOT.exists():
        return items

    def _add_video(video_path: Path, category: str, category_dir: Path) -> None:
        rel = video_path.relative_to(VIDEO_ROOT).as_posix()
        rel_in_cat = video_path.relative_to(category_dir)
        subfolder = "" if rel_in_cat.parent == Path(".") else rel_in_cat.parent.as_posix()
        stat = video_path.stat()
        items.append(VideoItem(
            id=_make_id(rel),
            path=str(video_path),
            category=category,
            subfolder=subfolder,
            title=extract_title(video_path),
            filename=video_path.name,
            size=stat.st_size,
            mtime=stat.st_mtime,
        ))

    # 根目录下的视频（不含 WEB 子目录）
    for entry in VIDEO_ROOT.iterdir():
        if _is_video(entry):
            _add_video(entry, "根目录", VIDEO_ROOT)

    for category_dir in sorted(VIDEO_ROOT.iterdir()):
        if not category_dir.is_dir() or _should_skip_dir(category_dir):
            continue

        category = category_dir.name
        for video_path in category_dir.rglob("*"):
            if not _is_video(video_path):
                continue
            _add_video(video_path, category, category_dir)

    return items


def refresh_cache() -> int:
    """刷新内存缓存，返回新版本号。"""
    global _version
    items = scan_all()
    new_cache = {item.id: item for item in items}
    with _lock:
        _cache.clear()
        _cache.update(new_cache)
        _version += 1
        return _version


def get_version() -> int:
    with _lock:
        return _version


def get_all() -> list[VideoItem]:
    with _lock:
        return list(_cache.values())


def get_by_id(video_id: str) -> VideoItem | None:
    with _lock:
        return _cache.get(video_id)


def get_categories() -> list[dict]:
    with _lock:
        counts: dict[str, int] = {}
        has_subfolders: dict[str, bool] = {}
        for item in _cache.values():
            counts[item.category] = counts.get(item.category, 0) + 1
            if item.subfolder:
                has_subfolders[item.category] = True
    from avv_gallery.category_store import sort_categories
    cats = sort_categories(counts)
    for c in cats:
        c["has_subfolders"] = has_subfolders.get(c["name"], False)
    return cats


def get_folder_tree(category: str) -> dict:
    """返回分类下的子目录树（仅直接子级递归嵌套）。"""
    with _lock:
        items = [v for v in _cache.values() if v.category == category]

    direct_count = sum(1 for v in items if not v.subfolder)
    nested: dict = {}

    def _ensure(path: str) -> dict:
        if path in nested:
            return nested[path]
        name = path.rsplit("/", 1)[-1]
        nested[path] = {"name": name, "path": path, "direct": 0, "children": []}
        return nested[path]

    for item in items:
        if not item.subfolder:
            continue
        parts = item.subfolder.split("/")
        for i in range(len(parts)):
            path = "/".join(parts[: i + 1])
            node = _ensure(path)
            if i == len(parts) - 1:
                node["direct"] += 1

    roots: list[dict] = []
    for path, node in nested.items():
        if "/" not in path:
            roots.append(node)
        else:
            parent = path.rsplit("/", 1)[0]
            if parent in nested:
                nested[parent]["children"].append(node)

    def _sort_tree(nodes: list[dict]) -> list[dict]:
        nodes.sort(key=lambda n: n["name"].lower())
        for n in nodes:
            n["children"] = _sort_tree(n["children"])
            n["total"] = n["direct"] + sum(c["total"] for c in n["children"])
        return nodes

    roots = _sort_tree(roots)
    return {"category": category, "direct_count": direct_count, "folders": roots}
