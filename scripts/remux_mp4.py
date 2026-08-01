#!/usr/bin/env python3
"""快速重封装碎片化 MP4（HLS 合并产物），流复制不重新编码。"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from loc_gallery.remux_core import remux_to_file  # noqa: E402

SUFFIX = "_重封装"


def main() -> None:
    parser = argparse.ArgumentParser(description="重封装碎片化 MP4，修复播放器开播卡顿")
    parser.add_argument("input", type=Path, help="输入 mp4 路径")
    parser.add_argument("-o", "--output", type=Path, help="输出 mp4 路径（默认：同目录 *_重封装.mp4）")
    args = parser.parse_args()

    input_file = args.input.resolve()
    output_file = args.output
    if output_file is None:
        output_file = input_file.with_name(f"{input_file.stem}{SUFFIX}{input_file.suffix}")
    else:
        output_file = output_file.resolve()

    print(f"输入: {input_file}")
    print(f"输出: {output_file}")
    print("开始重封装（流复制）…")

    def on_progress(pct: float, msg: str) -> None:
        print(f"\r{msg}", end="", flush=True)

    remux_to_file(input_file, output_file, on_progress=on_progress)
    print(f"\n完成: {output_file}")


if __name__ == "__main__":
    main()
