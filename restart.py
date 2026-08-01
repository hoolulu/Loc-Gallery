# -*- coding: utf-8 -*-

"""双击重启 Loc Gallery Vue 服务（先停后起，生产模式）。"""

import os

import subprocess

import sys

import time

from pathlib import Path



PROJECT_ROOT = Path(__file__).resolve().parent

FRONTEND_DIR = PROJECT_ROOT / "frontend"

sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

from ports import PRODUCTION_PORT, PRODUCTION_URL  # noqa: E402
from service import start_service, stop_service  # noqa: E402

APP_URL = PRODUCTION_URL





def build_frontend() -> bool:

    print("正在构建前端...")

    if not (FRONTEND_DIR / "package.json").is_file():

        print("错误：未找到 frontend/package.json")

        return False

    result = subprocess.run(

        ["npm", "run", "build"],

        cwd=str(FRONTEND_DIR),

        shell=True,

    )

    if result.returncode != 0:

        print("前端构建失败")

        return False

    print("前端构建完成\n")

    return True





def main():

    os.chdir(PROJECT_ROOT)

    os.environ["LOC_GALLERY_PORT"] = str(PRODUCTION_PORT)

    print("=== Loc Gallery Vue · 一键重启（生产模式）===\n")

    if not build_frontend():

        input("\n按 Enter 键关闭此窗口...")

        return

    stop_service()

    print()

    pid = start_service()

    if pid:

        import webbrowser



        webbrowser.open(f"{APP_URL}/?boot={int(time.time())}")

        print(f"浏览器已打开: {APP_URL}")

        print(f"（后端托管 frontend/dist，端口 {PRODUCTION_PORT}）")

        print("5 秒后自动关闭此窗口...")

        time.sleep(5)

        return

    input("\n按 Enter 键关闭此窗口...")





if __name__ == "__main__":

    main()

