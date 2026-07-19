# -*- coding: utf-8 -*-
"""可随客户端断开而停止读盘的 HTTP Range 文件流。"""
from __future__ import annotations

import asyncio
from pathlib import Path

from starlette.requests import Request
from starlette.responses import Response, StreamingResponse

_CHUNK_BYTES = 256 * 1024


def _parse_range(range_header: str | None, file_size: int) -> tuple[int, int]:
    """返回 inclusive (start, end)。"""
    if file_size <= 0:
        return 0, 0
    if not range_header or not range_header.startswith("bytes="):
        return 0, file_size - 1
    spec = range_header[6:].strip()
    if "-" not in spec:
        return 0, file_size - 1
    start_s, end_s = spec.split("-", 1)
    if start_s:
        start = int(start_s)
        end = int(end_s) if end_s else file_size - 1
    else:
        suffix = int(end_s) if end_s else 0
        start = max(0, file_size - suffix)
        end = file_size - 1
    start = max(0, min(start, file_size - 1))
    end = max(start, min(end, file_size - 1))
    return start, end


def _read_at(path: Path, offset: int, size: int) -> bytes:
    with path.open("rb") as f:
        f.seek(offset)
        return f.read(size)


async def stream_file_with_disconnect(
    request: Request,
    path: Path,
    *,
    media_type: str,
) -> Response:
    file_size = path.stat().st_size
    start, end = _parse_range(request.headers.get("range"), file_size)
    length = end - start + 1
    partial = bool(request.headers.get("range"))

    async def body():
        offset = start
        remaining = length
        while remaining > 0:
            if await request.is_disconnected():
                return
            n = min(_CHUNK_BYTES, remaining)
            chunk = await asyncio.to_thread(_read_at, path, offset, n)
            if not chunk:
                break
            offset += len(chunk)
            remaining -= len(chunk)
            yield chunk

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
        "Cache-Control": "no-store",
    }
    if partial:
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
        return StreamingResponse(
            body(),
            status_code=206,
            media_type=media_type,
            headers=headers,
        )
    return StreamingResponse(body(), status_code=200, media_type=media_type, headers=headers)
