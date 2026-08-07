# -*- coding: utf-8 -*-
"""清理运行时缓存（data/logs 等），不删除缩略图与用户数据。

注：HLS 切片缓存已随 11.0 移除（movi-player 直连播放，不再切片）。
"""
from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    logs = ROOT / "data" / "logs"
    if logs.is_dir():
        shutil.rmtree(logs, ignore_errors=True)
        print("已删除 data/logs")
    # 旧版本遗留的 HLS 切片缓存目录（如有）
    hls_dir = ROOT / "data" / "hls_cache"
    if hls_dir.is_dir():
        shutil.rmtree(hls_dir, ignore_errors=True)
        print("已删除旧版 HLS 切片缓存（data/hls_cache）")
    print("保留：.thumbs、favorites.json、play_history.json、albums.json 等用户数据")


if __name__ == "__main__":
    main()
