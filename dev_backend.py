# -*- coding: utf-8 -*-
"""开发模式启动后端（端口 3458，不构建前端）。"""
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

from service import start_service, stop_service  # noqa: E402

os.environ["LOC_GALLERY_PORT"] = "3458"


def main():
    os.chdir(PROJECT_ROOT)
    print("=== Loc Gallery Vue · 开发后端 :3458 ===\n")
    stop_service()
    print()
    pid = start_service()
    if pid:
        print("开发前端: cd frontend && npm run dev  (http://127.0.0.1:3457)")
        input("\n按 Enter 键关闭此窗口...")
    else:
        input("\n启动失败，按 Enter 键关闭...")


if __name__ == "__main__":
    main()
