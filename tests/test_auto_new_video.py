# -*- coding: utf-8 -*-
"""测试新视频自动处理流程。"""
import json
import shutil
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from loc_gallery.config import VIDEO_ROOT  # noqa: E402

BASE = "http://127.0.0.1:3456"
PLANS_FILE = ROOT / "data" / "cache" / "playback_plans.json"
TEST_NAME = "_gallery_auto_test.mp4"


def get(url: str):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode())


def count_videos():
    return get(f"{BASE}/api/videos?page=1&page_size=1")["total"]


def find_test_video():
    data = get(f"{BASE}/api/videos?q={TEST_NAME}&page_size=10")
    for item in data.get("items", []):
        if TEST_NAME in item.get("filename", ""):
            return item
    return None


def main():
    # 找一个小视频作为模板
    sample = None
    for cat in VIDEO_ROOT.iterdir():
        if not cat.is_dir():
            continue
        for f in cat.glob("*.mp4"):
            if f.stat().st_size < 50 * 1024 * 1024:
                sample = f
                break
        if sample:
            break
    if not sample:
        print("FAIL: 未找到小于 50MB 的 mp4 样本")
        return 1

    dest = sample.parent / TEST_NAME
    if dest.exists():
        dest.unlink()

    before = count_videos()
    print(f"复制样本: {sample.name} -> {dest.name}")
    shutil.copy2(sample, dest)

    item = None
    for i in range(30):
        time.sleep(2)
        item = find_test_video()
        if item:
            print(f"OK [{i+1}] 列表已出现新视频 id={item['id'][:12]} thumbReady={item.get('thumbReady')} status={item.get('thumbStatus')}")
            break
        print(f"等待刷新... ({i+1})")
    else:
        print("FAIL: 30 秒内列表未出现新视频")
        dest.unlink(missing_ok=True)
        return 1

    # 等待缩略图
    for i in range(60):
        item = find_test_video()
        if item and item.get("thumbReady"):
            print(f"OK 缩略图已生成 ({i+1})")
            break
        time.sleep(2)
    else:
        print("WARN: 缩略图 120 秒内未就绪")

    # 检查 playback_plans.json
    plans = {}
    if PLANS_FILE.is_file():
        plans = json.loads(PLANS_FILE.read_text(encoding="utf-8"))
    key = str(dest.resolve())
    if key in plans:
        print(f"OK 播放策略已持久化 mode={plans[key].get('plan', {}).get('mode')}")
    else:
        print("WARN: playback_plans.json 中尚无该文件记录（可能仍在后台分析）")

    # 清理
    dest.unlink(missing_ok=True)
    time.sleep(3)
    after = count_videos()
    print(f"清理完成，视频数 {before} -> {after}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
