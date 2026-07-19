# -*- coding: utf-8 -*-
"""伪装 MPEG-TS 管道切片测试（需本机样本，不内置任何真实文件路径）。"""
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from avv_gallery.process_util import hidden_subprocess_kwargs
from avv_gallery.thumb_manager import ffmpeg_path

SOURCE = Path(os.environ.get("LOC_GALLERY_DISGUISED_SAMPLE", ""))
OFFSET = int(os.environ.get("LOC_GALLERY_DISGUISED_OFFSET", "475"))


def feed(proc: subprocess.Popen, source: Path, offset: int) -> None:
    with source.open("rb") as f:
        f.seek(offset)
        while True:
            chunk = f.read(4 * 1024 * 1024)
            if not chunk:
                break
            assert proc.stdin is not None
            proc.stdin.write(chunk)
    proc.stdin.close()


def main() -> int:
    if not SOURCE.is_file():
        print(
            "SKIP: 请设置环境变量 LOC_GALLERY_DISGUISED_SAMPLE 指向本机伪装 MPEG-TS 样本；"
            "可选 LOC_GALLERY_DISGUISED_OFFSET（默认 475）"
        )
        return 0

    work = Path(tempfile.mkdtemp())
    playlist = work / "playlist.m3u8"
    seg = str(work / "seg%05d.ts")
    cmd = [
        ffmpeg_path(),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-probesize",
        "50M",
        "-analyzeduration",
        "50M",
        "-fflags",
        "+genpts+ignidx+discardcorrupt",
        "-err_detect",
        "ignore_err",
        "-f",
        "h264",
        "-i",
        "pipe:0",
        "-t",
        "30",
        "-map",
        "0:v:0",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-f",
        "hls",
        "-hls_time",
        "6",
        "-hls_list_size",
        "0",
        "-hls_flags",
        "independent_segments+temp_file",
        "-hls_segment_filename",
        seg,
        str(playlist),
    ]
    t0 = time.time()
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        **hidden_subprocess_kwargs(),
    )
    feed(proc, SOURCE, OFFSET)
    out, err = proc.communicate(timeout=300)
    segs = list(work.glob("seg*.ts"))
    print("elapsed", round(time.time() - t0, 1), "rc", proc.returncode)
    print("segments", len(segs), [s.stat().st_size for s in segs[:5]])
    if playlist.is_file():
        print(playlist.read_text()[:300])
    if err:
        print("stderr", err.decode("utf-8", "replace")[-500:])
    shutil.rmtree(work, ignore_errors=True)
    return 0 if segs else 1


if __name__ == "__main__":
    raise SystemExit(main())
