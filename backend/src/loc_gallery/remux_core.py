# -*- coding: utf-8 -*-
"""碎片化 MP4 重封装（流复制 + faststart，不重新编码）。"""
from __future__ import annotations

import subprocess
import time
from pathlib import Path
from typing import Callable

from loc_gallery.process_util import hidden_subprocess_kwargs
from loc_gallery.thumb_manager import ffmpeg_path

ProgressCallback = Callable[[float, str], None]


def remux_to_file(
    input_file: Path,
    output_file: Path,
    *,
    on_progress: ProgressCallback | None = None,
    poll_sec: float = 2.0,
) -> None:
    """将碎片化 MP4 重封装为标准 MP4，写入 output_file。"""
    input_file = input_file.resolve()
    output_file = output_file.resolve()
    if not input_file.is_file():
        raise FileNotFoundError(f"输入文件不存在: {input_file}")
    if output_file.exists():
        output_file.unlink()

    input_size = max(1, input_file.stat().st_size)
    cmd = [
        ffmpeg_path(),
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", str(input_file),
        "-map", "0",
        "-c", "copy",
        "-movflags", "+faststart",
        "-max_muxing_queue_size", "9999",
        str(output_file),
    ]
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        **hidden_subprocess_kwargs(),
    )
    try:
        while proc.poll() is None:
            if on_progress and output_file.exists():
                pct = min(99.0, output_file.stat().st_size / input_size * 100.0)
                on_progress(pct, f"已写入 {pct:.0f}%")
            time.sleep(poll_sec)
        if proc.returncode != 0:
            output_file.unlink(missing_ok=True)
            raise RuntimeError(f"ffmpeg 重封装失败（退出码 {proc.returncode}）")
        if on_progress:
            on_progress(100.0, "重封装完成")
    except Exception:
        if proc.poll() is None:
            proc.kill()
        output_file.unlink(missing_ok=True)
        raise
