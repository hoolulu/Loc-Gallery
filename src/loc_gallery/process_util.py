# -*- coding: utf-8 -*-
"""Windows 子进程静默启动（避免 ffmpeg/ffprobe 弹出黑框）。"""
from __future__ import annotations

import subprocess
import sys


def suspend_process(pid: int) -> bool:
    """挂起进程（Windows NtSuspendProcess / Unix SIGSTOP）。"""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        ntdll = ctypes.WinDLL("ntdll")
        ntdll.NtSuspendProcess.argtypes = [wintypes.HANDLE]
        ntdll.NtSuspendProcess.restype = ctypes.c_ulong
        handle = kernel32.OpenProcess(0x0800, False, pid)
        if not handle:
            return False
        try:
            return int(ntdll.NtSuspendProcess(handle)) == 0
        finally:
            kernel32.CloseHandle(handle)
    import os
    import signal

    try:
        os.kill(pid, signal.SIGSTOP)
        return True
    except OSError:
        return False


def resume_process(pid: int) -> bool:
    """恢复已挂起的进程。"""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        ntdll = ctypes.WinDLL("ntdll")
        ntdll.NtResumeProcess.argtypes = [wintypes.HANDLE]
        ntdll.NtResumeProcess.restype = ctypes.c_ulong
        handle = kernel32.OpenProcess(0x0800, False, pid)
        if not handle:
            return False
        try:
            return int(ntdll.NtResumeProcess(handle)) == 0
        finally:
            kernel32.CloseHandle(handle)
    import os
    import signal

    try:
        os.kill(pid, signal.SIGCONT)
        return True
    except OSError:
        return False


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
