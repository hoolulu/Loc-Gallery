# -*- coding: utf-8 -*-
"""当前请求/线程绑定的视频库上下文。"""
from __future__ import annotations

import contextvars
import threading

_library_ctx: contextvars.ContextVar[str] = contextvars.ContextVar("library_id", default="")
_thread_library: dict[int, str] = {}


def set_thread_library(library_id: str) -> None:
    _thread_library[threading.get_ident()] = library_id
    _library_ctx.set(library_id)


def current_library_id() -> str:
    lid = _thread_library.get(threading.get_ident()) or _library_ctx.get()
    if lid:
        return lid
    from loc_gallery.library_store import get_active_library_id
    return get_active_library_id()
