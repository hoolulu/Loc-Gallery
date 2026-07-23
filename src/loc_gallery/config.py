# -*- coding: utf-8 -*-
"""Loc Gallery 配置与路径常量。"""
from __future__ import annotations

import shutil
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
SRC_DIR = PACKAGE_DIR.parent
PROJECT_ROOT = SRC_DIR.parent
WEB_ROOT = PROJECT_ROOT
DATA_DIR = PROJECT_ROOT / "data"
LIBRARIES_FILE = DATA_DIR / "libraries.json"
LIBRARIES_ROOT = DATA_DIR / "libraries"

VIDEO_ROOT = Path(r"F:\AVV")

# 全局设置（应用级）
SETTINGS_FILE = DATA_DIR / "settings.json"
LOG_FILE = DATA_DIR / "logs" / "server.log"
PID_FILE = DATA_DIR / ".server.pid"

HLS_CACHE_MAX_BYTES = 5 * 1024 * 1024 * 1024  # 5 GB
LARGE_FILE_HLS_BYTES = 300 * 1024 * 1024  # 300 MB
HLS_LARGE_H264 = False  # 大文件 H.264 是否强制 HLS（HTML5）
HLS_MOOV_END_H264 = False  # 索引在末尾的 H.264 是否强制 HLS（HTML5）
# 碎片化 MP4：external=本地播放器（省磁盘），hls=边切边播
HTML5_FRAGMENTED_MP4 = "external"
HTML5_PLAYLIST_AUTOPLAY = True  # HTML5 播放页列表播完是否自动下一集
HTML5_RESUME_PLAYBACK = True  # HTML5 是否记忆播放位置并续播
HTML5_WHEEL_SEEK_SEC = 5  # 播放画面区滚轮每次快进/快退秒数（0=关闭）

PORT = 3456
HOST = "127.0.0.1"

POTPLAYER_PATH = Path("")
POTPLAYER_CANDIDATES = [
    Path(r"C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe"),
    Path(r"C:\Program Files\DAUM\PotPlayer\PotPlayer64.exe"),
    Path(r"D:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe"),
    Path(r"D:\Program Files\DAUM\PotPlayer\PotPlayer64.exe"),
    Path(r"C:\Program Files (x86)\DAUM\PotPlayer\PotPlayerMini.exe"),
]
PLAYER_MODE = "html5"


def detect_potplayer_path() -> str:
    """探测本机 PotPlayer 可执行文件路径。"""
    configured = str(POTPLAYER_PATH or "").strip()
    if configured:
        p = Path(configured)
        if p.is_file():
            return str(p)
    for candidate in POTPLAYER_CANDIDATES:
        if candidate.is_file():
            return str(candidate)
    return ""

THUMB_POSITION = 0.6
THUMB_RANDOM_MIN = 0.5
THUMB_RANDOM_MAX = 0.8
THUMB_WORKERS = 3
THUMB_IDLE_SCAN = False
THUMB_PROGRESS_BAR = "auto"  # auto | always | never
DEFAULT_PAGE_SIZE = 32
HISTORY_RETENTION_DAYS = 180

FILE_STABLE_CHECK_DELAY = 5.0
FILE_STABLE_SAMPLE_INTERVAL = 2.0
FILE_RECENT_MODIFY_SEC = 20.0

VIDEO_EXTENSIONS = {
    ".mp4", ".mkv", ".avi", ".wmv", ".mov", ".flv",
    ".webm", ".m4v", ".ts", ".mpeg", ".mpg", ".3gp",
}

IGNORE_DIRS = {
    ".thumbs", "WEB", "Loc-Gallery", "loc-gallery", "AVV-Gallery", "avv-gallery", "__pycache__", ".git",
    "cache", "data", "node_modules", "src", "scripts", "tests", "libraries",
}

# 兼容旧 import
THUMB_DIR = DATA_DIR / ".thumbs"
HLS_CACHE_DIR = DATA_DIR / "cache" / "hls"
PLAYBACK_PLANS_FILE = DATA_DIR / "cache" / "playback_plans.json"
THUMB_INDEX_FILE = THUMB_DIR / "index.json"
CATEGORY_META_FILE = DATA_DIR / "category_meta.json"
FAVORITES_FILE = DATA_DIR / "favorites.json"
HISTORY_FILE = DATA_DIR / "play_history.json"


def library_data_dir(library_id: str) -> Path:
    from loc_gallery.library_store import library_data_dir as _dir
    return _dir(library_id)


def favorites_file(library_id: str) -> Path:
    return library_data_dir(library_id) / "favorites.json"


def history_file(library_id: str) -> Path:
    return library_data_dir(library_id) / "play_history.json"


def category_meta_file(library_id: str) -> Path:
    return library_data_dir(library_id) / "category_meta.json"


def library_settings_file(library_id: str) -> Path:
    return library_data_dir(library_id) / "settings.json"


def thumb_dir(library_id: str) -> Path:
    return library_data_dir(library_id) / ".thumbs"


def thumb_index_file(library_id: str) -> Path:
    return thumb_dir(library_id) / "index.json"


def hls_cache_dir(library_id: str) -> Path:
    return library_data_dir(library_id) / "cache" / "hls"


def playback_plans_file(library_id: str) -> Path:
    return library_data_dir(library_id) / "cache" / "playback_plans.json"


def format_index_file(library_id: str) -> Path:
    return library_data_dir(library_id) / "cache" / "format_index.json"


def _migrate_legacy_data() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "logs").mkdir(parents=True, exist_ok=True)

    legacy_moves: list[tuple[Path, Path]] = [
        (WEB_ROOT / "settings.json", SETTINGS_FILE),
        (WEB_ROOT / ".server.pid", PID_FILE),
    ]
    for src, dst in legacy_moves:
        if src.exists() and not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))

    from loc_gallery.library_store import migrate_single_library
    migrate_single_library()


_migrate_legacy_data()


def service_environ() -> dict:
    import os

    extra = [
        str(Path.home() / "AppData/Local/Microsoft/WinGet/Links"),
        r"C:\ffmpeg\bin",
    ]
    env = os.environ.copy()
    env["PATH"] = os.pathsep.join(extra + [env.get("PATH", "")])
    return env
