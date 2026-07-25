# -*- coding: utf-8 -*-
"""对已运行的 Loc Gallery 服务做专辑功能端到端自检。"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:3456"


def call(method: str, path: str, body: dict | None = None) -> dict:
    data = None
    headers: dict[str, str] = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} -> {exc.code}: {detail}") from exc


def main() -> int:
    print("=== Album E2E ===")
    health = call("GET", "/api/health")
    if not health.get("ok"):
        print("FAIL: health check")
        return 1
    lib = call("GET", "/api/libraries")["active_library_id"]
    q = f"?library_id={lib}"
    print(f"library: {lib}")

    call("GET", f"/api/albums{q}")

    videos = call("GET", f"/api/videos{q}&page_size=3")
    items = videos.get("items") or []
    if len(items) < 2:
        print("SKIP: need at least 2 videos in library")
        return 0
    v1, v2 = items[0]["id"], items[1]["id"]

    created = call("POST", f"/api/albums{q}", {"name": "__e2e_album__", "description": "e2e"})
    aid = created["album"]["id"]
    print(f"created: {aid}")

    added = call("POST", f"/api/albums/{aid}/videos{q}", {"ids": [v1, v2]})
    assert added["video_count"] == 2, added
    assert added["cover_video_id"] == v1, added
    print("add videos + default cover ok")

    detail = call("GET", f"/api/albums/{aid}{q}")
    assert detail["video_count"] == 2, detail
    assert "total_duration_sec" in detail, detail
    print("get detail ok")

    filtered = call("GET", f"/api/videos{q}&album_id={aid}")
    assert filtered["total"] == 2, filtered
    assert aid in (filtered["items"][0].get("albumIds") or []), filtered
    print("filter videos by album ok")

    call("POST", f"/api/albums/{aid}/cover{q}", {"video_id": v2})
    detail2 = call("GET", f"/api/albums/{aid}{q}")
    assert detail2["cover_video_id"] == v2, detail2
    print("set cover ok")

    call("PATCH", f"/api/albums/{aid}{q}", {"name": "__e2e_renamed__"})
    print("patch ok")

    call("POST", f"/api/albums/{aid}/videos/remove{q}", {"ids": [v2]})
    left = call("GET", f"/api/albums/{aid}{q}")
    assert left["video_count"] == 1, left
    print("remove video ok")

    call("DELETE", f"/api/albums/{aid}{q}")
    try:
        call("GET", f"/api/albums/{aid}{q}")
        print("FAIL: album should be gone")
        return 1
    except RuntimeError as exc:
        if "404" not in str(exc):
            raise
    print("delete ok")
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
