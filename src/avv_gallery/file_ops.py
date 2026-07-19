# -*- coding: utf-8 -*-
"""视频文件操作：删除到回收站、重命名、移动。"""
import ctypes
import re
import shutil
import sys
from ctypes import wintypes
from pathlib import Path

from avv_gallery.config import IGNORE_DIRS
from avv_gallery.library_store import get_library
from avv_gallery.scanner import VideoItem, get_by_id, refresh_cache

_INVALID_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _video_root(library_id: str) -> Path:
    lib = get_library(library_id)
    if not lib:
        raise ValueError("视频库不存在")
    return lib.path_obj.resolve()


def _resolve_under_root(library_id: str, path: Path) -> Path:
    root = _video_root(library_id)
    resolved = path.resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError("路径越界")
    return resolved


def _category_dir(library_id: str, category: str) -> Path:
    root = _video_root(library_id)
    if category in ("", "根目录"):
        return root
    dest = root / category
    if dest.name in IGNORE_DIRS:
        raise ValueError("不能移动到系统目录")
    return dest


def _sanitize_name(name: str) -> str:
    cleaned = _INVALID_CHARS.sub("_", name.strip())
    cleaned = cleaned.strip(". ")
    if not cleaned:
        raise ValueError("名称不能为空")
    return cleaned


def _send_to_recycle_bin(library_id: str, path: Path) -> None:
    if sys.platform != "win32":
        raise OSError("仅支持 Windows 回收站删除")

    FO_DELETE = 0x0003
    FOF_ALLOWUNDO = 0x0040
    FOF_NOCONFIRMATION = 0x0010
    FOF_SILENT = 0x0004

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [
            ("hwnd", wintypes.HWND),
            ("wFunc", wintypes.UINT),
            ("pFrom", wintypes.LPCWSTR),
            ("pTo", wintypes.LPCWSTR),
            ("fFlags", wintypes.WORD),
            ("fAnyOperationsAborted", wintypes.BOOL),
            ("hNameMappings", wintypes.LPVOID),
            ("lpszProgressTitle", wintypes.LPCWSTR),
        ]

    src = str(_resolve_under_root(library_id, path)) + "\0\0"
    op = SHFILEOPSTRUCTW()
    op.wFunc = FO_DELETE
    op.pFrom = src
    op.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT
    result = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
    if result != 0 or op.fAnyOperationsAborted:
        raise OSError(f"删除到回收站失败 (code={result})")


def delete_videos(library_id: str, video_ids: list[str]) -> dict:
    deleted: list[str] = []
    errors: list[dict] = []

    for vid in video_ids:
        item = get_by_id(library_id, vid)
        if not item:
            errors.append({"id": vid, "error": "视频不存在"})
            continue
        try:
            path = _resolve_under_root(library_id, Path(item.path))
            if not path.exists():
                errors.append({"id": vid, "error": "文件已不存在"})
                continue
            _send_to_recycle_bin(library_id, path)
            deleted.append(vid)
        except OSError as exc:
            errors.append({"id": vid, "error": str(exc)})

    if deleted:
        refresh_cache(library_id)
    return {"deleted": deleted, "errors": errors}


def rename_video(library_id: str, video_id: str, new_name: str) -> VideoItem:
    item = get_by_id(library_id, video_id)
    if not item:
        raise ValueError("视频不存在")

    old_path = _resolve_under_root(library_id, Path(item.path))
    if not old_path.exists():
        raise ValueError("文件不存在")

    stem = _sanitize_name(new_name)
    if stem.lower() == old_path.stem.lower():
        return item

    new_path = old_path.with_name(f"{stem}{old_path.suffix}")
    if new_path.exists():
        raise ValueError("同名文件已存在")

    old_path.rename(new_path)
    refresh_cache(library_id)

    for v in get_all(library_id):
        if v.path == str(new_path):
            return v
    raise RuntimeError("重命名后未找到视频")


def move_videos(library_id: str, video_ids: list[str], category: str) -> dict:
    dest_dir = _category_dir(library_id, category)
    dest_dir = _resolve_under_root(library_id, dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)

    moved: list[dict] = []
    errors: list[dict] = []

    for vid in video_ids:
        item = get_by_id(library_id, vid)
        if not item:
            errors.append({"id": vid, "error": "视频不存在"})
            continue
        try:
            src = _resolve_under_root(library_id, Path(item.path))
            if not src.exists():
                errors.append({"id": vid, "error": "文件不存在"})
                continue
            if src.parent.resolve() == dest_dir.resolve():
                errors.append({"id": vid, "error": "已在目标分类"})
                continue

            dest = dest_dir / src.name
            if dest.exists():
                errors.append({"id": vid, "error": f"目标已存在: {src.name}"})
                continue

            shutil.move(str(src), str(dest))
            refresh_cache(library_id)

            new_item = next((v for v in get_all(library_id) if v.path == str(dest)), None)
            moved.append({
                "old_id": vid,
                "new_id": new_item.id if new_item else None,
                "path": str(dest),
                "category": category if category not in ("", "根目录") else "根目录",
            })
        except (OSError, ValueError) as exc:
            errors.append({"id": vid, "error": str(exc)})

    return {"moved": moved, "errors": errors}


def get_all(library_id: str):
    from avv_gallery.scanner import get_all as _get_all
    return _get_all(library_id)
