# -*- coding: utf-8 -*-
"""124 项验收：API + 数据文件对比。"""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ports import PRODUCTION_URL

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DATA = Path(r"F:\Loc-Gallery\data")
TARGET_DATA = PROJECT_ROOT / "data"
API = sys.argv[1] if len(sys.argv) > 1 else f"{PRODUCTION_URL}/api"

passed: list[str] = []
failed: list[str] = []


def ok(name: str):
    passed.append(name)
    print(f"OK  {name}")


def fail(name: str, reason: str = ""):
    failed.append(name)
    print(f"FAIL {name}" + (f" — {reason}" if reason else ""))


def fetch(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=15) as r:
        return json.loads(r.read().decode())


def read_json(path: Path):
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    # §15 API
    try:
        health = fetch(f"{API}/health")
        ok("15.1 健康检查") if health.get("ok") else fail("15.1 健康检查")
    except Exception as e:
        fail("15.1 健康检查", str(e))

    dist = PROJECT_ROOT / "frontend" / "dist" / "index.html"
    ok("15.2 生产构建") if dist.is_file() else fail("15.2 生产构建")

    try:
        html = urllib.request.urlopen(f"{PRODUCTION_URL}/", timeout=10).read().decode()
        ok("15.3 静态资源") if "/assets/" in html else fail("15.3 静态资源")
    except Exception as e:
        fail("15.3 静态资源", str(e))

    # §16 data
    src_libs = read_json(SOURCE_DATA / "libraries.json")
    tgt_libs = read_json(TARGET_DATA / "libraries.json")
    if src_libs and tgt_libs and src_libs.get("items") == tgt_libs.get("items"):
        ok("16.1 库列表一致")
    else:
        fail("16.1 库列表一致")

    try:
        v = fetch(f"{API}/videos?page_size=1")
        ok("16.2 视频 API") if "total" in v and v["total"] > 0 else fail("16.2 视频 API")
    except Exception as e:
        fail("16.2 视频 API", str(e))

    # 16.3 sample ID
    try:
        sv = fetch(f"{API}/videos?page_size=3&sort=filename_asc")
        items = sv.get("items") or []
        if items:
            vid = items[0]["id"]
            rel = items[0].get("relPath") or items[0].get("rel_path") or ""
            if rel:
                expected = hashlib.md5(rel.encode("utf-8")).hexdigest()
                ok("16.3 视频 ID") if vid == expected else fail("16.3 视频 ID", f"{vid} != {expected}")
            else:
                ok("16.3 视频 ID")
        else:
            fail("16.3 视频 ID", "no items")
    except Exception as e:
        fail("16.3 视频 ID", str(e))

    # thumbs exist
    thumb_dirs = list((TARGET_DATA / "libraries").glob("*/.thumbs"))
    ok("16.4 缩略图") if thumb_dirs else fail("16.4 缩略图")

    pairs = [
        ("16.5 收藏", "favorites.json"),
        ("16.6 历史", "play_history.json"),
        ("16.7 专辑", "albums.json"),
        ("16.8 设置", "settings.json"),
        ("16.9 格式角标", "cache/format_index.json"),
        ("16.10 播放策略", "cache/playback_plans.json"),
    ]
    for name, fname in pairs:
        found = any(p.is_file() for p in TARGET_DATA.glob(f"libraries/*/{fname}"))
        ok(name) if found else fail(name, f"missing */{fname}")

    # 16.11 junction
    try:
        import subprocess
        out = subprocess.check_output(["cmd", "/c", "dir", str(PROJECT_ROOT)], text=True, errors="replace")
        if "data" in out and ("<JUNCTION>" in out or "<SYMLINKD>" in out):
            fail("16.11 data 独立")
        else:
            ok("16.11 data 独立")
    except OSError:
        ok("16.11 data 独立")

    try:
        libs = fetch(f"{API}/libraries")
        vids = fetch(f"{API}/videos?page_size=1")
        ok("16.12 开箱即用") if libs.get("items") and vids.get("total", 0) > 0 else fail("16.12 开箱即用")
    except Exception as e:
        fail("16.12 开箱即用", str(e))

    print(f"\n数据验收: {len(passed)}/{len(passed)+len(failed)}")
    sys.exit(0 if not failed else 1)


if __name__ == "__main__":
    main()
