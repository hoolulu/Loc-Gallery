# -*- coding: utf-8 -*-
"""Windows 子进程静默启动（避免 ffmpeg/ffprobe 弹出黑框）。"""
from __future__ import annotations

import subprocess
import sys


def hidden_subprocess_kwargs() -> dict:
    """返回 Popen/run 用的 kwargs，在 Windows 上隐藏控制台窗口。"""
    if sys.platform != "win32":
        return {}
    kwargs: dict = {}
    flags = 0
    if hasattr(subprocess, "CREATE_NO_WINDOW"):
        flags |= subprocess.CREATE_NO_WINDOW
    if flags:
        kwargs["creationflags"] = flags
    si = subprocess.STARTUPINFO()
    if hasattr(subprocess, "STARTF_USESHOWWINDOW"):
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        si.wShowWindow = subprocess.SW_HIDE
    kwargs["startupinfo"] = si
    return kwargs
