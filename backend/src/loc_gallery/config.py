# -*- coding: utf-8 -*-
"""Loc Gallery 配置与路径常量。"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
SRC_DIR = PACKAGE_DIR.parent
BACKEND_ROOT = SRC_DIR.parent
PROJECT_ROOT = BACKEND_ROOT.parent
WEB_ROOT = PROJECT_ROOT
DATA_DIR = PROJECT_ROOT / "data"
LIBRARIES_FILE = DATA_DIR / "libraries.json"
LIBRARIES_ROOT = DATA_DIR / "libraries"

VIDEO_ROOT = Path(r"F:\AVV")

# 全局设置（应用级）
SETTINGS_FILE = DATA_DIR / "settings.json"
LOG_FILE = PROJECT_ROOT / "logs" / "server.log"
PID_FILE = PROJECT_ROOT / ".server.pid"

HTML5_PLAYLIST_AUTOPLAY = True  # HTML5 播放页列表播完是否自动下一集
HTML5_RESUME_PLAYBACK = True  # HTML5 是否记忆播放位置并续播
HTML5_WHEEL_SEEK_SEC = 5  # 播放画面区滚轮每次快进/快退秒数（0=关闭）
HTML5_PLAYER_PREV_KEY = "."  # 播放页上一个
HTML5_PLAYER_NEXT_KEY = "/"  # 播放页下一个
# movi-player 内置键盘快捷键（空格/方向键/z/x 等）。与油猴等全局快捷键脚本冲突时设 False
# 关闭后键位完全交给宿主脚本接管（on-screen 控件不受影响，仅键盘失效）
HTML5_DISABLE_MOVI_HOTKEYS = True
# 悬停缩略图多段视频预览（原生 <video> 直连 Range 流，无切片/无预生成；False 关闭）
HTML5_HOVER_PREVIEW = True
# 预览蒙太奇：段数（在 15%~85% 区间均匀分布）与每段秒数
HTML5_HOVER_PREVIEW_SEGMENTS = 5
HTML5_HOVER_PREVIEW_SEGMENT_SEC = 5
# 悬停预览浮层是否「钉住」：True=移开鼠标不自动消失，需点关闭按钮；False=移开自动消失（默认）
HTML5_HOVER_TIP_PIN = False
# 进度条悬停显示时间点截图（movi-player 原生 thumb：WASM 解码目标帧，零预生成/零磁盘）
HTML5_SEEK_PREVIEW = True
# 后台空闲时自动批量重封装 remuxable 文件（多段 mdat/碎片化 MP4 一次修复永久直连）
HTML5_AUTO_REMUX = True

PORT = int(os.environ.get("LOC_GALLERY_PORT", "3460"))
HOST = "127.0.0.1"

# 外部播放器（浏览器无法硬解的编码如 mpeg2/vc1/wmv 时兜底调用；默认自动检测 PotPlayer）
EXTERNAL_PLAYER_PATH = Path("")
EXTERNAL_PLAYER_CANDIDATES = [
    Path(r"C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe"),
    Path(r"C:\Program Files\DAUM\PotPlayer\PotPlayer64.exe"),
    Path(r"D:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe"),
    Path(r"D:\Program Files\DAUM\PotPlayer\PotPlayer64.exe"),
    Path(r"C:\Program Files (x86)\DAUM\PotPlayer\PotPlayerMini.exe"),
]


def detect_external_player_path() -> str:
    """探测本机外部播放器可执行文件路径（默认找 PotPlayer，可被用户配置覆盖）。"""
    configured = str(EXTERNAL_PLAYER_PATH or "").strip()
    if configured:
        p = Path(configured)
        if p.is_file():
            return str(p)
    for candidate in EXTERNAL_PLAYER_CANDIDATES:
        if candidate.is_file():
            return str(candidate)
    return ""

THUMB_POSITION = 0.6
THUMB_RANDOM_MIN = 0.5  # legacy, no longer used
THUMB_RANDOM_MAX = 0.8  # legacy, no longer used
THUMB_WORKERS = 3
THUMB_IDLE_SCAN = False
THUMB_PROGRESS_BAR = "auto"  # auto | always | never
THUMB_CANDIDATE_COUNT = 6    # 3-12
THUMB_AUTO_SELECT_BEST = False  # auto-pick best in single picker
THUMB_BATCH_AUTO_SELECT = True  # auto-pick best in batch mode
THUMB_JITTER_PCT = 10  # ± random offset for "换一组" (5-15%)
THUMB_JITTER_MIN = 6   # minimum position percentage (3-12)
THUMB_JITTER_MAX = 94  # maximum position percentage (88-97)
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


def albums_file(library_id: str) -> Path:
    return library_data_dir(library_id) / "albums.json"


def library_settings_file(library_id: str) -> Path:
    return library_data_dir(library_id) / "settings.json"


def thumb_dir(library_id: str) -> Path:
    return library_data_dir(library_id) / ".thumbs"


def thumb_index_file(library_id: str) -> Path:
    return thumb_dir(library_id) / "index.json"


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
