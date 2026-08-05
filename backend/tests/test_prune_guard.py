# -*- coding: utf-8 -*-
"""_prune_user_data 空索引保护测试。

当索引为空时（可能因扫描瞬时状态），必须跳过对收藏/历史/专辑的清理，
避免用空集合误删全部用户数据。
"""
from __future__ import annotations

import unittest
from unittest import mock

from loc_gallery import server


class PruneEmptyGuardTest(unittest.TestCase):
    def test_empty_index_skips_prune(self) -> None:
        # get_all 返回空 → prune 不应被调用
        with mock.patch.object(server, "get_all", return_value=[]), \
             mock.patch.object(server, "prune_favorites") as mf, \
             mock.patch.object(server, "prune_history") as mh, \
             mock.patch.object(server, "prune_albums") as ma:
            server._prune_user_data("lib-a")
        mf.assert_not_called()
        mh.assert_not_called()
        ma.assert_not_called()

    def test_nonempty_index_prunes(self) -> None:
        items = [mock.Mock(id="v1"), mock.Mock(id="v2")]
        with mock.patch.object(server, "get_all", return_value=items), \
             mock.patch.object(server, "prune_favorites") as mf, \
             mock.patch.object(server, "prune_history") as mh, \
             mock.patch.object(server, "prune_albums") as ma:
            server._prune_user_data("lib-a")
        mf.assert_called_once_with("lib-a", {"v1", "v2"})
        mh.assert_called_once_with("lib-a", {"v1", "v2"})
        ma.assert_called_once_with("lib-a", {"v1", "v2"})


if __name__ == "__main__":
    unittest.main()
