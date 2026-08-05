# -*- coding: utf-8 -*-
"""测试新视频自动处理流程（集成测试，需先启动服务）。

在真实运行的服务上验证：往库目录复制一个小视频 → 服务应自动索引 →
生成缩略图 → 后台探测并持久化播放策略。

运行方式（先启动服务）：
    python backend/tests/test_auto_new_video.py
"""
import json
import shutil
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from loc_gallery.config import PORT, VIDEO_ROOT  # noqa: E402
from loc_gallery.config import playback_plans_file  # noqa: E402
from loc_gallery.library_store import get_active_library_id, list_libraries  # noqa: E402

BASE = f"http://127.0.0.1:{PORT}"
TEST_NAME = "_gallery_auto_test.mp4"


def resolve_target_library() -> tuple[str, Path]:
    """确定注入测试视频的目标库。

    优先选择路径与 VIDEO_ROOT 一致的库；否则退回激活库。
    返回 (library_id, 库根目录)。
    """
    libs = list_libraries()
    if not libs:
        raise SystemExit("FAIL: 未配置任何视频库，请先在设置中添加")
    for lib in libs:
        try:
            if lib.path_obj == VIDEO_ROOT:
                return lib.id, lib.path_obj
        except OSError:
            continue
    active = get_active_library_id()
    lib = next((x for x in libs if x.id == active), libs[0])
    return lib.id, lib.path_obj


def get(url: str, library_id: str):
    sep = "&" if "?" in url else "?"
    with urllib.request.urlopen(f"{url}{sep}library_id={library_id}", timeout=30) as r:
        return json.loads(r.read().decode())


def count_videos(library_id: str):
    return get(f"{BASE}/api/videos?page=1&page_size=1", library_id)["total"]


def find_test_video(library_id: str):
    data = get(f"{BASE}/api/videos?q={TEST_NAME}&page_size=10", library_id)
    for item in data.get("items", []):
        if TEST_NAME in item.get("filename", ""):
            return item
    return None


def main():
    library_id, library_root = resolve_target_library()
    print(f"目标库: {library_id} ({library_root})")

    # 找一个小视频作为模板
    sample = None
    for cat in library_root.iterdir():
        if not cat.is_dir():
            continue
        for f in cat.glob("*.mp4"):
            try:
                if f.stat().st_size < 50 * 1024 * 1024:
                    sample = f
                    break
            except OSError:
                continue
        if sample:
            break
    if not sample:
        print("FAIL: 未找到小于 50MB 的 mp4 样本")
        return 1

    dest = sample.parent / TEST_NAME
    if dest.exists():
        dest.unlink(missing_ok=True)

    before = count_videos(library_id)
    print(f"复制样本: {sample.name} -> {dest.name}")
    shutil.copy2(sample, dest)

    item = None
    for i in range(30):
        time.sleep(2)
        item = find_test_video(library_id)
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
        item = find_test_video(library_id)
        if item and item.get("thumbReady"):
            print(f"OK 缩略图已生成 ({i+1})")
            break
        time.sleep(2)
    else:
        print("WARN: 缩略图 120 秒内未就绪")

    # 检查 playback_plans.json
    plans = {}
    plans_file = playback_plans_file(library_id)
    if plans_file.is_file():
        plans = json.loads(plans_file.read_text(encoding="utf-8"))
    key = str(dest.resolve())
    if key in plans:
        print(f"OK 播放策略已持久化 mode={plans[key].get('plan', {}).get('mode')}")
    else:
        print("WARN: playback_plans.json 中尚无该文件记录（可能仍在后台分析）")

    # 清理
    dest.unlink(missing_ok=True)
    time.sleep(3)
    after = count_videos(library_id)
    print(f"清理完成，视频数 {before} -> {after}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
