# -*- coding: utf-8 -*-
"""缩略图接口 404 行为测试。

回归测试：/api/thumb/{video_id} 在缩略图文件不存在时应返回 404，
而非抛出 FileNotFoundError 导致 500（见 server.log 中 /api/thumb 的 500）。
"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from loc_gallery.server import app


class ThumbNotFoundTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        data = root / "data"
        lib = data / "libraries" / "lib-a"
        lib.mkdir(parents=True)
        videos = root / "videos"
        videos.mkdir()
        (data / "libraries.json").write_text(
            json.dumps({
                "version": 1,
                "active_library_id": "lib-a",
                "libraries": [
                    {
                        "id": "lib-a",
                        "alias": "A",
                        "path": str(videos),
                        "created_at": 1,
                        "order": 0,
                    },
                ],
            }),
            encoding="utf-8",
        )
        # 缩略图目录指向临时目录下的 .thumbs，目标文件不在其中
        self.tdir = lib / ".thumbs"
        self.tdir.mkdir(parents=True, exist_ok=True)

        patches = {
            "loc_gallery.config.DATA_DIR": data,
            "loc_gallery.config.LIBRARIES_FILE": data / "libraries.json",
            "loc_gallery.config.LIBRARIES_ROOT": data / "libraries",
            "loc_gallery.config.SETTINGS_FILE": data / "settings.json",
            "loc_gallery.library_store.LIBRARIES_FILE": data / "libraries.json",
            "loc_gallery.library_store.LIBRARIES_ROOT": data / "libraries",
            "loc_gallery.library_store.DATA_DIR": data,
            "loc_gallery.thumb_manager.thumb_dir": mock.Mock(
                return_value=self.tdir
            ),
        }
        self._mocks = [mock.patch(k, v) for k, v in patches.items()]
        for m in self._mocks:
            m.start()
            self.addCleanup(m.stop)
        self.client = TestClient(app)

    def test_missing_thumb_returns_404_not_500(self) -> None:
        r = self.client.get(
            "/api/thumb/does-not-exist-id",
            params={"library_id": "lib-a"},
        )
        self.assertEqual(r.status_code, 404)

    def test_existing_thumb_returns_200(self) -> None:
        (self.tdir / "exists.jpg").write_bytes(b"fake-jpeg-data")
        r = self.client.get(
            "/api/thumb/exists",
            params={"library_id": "lib-a"},
        )
        self.assertEqual(r.status_code, 200)


if __name__ == "__main__":
    unittest.main()
