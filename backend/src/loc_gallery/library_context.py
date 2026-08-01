# -*- coding: utf-8 -*-
"""当前请求/线程绑定的视频库上下文。"""
from __future__ import annotations

import contextvars

_library_ctx: contextvars.ContextVar[str] = contextvars.ContextVar("library_id", default="")


def set_thread_library(library_id: str) -> None:
    _library_ctx.set(library_id)


def current_library_id() -> str:
    lid = _library_ctx.get()
    if lid:
        return lid
    from loc_gallery.library_store import get_active_library_id
    return get_active_library_id()
