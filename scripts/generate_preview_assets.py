# -*- coding: utf-8 -*-
"""从 Picsum 等开放图库下载 README 预览素材（无需 API Key）。"""
from __future__ import annotations

import os
import ssl
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "static" / "preview" / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)
THUMB_COUNT = 32

DEFAULT_PROXY = "http://127.0.0.1:10808"
USER_AGENT = "Loc-Gallery-Preview/1.0 (+https://github.com/hoolulu/Loc-Gallery)"

# Picsum：开源占位图服务，直链稳定、无需 Referer
PICSUM_THUMB = "https://picsum.photos/seed/loc-gallery-{n:02d}/960/540"
PICSUM_HERO = "https://picsum.photos/seed/loc-gallery-hero/1920/1080"

# 兜底：Wikimedia Commons 风景图（CC 协议，直链可下载）
WIKIMEDIA_FALLBACK = [
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Fronalpstock_big.jpg/1280px-Fronalpstock_big.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Lake_Kawaguchiko_Sakura_Mount_Fuji_3.jpg/1280px-Lake_Kawaguchiko_Sakura_Mount_Fuji_3.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Hintersee_-_view_from_Malerwinkel.jpg/1280px-Hintersee_-_view_from_Malerwinkel.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Hallstatt_-_panoramio_%281%29.jpg/1280px-Hallstatt_-_panoramio_%281%29.jpg",
]


def proxy_url() -> str | None:
    if os.environ.get("LOC_GALLERY_NO_PROXY", "").strip().lower() in ("1", "true", "yes"):
        return None
    for key in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"):
        val = os.environ.get(key, "").strip()
        if val:
            return val
    return DEFAULT_PROXY


def build_opener() -> urllib.request.OpenerDirector:
    proxy = proxy_url()
    handlers: list = []
    if proxy:
        handlers.append(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    handlers.append(urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    return urllib.request.build_opener(*handlers)


def download(url: str, dest: Path, opener: urllib.request.OpenerDirector, *, force: bool = False) -> bool:
    if not force and dest.exists() and dest.stat().st_size > 8_000:
        print(f"skip {dest.name}")
        return True
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "image/*,*/*"})
    try:
        with opener.open(req, timeout=90) as resp:
            dest.write_bytes(resp.read())
        return True
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        print(f"fail {dest.name}: {e}")
        return False


def resolve_thumb_urls() -> list[str]:
    return [PICSUM_THUMB.format(n=i) for i in range(1, THUMB_COUNT + 1)]


def main() -> None:
    proxy = proxy_url()
    opener = build_opener()
    print(f"source: picsum.photos | proxy: {proxy or '(direct)'}")

    urls = resolve_thumb_urls()
    ok = 0
    for i, url in enumerate(urls, start=1):
        dest = ASSETS / f"thumb-{i:02d}.jpg"
        print(f"thumb {i:02d} …")
        if download(url, dest, opener):
            ok += 1
        elif WIKIMEDIA_FALLBACK:
            fb = WIKIMEDIA_FALLBACK[(i - 1) % len(WIKIMEDIA_FALLBACK)]
            print(f"  fallback → {fb[:60]}…")
            if download(fb, dest, opener, force=True):
                ok += 1

    print("hero …")
    if not download(PICSUM_HERO, ASSETS / "hero.jpg", opener):
        download(WIKIMEDIA_FALLBACK[0], ASSETS / "hero.jpg", opener, force=True)

    print(f"done → {ASSETS} ({ok}/{THUMB_COUNT} thumbs)")


if __name__ == "__main__":
    main()
