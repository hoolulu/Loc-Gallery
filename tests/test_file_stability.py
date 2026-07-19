# -*- coding: utf-8 -*-
import os
from pathlib import Path

from avv_gallery.file_stability import (
    is_file_stable,
    is_incomplete_filename,
    is_ready_for_index,
    notify_file_activity,
)


def test_incomplete_names():
    assert is_incomplete_filename("movie.mp4.part")
    assert is_incomplete_filename("movie.crdownload")
    assert is_incomplete_filename("clip.tmp.mp4")
    assert not is_incomplete_filename("normal_video.mp4")


def test_recent_file_not_indexed(tmp_path):
    p = tmp_path / "new.mp4"
    p.write_bytes(b"\x00" * 1024)
    assert not is_ready_for_index(p)


def test_stable_file_indexed(tmp_path):
    p = tmp_path / "done.mp4"
    p.write_bytes(b"\x00" * 1024)
    old = p.stat().st_mtime
    os.utime(p, (old - 60, old - 60))
    assert is_ready_for_index(p)


def test_pending_blocks_index(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "avv_gallery.file_stability.FILE_RECENT_MODIFY_SEC",
        0,
    )
    p = tmp_path / "growing.mp4"
    p.write_bytes(b"\x00" * 512)
    notify_file_activity(p)
    assert not is_ready_for_index(p)


def test_is_file_stable(tmp_path):
    p = tmp_path / "stable.mp4"
    p.write_bytes(b"\x00" * 2048)
    assert is_file_stable(p)
