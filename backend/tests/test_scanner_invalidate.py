# -*- coding: utf-8 -*-
"""scanner 排序索引失效回归测试。

refresh_video_item_stat 更新 item 的 size/mtime 后，必须使按 mtime/size 排序的
全局索引失效，否则 get_sorted_ids 仍返回旧顺序（remux 原地替换后排序错误）。
"""
from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from loc_gallery import scanner


def _make_item(vid: str, path: str, mtime: float, size: int) -> scanner.VideoItem:
    return scanner.VideoItem(
        id=vid,
        path=path,
        category="根目录",
        subfolder="",
        title=vid,
        filename=Path(path).name,
        size=size,
        mtime=mtime,
        library_id="lib-a",
    )


class ScannerIndexInvalidationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        # 清空全局状态，避免测试间污染
        with scanner._lock:
            scanner._caches.clear()
            scanner._versions.clear()
            scanner._sort_id_indexes.clear()
            scanner._category_items.clear()

    def _make_file(self, name: str, mtime: float) -> Path:
        p = self.dir / name
        p.write_bytes(b"x")
        # Windows 上设置 mtime 需要 os.utime
        import os

        os.utime(p, (mtime, mtime))
        return p

    def test_remux_stat_refreshes_sort_index(self) -> None:
        lib = "lib-a"
        # 两个文件，mtime 顺序 A 旧 / B 新
        f_a = self._make_file("a.mp4", time.time() - 1000)
        f_b = self._make_file("b.mp4", time.time() - 500)
        item_a = _make_item("a", str(f_a), f_a.stat().st_mtime, f_a.stat().st_size)
        item_b = _make_item("b", str(f_b), f_b.stat().st_mtime, f_b.stat().st_size)
        with scanner._lock:
            scanner._caches[lib] = {"a": item_a, "b": item_b}

        # 初始按 mtime_desc：b 在前
        ids = scanner.get_sorted_ids(lib, "mtime_desc")
        self.assertEqual(ids, ["b", "a"])

        # 模拟 remux：把 A 原地替换，mtime 变新（比 B 新）
        import os

        os.utime(f_a, (time.time() + 1, time.time() + 1))
        self.assertTrue(scanner.refresh_video_item_stat(lib, "a"))

        # 排序索引应已失效，a 现在应排最前
        ids_after = scanner.get_sorted_ids(lib, "mtime_desc")
        self.assertEqual(ids_after, ["a", "b"])


if __name__ == "__main__":
    unittest.main()
