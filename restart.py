# -*- coding: utf-8 -*-
"""双击重启 Loc Gallery 服务（先停再起）。"""
import os
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT / "src"))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

from service import open_browser, start_service, stop_service  # noqa: E402


def main():
    os.chdir(PROJECT_ROOT)
    print("=== Loc Gallery · 一键重启 ===\n")
    stop_service()
    print()
    pid = start_service()
    if pid:
        open_browser(cache_bust=True)
        print("浏览器已打开。")
        print("5 秒后自动关闭此窗口...")
        time.sleep(5)
        return
    input("\n按 Enter 键关闭此窗口...")


if __name__ == "__main__":
    main()
