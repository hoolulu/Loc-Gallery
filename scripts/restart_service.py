# -*- coding: utf-8 -*-
"""从 Web 触发的服务重启（不打开浏览器）。"""
from __future__ import annotations

import os
import sys
import time
import traceback
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RESTART_LOG = PROJECT_ROOT / "data" / "logs" / "restart.log"
sys.path.insert(0, str(PROJECT_ROOT / "src"))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

from ports import API_PORT  # noqa: E402
from service import start_backend, stop_backend  # noqa: E402


def _log(msg: str) -> None:
    RESTART_LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(RESTART_LOG, "a", encoding="utf-8") as f:
        f.write(msg + "\n")


def main() -> int:
    os.chdir(PROJECT_ROOT)
    os.environ["LOC_GALLERY_PORT"] = str(API_PORT)
    try:
        _log(f"worker started pid={os.getpid()}")
        time.sleep(0.8)  # 让 API 响应先返回
        stop_backend()
        time.sleep(0.3)
        pid = start_backend(port=API_PORT)
        if pid:
            _log(f"restart ok new_pid={pid}")
            return 0
        _log("restart failed: start_service returned None")
        return 1
    except Exception:
        _log("restart error:\n" + traceback.format_exc())
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
