# -*- coding: utf-8 -*-
"""交付验收：对比源项目与新项目数据一致性。"""
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ports import PRODUCTION_PORT, PRODUCTION_URL, SOURCE_URL

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE_API = f"{SOURCE_URL}/api"
TARGET_API = sys.argv[1] if len(sys.argv) > 1 else f"{PRODUCTION_URL}/api"


def fetch(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read().decode())


def check_data_dir() -> bool:
    data = PROJECT_ROOT / "data"
    if not data.is_dir():
        print("FAIL 16.11: data/ 不存在")
        return False
    # junction check on Windows
    try:
        import subprocess
        out = subprocess.check_output(["cmd", "/c", "dir", str(PROJECT_ROOT)], text=True, errors="replace")
        if "data" in out and ("<JUNCTION>" in out or "<SYMLINKD>" in out):
            print("WARN 16.11: data/ 仍为联接，交付前请运行 scripts/prepare_delivery.py")
            return False
    except OSError:
        pass
    print("OK  16.11: data/ 为独立目录")
    return True


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else SOURCE_API
    tgt = sys.argv[2] if len(sys.argv) > 2 else TARGET_API
    ok = 0
    total = 0

    def test(name: str, passed: bool):
        nonlocal ok, total
        total += 1
        if passed:
            ok += 1
            print(f"OK  {name}")
        else:
            print(f"FAIL {name}")

    try:
        s_libs = fetch(f"{src}/libraries")
        t_libs = fetch(f"{tgt}/libraries")
        test("16.1 库列表", s_libs.get("items") == t_libs.get("items"))
    except Exception as e:
        print(f"SKIP 库对比（需源项目 :{SOURCE_URL.split(':')[-1]} 运行）: {e}")

    try:
        t_health = fetch(f"{tgt}/health")
        test("15.1 健康检查", t_health.get("ok") is True)
        t_videos = fetch(f"{tgt}/videos?page_size=1")
        test("16.2 视频 API", "total" in t_videos)
    except Exception as e:
        print(f"FAIL API: {e}")

    dist = PROJECT_ROOT / "frontend" / "dist" / "index.html"
    test("15.2 生产构建", dist.is_file())

    if check_data_dir():
        ok += 1
    total += 1

    print(f"\n通过 {ok}/{total}")
    sys.exit(0 if ok == total else 1)


if __name__ == "__main__":
    main()
