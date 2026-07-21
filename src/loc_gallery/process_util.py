# -*- coding: utf-8 -*-
"""Windows 子进程静默启动（避免 ffmpeg/ffprobe 弹出黑框）。"""
from __future__ import annotations

import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


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


def deprioritize_process(pid: int) -> bool:
    """降低子进程优先级，减轻与其它任务抢磁盘/CPU（Windows 为主）。"""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        BELOW_NORMAL_PRIORITY_CLASS = 0x00004000
        PROCESS_SET_INFORMATION = 0x0200
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        handle = kernel32.OpenProcess(PROCESS_SET_INFORMATION, False, pid)
        if not handle:
            return False
        try:
            return bool(kernel32.SetPriorityClass(handle, BELOW_NORMAL_PRIORITY_CLASS))
        finally:
            kernel32.CloseHandle(handle)
    try:
        import os

        os.nice(5)
        return True
    except OSError:
        return False


@dataclass(frozen=True)
class FileTimestamps:
    atime: float
    mtime: float
    ctime: float | None = None


def capture_file_timestamps(path: Path) -> FileTimestamps:
    """读取文件访问/修改时间；Windows 上额外保留创建时间。"""
    st = path.stat()
    ctime = st.st_ctime if sys.platform == "win32" else None
    return FileTimestamps(st.st_atime, st.st_mtime, ctime)


def restore_file_timestamps(path: Path, timestamps: FileTimestamps) -> None:
    """恢复 capture_file_timestamps 保存的时间戳。"""
    os.utime(path, (timestamps.atime, timestamps.mtime))
    if sys.platform == "win32" and timestamps.ctime is not None:
        _win_set_creation_time(path, timestamps.ctime)


def _win_set_creation_time(path: Path, ctime: float) -> None:
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    GENERIC_WRITE = 0x40000000
    FILE_SHARE_READ = 1
    OPEN_EXISTING = 3
    FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
    INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

    handle = kernel32.CreateFileW(
        str(path),
        GENERIC_WRITE,
        FILE_SHARE_READ,
        None,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS,
        None,
    )
    if handle == INVALID_HANDLE_VALUE:
        return
    try:
        if ctime < 0:
            ctime = 0.0
        ft = int((ctime + 11644473600) * 10_000_000)
        creation = wintypes.FILETIME(ft & 0xFFFFFFFF, ft >> 32)
        kernel32.SetFileTime(handle, ctypes.byref(creation), None, None)
    finally:
        kernel32.CloseHandle(handle)


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
