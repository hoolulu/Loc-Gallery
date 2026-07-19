# -*- coding: utf-8 -*-
"""多视频库注册表：路径、别名、激活状态与数据目录。"""
from __future__ import annotations

import json
import re
import shutil
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from avv_gallery.config import DATA_DIR, IGNORE_DIRS, LIBRARIES_FILE, LIBRARIES_ROOT, PROJECT_ROOT, VIDEO_ROOT

_lock = threading.RLock()
DEFAULT_LIBRARY_ID = "lib-default"

_ALIAS_RE = re.compile(r"[^\w\u4e00-\u9fff\- ]+", re.UNICODE)


@dataclass
class Library:
    id: str
    alias: str
    path: str
    created_at: float
    order: int

    @property
    def path_obj(self) -> Path:
        return Path(self.path)

    def exists(self) -> bool:
        return self.path_obj.is_dir()

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "alias": self.alias,
            "path": self.path,
            "created_at": self.created_at,
            "order": self.order,
            "exists": self.exists(),
        }


def _normalize_path(path: str | Path) -> Path:
    return Path(path).expanduser().resolve()


def library_data_dir(library_id: str) -> Path:
    return LIBRARIES_ROOT / library_id


def _settings_file(library_id: str) -> Path:
    return library_data_dir(library_id) / "settings.json"


def _ensure_library_layout(library_id: str) -> Path:
    root = library_data_dir(library_id)
    (root / ".thumbs").mkdir(parents=True, exist_ok=True)
    (root / "cache" / "hls").mkdir(parents=True, exist_ok=True)
    return root


def _load_raw() -> dict:
    if not LIBRARIES_FILE.exists():
        return {"version": 1, "active_library_id": DEFAULT_LIBRARY_ID, "libraries": []}
    try:
        data = json.loads(LIBRARIES_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("libraries"), list):
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return {"version": 1, "active_library_id": DEFAULT_LIBRARY_ID, "libraries": []}


def _save_raw(data: dict) -> None:
    LIBRARIES_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = LIBRARIES_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(LIBRARIES_FILE)


def _parse_library(entry: dict) -> Library | None:
    if not isinstance(entry, dict):
        return None
    lib_id = str(entry.get("id") or "").strip()
    alias = str(entry.get("alias") or "").strip()
    path = str(entry.get("path") or "").strip()
    if not lib_id or not alias or not path:
        return None
    return Library(
        id=lib_id,
        alias=alias,
        path=path,
        created_at=float(entry.get("created_at") or 0),
        order=int(entry.get("order") or 0),
    )


def _validate_alias(alias: str) -> str:
    cleaned = alias.strip()
    if not cleaned:
        raise ValueError("别名不能为空")
    if len(cleaned) > 64:
        raise ValueError("别名不能超过 64 个字符")
    return cleaned


def _validate_path(path: str, *, exclude_id: str | None = None) -> str:
    resolved = _normalize_path(path)
    if resolved.name in IGNORE_DIRS:
        raise ValueError("不能将项目或系统目录设为视频库")
    try:
        resolved.relative_to(PROJECT_ROOT.resolve())
        if resolved == PROJECT_ROOT.resolve() or PROJECT_ROOT.resolve() in resolved.parents:
            raise ValueError("不能将项目目录设为视频库")
    except ValueError as exc:
        if "不能将项目目录" in str(exc):
            raise
    for lib in list_libraries():
        if exclude_id and lib.id == exclude_id:
            continue
        if _normalize_path(lib.path) == resolved:
            raise ValueError("该路径已被其他视频库使用")
    return str(resolved)


def _new_library_id() -> str:
    return f"lib-{uuid.uuid4().hex[:8]}"


def _thumb_jpg_count(path: Path) -> int:
    if not path.exists():
        return 0
    return len(list(path.glob("*.jpg")))


def _file_count(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(1 for p in path.rglob("*") if p.is_file())


def _merge_dir_contents(src: Path, dst: Path) -> None:
    """将 src 下内容迁入 dst（同名已存在则递归合并目录）。"""
    if not src.exists():
        return
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        target = dst / item.name
        if target.exists():
            if item.is_dir() and target.is_dir():
                _merge_dir_contents(item, target)
            continue
        shutil.move(str(item), str(target))
    try:
        if src.is_dir() and not any(src.iterdir()):
            src.rmdir()
    except OSError:
        pass


def repair_legacy_library_assets(library_id: str = DEFAULT_LIBRARY_ID) -> bool:
    """补迁旧版 data/ 扁平目录中遗留的缩略图与缓存。

    多库升级时若已创建空的 lib-default/.thumbs，首次 migrate 会跳过整体搬迁，
    导致缩略图仍留在 data/.thumbs 而被判定为失败/缺失。
    """
    dest = _ensure_library_layout(library_id)
    changed = False

    legacy_thumbs = DATA_DIR / ".thumbs"
    dest_thumbs = dest / ".thumbs"
    legacy_n = _thumb_jpg_count(legacy_thumbs)
    dest_n = _thumb_jpg_count(dest_thumbs)
    if legacy_n > dest_n:
        if dest_n == 0 and legacy_thumbs.is_dir():
            if dest_thumbs.exists():
                shutil.rmtree(dest_thumbs, ignore_errors=True)
            shutil.move(str(legacy_thumbs), str(dest_thumbs))
        else:
            _merge_dir_contents(legacy_thumbs, dest_thumbs)
        changed = True

    legacy_cache = DATA_DIR / "cache"
    dest_cache = dest / "cache"
    if legacy_cache.exists() and _file_count(legacy_cache) > _file_count(dest_cache):
        _merge_dir_contents(legacy_cache, dest_cache)
        changed = True

    for src, dst in [
        (DATA_DIR / "favorites.json", dest / "favorites.json"),
        (DATA_DIR / "play_history.json", dest / "play_history.json"),
        (DATA_DIR / "category_meta.json", dest / "category_meta.json"),
        (DATA_DIR / "settings.json", dest / "settings.json"),
    ]:
        if src.exists() and not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
            changed = True

    return changed


def migrate_single_library() -> None:
    """将旧版单库 data/ 扁平结构迁入 data/libraries/lib-default/。"""
    if LIBRARIES_FILE.exists():
        repair_legacy_library_assets()
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    lib_id = DEFAULT_LIBRARY_ID
    dest = _ensure_library_layout(lib_id)

    moves: list[tuple[Path, Path]] = [
        (DATA_DIR / "favorites.json", dest / "favorites.json"),
        (DATA_DIR / "play_history.json", dest / "play_history.json"),
        (DATA_DIR / "category_meta.json", dest / "category_meta.json"),
        (DATA_DIR / "settings.json", dest / "settings.json"),
        (DATA_DIR / ".thumbs", dest / ".thumbs"),
        (DATA_DIR / "cache", dest / "cache"),
    ]
    for src, dst in moves:
        if not src.exists():
            continue
        if dst.exists():
            if dst.is_dir() and not any(dst.iterdir()):
                shutil.rmtree(dst, ignore_errors=True)
                shutil.move(str(src), str(dst))
            else:
                _merge_dir_contents(src, dst)
        else:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))

    root = VIDEO_ROOT if VIDEO_ROOT else Path(r"F:\AVV")
    try:
        root = root.resolve()
    except OSError:
        root = Path(str(root))
    alias = root.name if root.name else "默认库"

    payload = {
        "version": 1,
        "active_library_id": lib_id,
        "libraries": [
            {
                "id": lib_id,
                "alias": alias,
                "path": str(root),
                "created_at": time.time(),
                "order": 0,
            }
        ],
    }
    _save_raw(payload)


def list_libraries() -> list[Library]:
    with _lock:
        data = _load_raw()
        libs = [_parse_library(x) for x in data.get("libraries") or []]
        libs = [x for x in libs if x is not None]
        libs.sort(key=lambda x: (x.order, x.alias.lower()))
        return libs


def get_library(library_id: str) -> Library | None:
    for lib in list_libraries():
        if lib.id == library_id:
            return lib
    return None


def get_active_library_id() -> str:
    with _lock:
        data = _load_raw()
        active = str(data.get("active_library_id") or "").strip()
        libs = [_parse_library(x) for x in data.get("libraries") or []]
        libs = [x for x in libs if x is not None]
        if active and any(x.id == active for x in libs):
            return active
        if libs:
            return libs[0].id
        return DEFAULT_LIBRARY_ID


def get_active_library() -> Library:
    lib = get_library(get_active_library_id())
    if lib:
        return lib
    migrate_single_library()
    lib = get_library(DEFAULT_LIBRARY_ID)
    if lib:
        return lib
    raise RuntimeError("未配置任何视频库")


def set_active_library(library_id: str) -> Library:
    if not get_library(library_id):
        raise ValueError("视频库不存在")
    with _lock:
        data = _load_raw()
        data["active_library_id"] = library_id
        _save_raw(data)
    return get_library(library_id)  # type: ignore[return-value]


def add_library(alias: str, path: str) -> Library:
    alias = _validate_alias(alias)
    norm_path = _validate_path(path)
    with _lock:
        data = _load_raw()
        libs = data.setdefault("libraries", [])
        lib_id = _new_library_id()
        order = max((int(x.get("order") or 0) for x in libs), default=-1) + 1
        entry = {
            "id": lib_id,
            "alias": alias,
            "path": norm_path,
            "created_at": time.time(),
            "order": order,
        }
        libs.append(entry)
        if len(libs) == 1:
            data["active_library_id"] = lib_id
        _save_raw(data)
    _ensure_library_layout(lib_id)
    return get_library(lib_id)  # type: ignore[return-value]


def update_library(
    library_id: str,
    *,
    alias: str | None = None,
    path: str | None = None,
) -> Library:
    lib = get_library(library_id)
    if not lib:
        raise ValueError("视频库不存在")
    with _lock:
        data = _load_raw()
        for entry in data.get("libraries") or []:
            if entry.get("id") != library_id:
                continue
            if alias is not None:
                entry["alias"] = _validate_alias(alias)
            if path is not None:
                entry["path"] = _validate_path(path, exclude_id=library_id)
            _save_raw(data)
            break
    return get_library(library_id)  # type: ignore[return-value]


def remove_library(library_id: str, *, delete_data: bool = False) -> None:
    with _lock:
        data = _load_raw()
        libs = data.get("libraries") or []
        if len(libs) <= 1:
            raise ValueError("至少保留一个视频库")
        if not any(x.get("id") == library_id for x in libs):
            raise ValueError("视频库不存在")
        data["libraries"] = [x for x in libs if x.get("id") != library_id]
        if data.get("active_library_id") == library_id:
            data["active_library_id"] = data["libraries"][0]["id"]
        _save_raw(data)
    if delete_data:
        shutil.rmtree(library_data_dir(library_id), ignore_errors=True)


def pick_folder_windows() -> str | None:
    """Windows 原生文件夹选择对话框（仅本机服务可用）。"""
    import sys
    if sys.platform != "win32":
        raise OSError("文件夹选择器仅支持 Windows")
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError as exc:
        raise OSError("无法加载 tkinter 文件夹选择器") from exc
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        selected = filedialog.askdirectory(title="选择视频库文件夹")
    finally:
        root.destroy()
    if not selected:
        return None
    return str(_normalize_path(selected))
