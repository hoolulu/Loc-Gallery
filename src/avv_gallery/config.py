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

VIDEO_ROOT = Path(r"F:\AVV")

# 运行时数据目录
THUMB_DIR = DATA_DIR / ".thumbs"
HLS_CACHE_DIR = DATA_DIR / "cache" / "hls"
HLS_CACHE_MAX_BYTES = 5 * 1024 * 1024 * 1024  # 5 GB
PLAYBACK_PLANS_FILE = DATA_DIR / "cache" / "playback_plans.json"
LARGE_FILE_HLS_BYTES = 300 * 1024 * 1024  # 300 MB
THUMB_INDEX_FILE = THUMB_DIR / "index.json"
SETTINGS_FILE = DATA_DIR / "settings.json"
CATEGORY_META_FILE = DATA_DIR / "category_meta.json"
FAVORITES_FILE = DATA_DIR / "favorites.json"
HISTORY_FILE = DATA_DIR / "play_history.json"
LOG_FILE = DATA_DIR / "logs" / "server.log"
PID_FILE = DATA_DIR / ".server.pid"

PORT = 3456
HOST = "127.0.0.1"

POTPLAYER_PATH = Path("")  # 请在设置页或 data/settings.json 中配置本机路径
PLAYER_MODE = "potplayer"

THUMB_POSITION = 0.6
THUMB_RANDOM_MIN = 0.5
THUMB_RANDOM_MAX = 0.8
THUMB_WORKERS = 3
THUMB_IDLE_SCAN = False
DEFAULT_PAGE_SIZE = 32
HISTORY_RETENTION_DAYS = 180

# 未完成下载 / 写入中的文件：稳定检测参数
FILE_STABLE_CHECK_DELAY = 5.0       # 最后一次变更后等待秒数
FILE_STABLE_SAMPLE_INTERVAL = 2.0   # 稳定性采样间隔
FILE_RECENT_MODIFY_SEC = 20.0       # 启动扫描时，mtime 在此秒数内的文件先观察

VIDEO_EXTENSIONS = {
    ".mp4", ".mkv", ".avi", ".wmv", ".mov", ".flv",
    ".webm", ".m4v", ".ts", ".mpeg", ".mpg", ".3gp",
}

IGNORE_DIRS = {
    ".thumbs", "WEB", "Loc-Gallery", "AVV-Gallery", "__pycache__", ".git",
    "cache", "data", "node_modules", "src", "scripts", "tests",
}


def _migrate_legacy_data() -> None:
    """首次升级时把根目录下的运行时文件迁入 data/。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "cache" / "hls").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "logs").mkdir(parents=True, exist_ok=True)

    moves: list[tuple[Path, Path]] = [
        (WEB_ROOT / "settings.json", SETTINGS_FILE),
        (WEB_ROOT / "category_meta.json", CATEGORY_META_FILE),
        (WEB_ROOT / ".thumbs", THUMB_DIR),
        (WEB_ROOT / "cache" / "playback_plans.json", PLAYBACK_PLANS_FILE),
        (WEB_ROOT / ".server.pid", PID_FILE),
    ]
    for src, dst in moves:
        if src.exists() and not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))

    legacy_hls = WEB_ROOT / "cache" / "hls"
    if legacy_hls.exists() and legacy_hls != HLS_CACHE_DIR:
        for item in legacy_hls.iterdir():
            target = HLS_CACHE_DIR / item.name
            if not target.exists():
                shutil.move(str(item), str(target))
        try:
            legacy_hls.rmdir()
        except OSError:
            pass
        try:
            (WEB_ROOT / "cache").rmdir()
        except OSError:
            pass


_migrate_legacy_data()


def service_environ() -> dict:
    """双击启动时补全 PATH，确保子进程能找到 WinGet 安装的 ffmpeg。"""
    import os

    extra = [
        str(Path.home() / "AppData/Local/Microsoft/WinGet/Links"),
        r"C:\ffmpeg\bin",
    ]
    env = os.environ.copy()
    env["PATH"] = os.pathsep.join(extra + [env.get("PATH", "")])
    return env
