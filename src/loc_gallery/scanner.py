# -*- coding: utf-8 -*-
import hashlib
import threading
from dataclasses import dataclass
from pathlib import Path

from loc_gallery.config import IGNORE_DIRS, VIDEO_EXTENSIONS, WEB_ROOT
from loc_gallery.file_stability import is_ready_for_index
from loc_gallery import title as title_mod


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
    library_id: str = ""


_lock = threading.Lock()
_caches: dict[str, dict[str, VideoItem]] = {}
_versions: dict[str, int] = {}


def _make_id(rel_path: str) -> str:
    return hashlib.md5(rel_path.encode("utf-8")).hexdigest()


def _is_video(path: Path) -> bool:
    return is_ready_for_index(path)


def _should_skip_dir(path: Path) -> bool:
    return path.name in IGNORE_DIRS or path == WEB_ROOT


def scan_all(video_root: Path, library_id: str) -> list[VideoItem]:
    items: list[VideoItem] = []
    video_root = video_root.resolve()

    if not video_root.exists():
        return items

    def _add_video(video_path: Path, category: str, category_dir: Path) -> None:
        rel = video_path.relative_to(video_root).as_posix()
        rel_in_cat = video_path.relative_to(category_dir)
        subfolder = "" if rel_in_cat.parent == Path(".") else rel_in_cat.parent.as_posix()
        stat = video_path.stat()
        items.append(VideoItem(
            id=_make_id(rel),
            path=str(video_path),
            category=category,
            subfolder=subfolder,
            title=title_mod.extract_title(video_path),
            filename=video_path.name,
            size=stat.st_size,
            mtime=stat.st_mtime,
            library_id=library_id,
        ))

    try:
        for entry in video_root.iterdir():
            if _is_video(entry):
                _add_video(entry, "根目录", video_root)
    except OSError:
        return items

    try:
        for category_dir in sorted(video_root.iterdir()):
            if not category_dir.is_dir() or _should_skip_dir(category_dir):
                continue
            category = category_dir.name
            for video_path in category_dir.rglob("*"):
                if not _is_video(video_path):
                    continue
                _add_video(video_path, category, category_dir)
    except OSError:
        pass

    return items


def refresh_cache(library_id: str, video_root: Path | None = None) -> int:
    import importlib

    importlib.reload(title_mod)
    if video_root is None:
        from loc_gallery.library_store import get_library
        lib = get_library(library_id)
        if not lib:
            raise ValueError("视频库不存在")
        video_root = lib.path_obj
    items = scan_all(video_root, library_id)
    new_cache = {item.id: item for item in items}
    with _lock:
        _caches[library_id] = new_cache
        _versions[library_id] = _versions.get(library_id, 0) + 1
        return _versions[library_id]


def refresh_all_libraries() -> None:
    from loc_gallery.library_store import list_libraries
    for lib in list_libraries():
        refresh_cache(lib.id, lib.path_obj)


def bump_library_version(library_id: str) -> int:
    """仅递增版本号（供 SSE / 前端刷新），不触发全库扫描。"""
    with _lock:
        _versions[library_id] = _versions.get(library_id, 0) + 1
        return _versions[library_id]


def refresh_video_item_stat(library_id: str, video_id: str) -> bool:
    """重封装等原地替换后，更新缓存中的 size/mtime。"""
    with _lock:
        item = (_caches.get(library_id) or {}).get(video_id)
        if not item:
            return False
        path = Path(item.path)
    try:
        st = path.stat()
    except OSError:
        return False
    with _lock:
        item = (_caches.get(library_id) or {}).get(video_id)
        if not item:
            return False
        item.size = st.st_size
        item.mtime = st.st_mtime
        _versions[library_id] = _versions.get(library_id, 0) + 1
        return True


def get_version(library_id: str) -> int:
    with _lock:
        return _versions.get(library_id, 0)


def get_all(library_id: str) -> list[VideoItem]:
    with _lock:
        return list((_caches.get(library_id) or {}).values())


def get_by_id(library_id: str, video_id: str) -> VideoItem | None:
    with _lock:
        return (_caches.get(library_id) or {}).get(video_id)


def get_categories(library_id: str) -> list[dict]:
    with _lock:
        cache = _caches.get(library_id) or {}
        counts: dict[str, int] = {}
        has_subfolders: dict[str, bool] = {}
        for item in cache.values():
            counts[item.category] = counts.get(item.category, 0) + 1
            if item.subfolder:
                has_subfolders[item.category] = True
    from loc_gallery.category_store import sort_categories
    cats = sort_categories(library_id, counts)
    for c in cats:
        c["has_subfolders"] = has_subfolders.get(c["name"], False)
    return cats


def get_folder_tree(library_id: str, category: str) -> dict:
    with _lock:
        items = [v for v in (_caches.get(library_id) or {}).values() if v.category == category]

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
