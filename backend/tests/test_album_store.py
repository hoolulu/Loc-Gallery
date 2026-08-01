# -*- coding: utf-8 -*-
"""专辑存储层测试。"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from loc_gallery import album_store


class AlbumStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        data = root / "data"
        lib = data / "libraries" / "lib-a"
        lib.mkdir(parents=True)
        self.lib = "lib-a"
        patches = {
            "loc_gallery.config.DATA_DIR": data,
            "loc_gallery.config.LIBRARIES_ROOT": data / "libraries",
            "loc_gallery.album_store.albums_file": lambda library_id: data / "libraries" / library_id / "albums.json",
        }
        self._mocks = [mock.patch(k, v) for k, v in patches.items()]
        for m in self._mocks:
            m.start()
            self.addCleanup(m.stop)

    def test_create_list_get(self) -> None:
        created = album_store.create_album(self.lib, "我的合集", description="备注")
        self.assertEqual(created["name"], "我的合集")
        self.assertEqual(created["video_count"], 0)
        items = album_store.list_albums(self.lib)
        self.assertEqual(len(items), 1)
        got = album_store.get_album(self.lib, created["id"])
        assert got is not None
        self.assertEqual(got["description"], "备注")

    def test_add_remove_videos_and_cover_default(self) -> None:
        album = album_store.create_album(self.lib, "A")
        aid = album["id"]
        v1, v2 = "vid-1", "vid-2"
        out = album_store.add_videos(self.lib, aid, [v1, v2])
        assert out is not None
        self.assertEqual(out["video_count"], 2)
        self.assertEqual(out["cover_video_id"], v1)
        album_store.set_cover(self.lib, aid, v2)
        got = album_store.get_album(self.lib, aid)
        assert got is not None
        self.assertEqual(got["cover_video_id"], v2)
        rem = album_store.remove_videos(self.lib, aid, [v2])
        assert rem is not None
        self.assertEqual(rem["video_count"], 1)
        got2 = album_store.get_album(self.lib, aid)
        assert got2 is not None
        self.assertEqual(got2["cover_video_id"], v1)

    def test_album_map_and_prune(self) -> None:
        album = album_store.create_album(self.lib, "B")
        aid = album["id"]
        album_store.add_videos(self.lib, aid, ["v1", "v2"])
        m = album_store.get_album_map_for_videos(self.lib, ["v1", "v2", "v3"])
        self.assertEqual(m["v1"], [aid])
        self.assertEqual(album_store.get_album_ids_for_video(self.lib, "v3"), [])
        album_store.prune_missing(self.lib, {"v1"})
        got = album_store.get_album(self.lib, aid)
        assert got is not None
        self.assertEqual(got["video_count"], 1)
        album_store.remove_video_from_all_albums(self.lib, ["v1"])
        got2 = album_store.get_album(self.lib, aid)
        assert got2 is not None
        self.assertEqual(got2["video_count"], 0)

    def test_library_isolation(self) -> None:
        data = Path(self.tmp.name) / "data"
        lib_b = data / "libraries" / "lib-b"
        lib_b.mkdir(parents=True)
        a = album_store.create_album(self.lib, "only-a")
        album_store.create_album("lib-b", "only-b")
        self.assertEqual(len(album_store.list_albums(self.lib)), 1)
        self.assertEqual(album_store.list_albums(self.lib)[0]["id"], a["id"])
        self.assertEqual(len(album_store.list_albums("lib-b")), 1)


if __name__ == "__main__":
    unittest.main()
