# -*- coding: utf-8 -*-
"""专辑 REST API 集成测试（TestClient）。"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from loc_gallery.server import app


class AlbumApiTest(unittest.TestCase):
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
        patches = {
            "loc_gallery.config.DATA_DIR": data,
            "loc_gallery.config.LIBRARIES_FILE": data / "libraries.json",
            "loc_gallery.config.LIBRARIES_ROOT": data / "libraries",
            "loc_gallery.config.SETTINGS_FILE": data / "settings.json",
            "loc_gallery.library_store.LIBRARIES_FILE": data / "libraries.json",
            "loc_gallery.library_store.LIBRARIES_ROOT": data / "libraries",
            "loc_gallery.library_store.DATA_DIR": data,
        }
        self._mocks = [mock.patch(k, v) for k, v in patches.items()]
        for m in self._mocks:
            m.start()
            self.addCleanup(m.stop)
        self.client = TestClient(app)
        self.lib = "lib-a"

    def test_album_crud_and_membership(self) -> None:
        q = f"?library_id={self.lib}"
        r = self.client.get(f"/api/albums{q}")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["items"], [])

        r = self.client.post(
            f"/api/albums{q}",
            json={"name": "测试专辑", "description": "d"},
        )
        self.assertEqual(r.status_code, 200)
        aid = r.json()["album"]["id"]

        r = self.client.get(f"/api/albums/{aid}{q}")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["name"], "测试专辑")

        r = self.client.patch(
            f"/api/albums/{aid}{q}",
            json={"name": "新名称"},
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["album"]["name"], "新名称")

        fake_vid = "fake-video-1"
        r = self.client.post(
            f"/api/albums/{aid}/videos{q}",
            json={"ids": [fake_vid]},
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["video_count"], 0)

        r = self.client.get(f"/api/albums{q}")
        self.assertEqual(len(r.json()["items"]), 1)

        r = self.client.delete(f"/api/albums/{aid}{q}")
        self.assertEqual(r.status_code, 200)
        r = self.client.get(f"/api/albums/{aid}{q}")
        self.assertEqual(r.status_code, 404)


if __name__ == "__main__":
    unittest.main()
