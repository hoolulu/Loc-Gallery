# -*- coding: utf-8 -*-
"""一键启动 Loc Gallery（单端口 :3460，Vite 热更新）。"""

import os
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"

sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

from ports import APP_URL  # noqa: E402
from service import start_dev, start_production, stop_all  # noqa: E402
from setup import ensure_deps  # noqa: E402


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


def main() -> None:
    os.chdir(PROJECT_ROOT)
    production = "--build" in sys.argv or "--prod" in sys.argv
    auto_setup = "--no-setup" not in sys.argv

    if not ensure_deps(need_node=True, auto_install=auto_setup):
        print("\n可手动执行：python scripts/setup.py")
        input("\n按 Enter 键关闭...")
        return

    if production:
        print("=== Loc Gallery · 生产构建模式 ===\n")
        if not build_frontend():
            input("\n按 Enter 键关闭...")
            return
        stop_all()
        ok = start_production()
    else:
        print("=== Loc Gallery · 开发模式（单端口）===\n")
        stop_all()
        ok = start_dev()

    if ok:
        webbrowser.open(f"{APP_URL}/?boot={int(time.time())}")
        print("浏览器已打开。")
        print("5 秒后自动关闭此窗口...")
        time.sleep(5)
        return

    input("\n启动失败，按 Enter 键关闭此窗口...")


if __name__ == "__main__":
    main()
