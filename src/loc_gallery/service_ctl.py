# -*- coding: utf-8 -*-
"""服务重启（供 Web API 调用，不打开新浏览器标签）。"""
from __future__ import annotations

import subprocess
import sys
import threading
import time
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_SRC_DIR = _PROJECT_ROOT / "src"
_SCRIPT = _PROJECT_ROOT / "scripts" / "restart_service.py"
_RESTART_LOG = _PROJECT_ROOT / "data" / "logs" / "restart.log"
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from loc_gallery.config import service_environ  # noqa: E402

_restart_lock = threading.Lock()
_restart_pending = False

_CREATE_BREAKAWAY_FROM_JOB = 0x01000000


def _spawn_restart_worker() -> None:
    """在独立子进程中执行 stop → start，避免当前 uvicorn 自杀后无法拉起新进程。"""
    env = service_environ()
    env["PYTHONPATH"] = str(_SRC_DIR)
    _RESTART_LOG.parent.mkdir(parents=True, exist_ok=True)
    log_file = open(_RESTART_LOG, "a", encoding="utf-8")
    log_file.write(f"\n--- restart requested {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n")
    log_file.flush()
    kwargs: dict = {
        "cwd": str(_PROJECT_ROOT),
        "env": env,
        "stdin": subprocess.DEVNULL,
        "stdout": log_file,
        "stderr": log_file,
        "close_fds": True,
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = (
            subprocess.CREATE_NO_WINDOW
            | subprocess.DETACHED_PROCESS
            | _CREATE_BREAKAWAY_FROM_JOB
        )
    subprocess.Popen(
        [sys.executable, str(_SCRIPT)],
        **kwargs,
    )


def schedule_service_restart() -> bool:
    """后台重启服务；返回是否已排队。"""
    global _restart_pending
    with _restart_lock:
        if _restart_pending:
            return False
        _restart_pending = True

    try:
        _spawn_restart_worker()
    except OSError:
        with _restart_lock:
            _restart_pending = False
        raise

    def _clear_pending() -> None:
        time.sleep(3)
        global _restart_pending
        with _restart_lock:
            _restart_pending = False

    threading.Thread(target=_clear_pending, daemon=True, name="service-restart-clear").start()
    return True
