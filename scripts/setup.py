# -*- coding: utf-8 -*-
"""首次安装依赖：Python 包 + 前端 npm 包。"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"
REQUIREMENTS = PROJECT_ROOT / "backend" / "requirements.txt"


def _run(cmd: list[str], *, cwd: Path | None = None) -> bool:
    print(f"  $ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=str(cwd or PROJECT_ROOT), shell=False)
    return result.returncode == 0


def python_deps_ok() -> bool:
    try:
        import fastapi  # noqa: F401
        import uvicorn  # noqa: F401
        return True
    except ImportError:
        return False


def node_deps_ok() -> bool:
    return (FRONTEND_DIR / "node_modules" / "vite" / "bin" / "vite.js").is_file()


def install_python_deps() -> bool:
    if not REQUIREMENTS.is_file():
        print(f"错误：未找到 {REQUIREMENTS}")
        return False
    print("正在安装 Python 依赖...")
    return _run([sys.executable, "-m", "pip", "install", "-r", str(REQUIREMENTS)])


def install_node_deps() -> bool:
    if not (FRONTEND_DIR / "package.json").is_file():
        print("错误：未找到 frontend/package.json")
        return False
    npm = shutil.which("npm")
    if not npm:
        print("错误：未找到 npm，请先安装 Node.js 18+")
        return False
    print("正在安装前端依赖（npm install）...")
    return _run([npm, "install"], cwd=FRONTEND_DIR)


def check_ffmpeg() -> bool:
    ok = bool(shutil.which("ffmpeg")) and bool(shutil.which("ffprobe"))
    if not ok:
        print("警告：未在 PATH 中找到 ffmpeg/ffprobe，播放与缩略图功能将不可用。")
        print("       请安装 ffmpeg 并加入系统 PATH 后重启。")
    return ok


def ensure_deps(*, need_node: bool, auto_install: bool = True) -> bool:
    """检查并在缺失时安装依赖。"""
    ok = True

    if not python_deps_ok():
        if auto_install:
            ok = install_python_deps() and ok
        else:
            print("缺少 Python 依赖，请执行：")
            print(f"  {sys.executable} -m pip install -r backend/requirements.txt")
            ok = False

    if need_node and not node_deps_ok():
        if auto_install:
            ok = install_node_deps() and ok
        else:
            print("缺少前端依赖，请执行：")
            print("  cd frontend && npm install")
            ok = False

    check_ffmpeg()
    return ok


def main() -> None:
    print("=== Loc Gallery · 环境初始化 ===\n")
    ok = ensure_deps(need_node=True, auto_install=True)
    if ok:
        print("\n依赖已就绪。运行 python restart.py 启动服务。")
    else:
        print("\n依赖安装未完成，请根据上方提示修复后重试。")
        sys.exit(1)


if __name__ == "__main__":
    main()
