# -*- coding: utf-8 -*-
"""交付前将 data 从联接复制为独立副本。"""
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_LINK = PROJECT_ROOT / "data"
SOURCE_DATA = Path(r"F:\Loc-Gallery\data")
BACKUP = PROJECT_ROOT / "data.junction.bak"


def is_junction(path: Path) -> bool:
    if not path.exists():
        return False
    if sys.platform != "win32":
        return path.is_symlink()
    try:
        out = subprocess.check_output(["cmd", "/c", "dir", str(path.parent)], text=True, errors="replace")
        name = path.name
        for line in out.splitlines():
            if name in line and ("<JUNCTION>" in line or "<SYMLINKD>" in line):
                return True
    except OSError:
        pass
    return False


def main():
    print("=== Loc Gallery Vue · 数据独立化 ===\n")
    if not SOURCE_DATA.is_dir():
        print(f"错误：源数据目录不存在: {SOURCE_DATA}")
        sys.exit(1)
    if DATA_LINK.exists() and not is_junction(DATA_LINK):
        print("data/ 已是普通目录，跳过复制。")
        return
    if DATA_LINK.exists() and is_junction(DATA_LINK):
        print("移除目录联接...")
        DATA_LINK.rmdir()
    if BACKUP.exists():
        shutil.rmtree(BACKUP)
    print(f"正在复制 {SOURCE_DATA} → {DATA_LINK} ...")
    shutil.copytree(SOURCE_DATA, DATA_LINK)
    print("完成。data/ 现为独立副本。")


if __name__ == "__main__":
    main()
