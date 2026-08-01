# -*- coding: utf-8 -*-
"""服务启停：开发模式（Vite :3460 + 内部 API）与可选生产构建。"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"
SRC_DIR = PROJECT_ROOT / "backend" / "src"
VITE_PID_FILE = PROJECT_ROOT / ".vite.pid"
VITE_LOG_FILE = PROJECT_ROOT / "logs" / "vite.log"

if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from loc_gallery.config import HOST, LOG_FILE, PID_FILE, service_environ  # noqa: E402
from loc_gallery.process_util import hidden_subprocess_kwargs  # noqa: E402
from ports import API_PORT, API_URL, APP_PORT, APP_URL  # noqa: E402


def _daemon_popen_kwargs() -> dict:
    """后台子进程：无控制台窗口，关闭 restart 窗口不影响服务。"""
    kwargs: dict = {
        "stdin": subprocess.DEVNULL,
        "close_fds": True,
    }
    if sys.platform == "win32":
        kwargs.update(hidden_subprocess_kwargs())
        flags = kwargs.get("creationflags", 0) | subprocess.DETACHED_PROCESS
        kwargs["creationflags"] = flags
    return kwargs


def _vite_command() -> list[str] | None:
    vite_js = FRONTEND_DIR / "node_modules" / "vite" / "bin" / "vite.js"
    if not vite_js.is_file():
        return None
    node = shutil.which("node")
    if not node:
        return None
    return [node, str(vite_js)]


def is_running(pid: int) -> bool:
    if sys.platform == "win32":
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}"],
            capture_output=True,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return str(pid) in result.stdout
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def read_pid(path: Path = PID_FILE) -> int | None:
    if not path.exists():
        return None
    try:
        return int(path.read_text(encoding="utf-8").strip())
    except (ValueError, OSError):
        return None


def port_in_use(port: int) -> bool:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((HOST, port)) == 0


def kill_pid(pid: int, *, tree: bool = False) -> None:
    if sys.platform == "win32":
        args = ["taskkill", "/PID", str(pid), "/F"]
        if tree:
            args.append("/T")
        subprocess.run(
            args,
            capture_output=True,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    else:
        try:
            os.kill(pid, 15)
        except OSError:
            pass


def kill_port_listeners(port: int) -> None:
    if sys.platform != "win32":
        return
    result = subprocess.run(
        ["netstat", "-ano"],
        capture_output=True,
        text=True,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    pids: set[int] = set()
    for line in result.stdout.splitlines():
        if f":{port}" not in line or "LISTENING" not in line:
            continue
        parts = line.split()
        if parts and parts[-1].isdigit():
            pids.add(int(parts[-1]))
    for pid in pids:
        kill_pid(pid, tree=True)


def _wait_http(url: str, *, label: str) -> bool:
    import urllib.error
    import urllib.request

    print(f"正在等待{label}就绪...", flush=True)
    for attempt in range(40):
        time.sleep(0.25)
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status == 200:
                    time.sleep(0.3)
                    return True
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        if attempt == 0 or (attempt + 1) % 8 == 0:
            print(f"  仍在启动中（{attempt + 1}/40）...", flush=True)
    return False


def stop_backend() -> None:
    pid = read_pid(PID_FILE)
    if pid and is_running(pid):
        print(f"正在停止后端 API (PID {pid})...")
        kill_pid(pid, tree=True)
    elif port_in_use(API_PORT):
        print(f"发现端口 {API_PORT} 被占用，正在清理...")
        kill_port_listeners(API_PORT)
    PID_FILE.unlink(missing_ok=True)
    for _ in range(20):
        if not port_in_use(API_PORT):
            break
        time.sleep(0.2)


def stop_vite() -> None:
    pid = read_pid(VITE_PID_FILE)
    if pid and is_running(pid):
        print(f"正在停止前端开发服 (PID {pid})...")
        kill_pid(pid, tree=True)
    elif port_in_use(APP_PORT):
        print(f"发现端口 {APP_PORT} 被占用，正在清理...")
        kill_port_listeners(APP_PORT)
    VITE_PID_FILE.unlink(missing_ok=True)
    for _ in range(20):
        if not port_in_use(APP_PORT):
            break
        time.sleep(0.2)


def stop_all() -> None:
    stop_vite()
    stop_backend()


# 兼容旧调用
def stop_service() -> None:
    stop_all()


def start_backend(*, port: int = API_PORT, reload: bool = False) -> int | None:
    if port_in_use(port):
        print(f"端口 {port} 仍被占用，无法启动后端。")
        return None

    print(f"正在启动后端 API (:{port})...")
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    log_file = open(LOG_FILE, "a", encoding="utf-8")
    env = service_environ()
    env["PYTHONPATH"] = str(SRC_DIR)
    env["LOC_GALLERY_PORT"] = str(port)
    cmd = [
        sys.executable, "-m", "uvicorn",
        "loc_gallery.server:app",
        "--host", HOST,
        "--port", str(port),
    ]
    if reload:
        cmd.append("--reload")
    proc = subprocess.Popen(
        cmd,
        cwd=str(PROJECT_ROOT),
        stdout=log_file,
        stderr=log_file,
        env=env,
        **_daemon_popen_kwargs(),
    )
    PID_FILE.parent.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(str(proc.pid), encoding="utf-8")
    print(f"后端已启动 (PID {proc.pid})")

    health_url = f"http://{HOST}:{port}/api/health"
    if _wait_http(health_url, label="后端 API"):
        print(f"后端就绪: {health_url}")
        return proc.pid
    print("后端已启动，但健康检查未通过，请查看 logs/server.log")
    return proc.pid


def start_vite() -> int | None:
    if port_in_use(APP_PORT):
        print(f"端口 {APP_PORT} 仍被占用，无法启动 Vite。")
        return None
    if not (FRONTEND_DIR / "package.json").is_file():
        print("错误：未找到 frontend/package.json")
        return None

    print(f"正在启动前端开发服 (:{APP_PORT}，支持热更新)...")
    VITE_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    log_file = open(VITE_LOG_FILE, "a", encoding="utf-8")
    cmd = _vite_command()
    if not cmd:
        print("错误：未找到 Vite，请先在 frontend 目录执行 npm install")
        return None
    env = os.environ.copy()
    env["LOC_GALLERY_APP_PORT"] = str(APP_PORT)
    env["LOC_GALLERY_API_PORT"] = str(API_PORT)
    proc = subprocess.Popen(
        cmd,
        cwd=str(FRONTEND_DIR),
        stdout=log_file,
        stderr=log_file,
        env=env,
        **_daemon_popen_kwargs(),
    )
    VITE_PID_FILE.write_text(str(proc.pid), encoding="utf-8")
    print(f"Vite 已启动 (PID {proc.pid})")

    if _wait_http(APP_URL, label="前端"):
        print(f"前端就绪: {APP_URL}")
        return proc.pid
    print("Vite 已启动，但尚未响应，请稍后手动打开页面。")
    return proc.pid


def start_dev() -> bool:
    """开发模式：内部 API + 对外单一 Vite 端口（全部后台，无额外窗口）。"""
    api_pid = start_backend(port=API_PORT, reload=False)
    if not api_pid:
        return False
    vite_pid = start_vite()
    if not vite_pid:
        stop_backend()
        return False
    print(f"\n开发服务已就绪: {APP_URL}")
    print("修改 frontend/src 后会自动热更新，无需重启。")
    return True


def start_production() -> bool:
    """生产模式：构建 dist，由后端在 APP_PORT 托管静态资源。"""
    api_pid = start_backend(port=APP_PORT)
    return bool(api_pid)


# 兼容旧调用（生产端口由环境变量 LOC_GALLERY_PORT 决定）
def start_service() -> int | None:
    port = int(os.environ.get("LOC_GALLERY_PORT", str(APP_PORT)))
    return start_backend(port=port)


def wait_service_ready() -> bool:
    port = int(os.environ.get("LOC_GALLERY_PORT", str(APP_PORT)))
    return _wait_http(f"http://{HOST}:{port}/api/health", label="服务")


def open_browser(cache_bust: bool = False) -> None:
    url = f"{APP_URL}/?boot={int(time.time())}" if cache_bust else APP_URL
    webbrowser.open(url)
