# -*- coding: utf-8 -*-
"""多视频库数据隔离基础测试。"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from avv_gallery import favorite_store, history_store, settings_store


class MultiLibraryIsolationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        data = root / "data"
        lib_a = data / "libraries" / "lib-a"
        lib_b = data / "libraries" / "lib-b"
        lib_a.mkdir(parents=True)
        lib_b.mkdir(parents=True)
        (data / "libraries.json").write_text(
            json.dumps({
                "version": 1,
                "active_library_id": "lib-a",
                "libraries": [
                    {"id": "lib-a", "alias": "A", "path": str(root / "videos-a"), "created_at": 1, "order": 0},
                    {"id": "lib-b", "alias": "B", "path": str(root / "videos-b"), "created_at": 2, "order": 1},
                ],
            }),
            encoding="utf-8",
        )
        patches = {
            "avv_gallery.config.DATA_DIR": data,
            "avv_gallery.config.LIBRARIES_FILE": data / "libraries.json",
            "avv_gallery.config.LIBRARIES_ROOT": data / "libraries",
            "avv_gallery.config.SETTINGS_FILE": data / "settings.json",
            "avv_gallery.library_store.LIBRARIES_FILE": data / "libraries.json",
            "avv_gallery.library_store.LIBRARIES_ROOT": data / "libraries",
            "avv_gallery.library_store.DATA_DIR": data,
        }
        self._mocks = [mock.patch(k, v) for k, v in patches.items()]
        for m in self._mocks:
            m.start()
            self.addCleanup(m.stop)

    def test_favorites_isolated(self) -> None:
        favorite_store.toggle_favorite("lib-a", "vid1")
        self.assertTrue(favorite_store.is_favorite("lib-a", "vid1"))
        self.assertFalse(favorite_store.is_favorite("lib-b", "vid1"))

    def test_history_isolated(self) -> None:
        history_store.record_play("lib-a", "vid9")
        self.assertIsNotNone(history_store.get_entry("lib-a", "vid9"))
        self.assertIsNone(history_store.get_entry("lib-b", "vid9"))

    def test_settings_library_override(self) -> None:
        settings_store.save_settings({"player_mode": "potplayer"}, library_id="lib-a")
        settings_store.save_settings({"player_mode": "html5"}, library_id="lib-b")
        self.assertEqual(settings_store.load_settings("lib-a")["player_mode"], "potplayer")
        self.assertEqual(settings_store.load_settings("lib-b")["player_mode"], "html5")


if __name__ == "__main__":
    unittest.main()
