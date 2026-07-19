# -*- coding: utf-8 -*-
"""服务启停共享工具。"""
from __future__ import annotations

import os
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from loc_gallery.config import HOST, LOG_FILE, PID_FILE, PORT, service_environ  # noqa: E402

URL = f"http://{HOST}:{PORT}"


def is_running(pid: int) -> bool:
    if sys.platform == "win32":
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}"],
            capture_output=True, text=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return str(pid) in result.stdout
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def read_pid() -> int | None:
    if not PID_FILE.exists():
        return None
    try:
        return int(PID_FILE.read_text(encoding="utf-8").strip())
    except (ValueError, OSError):
        return None


def port_in_use(port: int = PORT) -> bool:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((HOST, port)) == 0


def kill_pid(pid: int) -> None:
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/F", "/T"],
            capture_output=True, text=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    else:
        try:
            os.kill(pid, 15)
        except OSError:
            pass


def kill_port_listeners(port: int = PORT) -> None:
    if sys.platform != "win32":
        return
    result = subprocess.run(
        ["netstat", "-ano"],
        capture_output=True, text=True,
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
        kill_pid(pid)


def stop_service() -> None:
    pid = read_pid()
    if pid and is_running(pid):
        print(f"正在停止服务 (PID {pid})...")
        kill_pid(pid)
    elif port_in_use():
        print(f"发现端口 {PORT} 被占用，正在清理...")
        kill_port_listeners()
    else:
        print("未发现运行中的服务。")

    PID_FILE.unlink(missing_ok=True)

    for _ in range(20):
        if not port_in_use():
            break
        time.sleep(0.2)
    else:
        if port_in_use():
            print(f"警告：端口 {PORT} 仍被占用，启动可能失败。")


def wait_service_ready() -> bool:
    import urllib.error
    import urllib.request

    checks = (
        URL,
        f"{URL}/static/tailwind.css",
        f"{URL}/static/style.css",
    )
    print("正在等待服务就绪...", flush=True)
    for attempt in range(40):
        time.sleep(0.25)
        ok = True
        for check_url in checks:
            try:
                with urllib.request.urlopen(check_url, timeout=2) as resp:
                    if resp.status != 200:
                        ok = False
                        break
                    if check_url == URL:
                        body = resp.read(4096).decode("utf-8", errors="ignore")
                        if "Loc Gallery" not in body:
                            ok = False
                            break
            except (urllib.error.URLError, TimeoutError, OSError):
                ok = False
                break
        if ok:
            time.sleep(0.4)
            return True
        if attempt == 0 or (attempt + 1) % 8 == 0:
            print(f"  仍在启动中（{attempt + 1}/40）...", flush=True)
    return False


def start_service() -> int | None:
    if port_in_use():
        print(f"端口 {PORT} 仍被占用，无法启动。")
        return None

    print("正在启动 Loc Gallery 服务...")
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    log_file = open(LOG_FILE, "a", encoding="utf-8")
    env = service_environ()
    env["PYTHONPATH"] = str(SRC_DIR)
    proc = subprocess.Popen(
        [
            sys.executable, "-m", "uvicorn",
            "loc_gallery.server:app",
            "--host", HOST,
            "--port", str(PORT),
        ],
        cwd=str(PROJECT_ROOT),
        stdout=log_file,
        stderr=log_file,
        env=env,
        creationflags=subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS,
    )
    PID_FILE.parent.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(str(proc.pid), encoding="utf-8")
    print(f"服务已启动 (PID {proc.pid})")

    if wait_service_ready():
        print(f"服务就绪: {URL}")
        return proc.pid

    print("服务已启动，但尚未响应，请稍后手动刷新页面。")
    return proc.pid


def open_browser(cache_bust: bool = False) -> None:
    url = f"{URL}/?boot={int(time.time())}" if cache_bust else URL
    webbrowser.open(url)
