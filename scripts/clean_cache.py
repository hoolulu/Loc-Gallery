# -*- coding: utf-8 -*-
"""清理运行时缓存（HLS 切片、data/logs），不删除缩略图与用户数据。"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend" / "src"))

from loc_gallery import hls_manager  # noqa: E402


def main() -> None:
    n = hls_manager.purge_all_hls_caches()
    logs = ROOT / "data" / "logs"
    if logs.is_dir():
        import shutil

        shutil.rmtree(logs, ignore_errors=True)
        print(f"已删除 data/logs")
    print(f"已清空 {n} 个视频库的 HLS 切片缓存")
    print("保留：.thumbs、favorites.json、play_history.json、albums.json 等用户数据")


if __name__ == "__main__":
    main()
