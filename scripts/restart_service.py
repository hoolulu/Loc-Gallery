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

from service import start_service, stop_service  # noqa: E402


def _log(msg: str) -> None:
    RESTART_LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(RESTART_LOG, "a", encoding="utf-8") as f:
        f.write(msg + "\n")


def main() -> int:
    os.chdir(PROJECT_ROOT)
    try:
        _log(f"worker started pid={os.getpid()}")
        time.sleep(0.8)  # 让 API 响应先返回
        stop_service()
        time.sleep(0.3)
        pid = start_service()
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
