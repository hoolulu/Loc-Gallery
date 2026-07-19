# -*- coding: utf-8 -*-
"""截取 README 用预览图（需先运行 build_preview_pages.py）。"""
from __future__ import annotations

from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PREVIEW = ROOT / "static" / "preview"
OUT = ROOT / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)

VIEWPORT_WIDTH = 1920
VIEWPORT_HEIGHT = 1080
DEVICE_SCALE = 2

SHOTS = [
    ("gallery.html", "gallery.png", {"scroll_pagination": True}),
    ("player.html", "player.png", {}),
    ("favorites.html", "favorites.png", {}),
    ("history.html", "history.png", {}),
    ("settings.html", "settings.png", {}),
    ("batch.html", "batch.png", {"scroll_selection": True}),
]


def capture(url: str, out: Path, *, scroll_pagination: bool = False, scroll_selection: bool = False) -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(
            viewport={"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT},
            device_scale_factor=DEVICE_SCALE,
        )
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_timeout(600)
        if scroll_pagination:
            page.evaluate(
                """() => {
                  const bar = document.getElementById('pagination-bottom');
                  if (bar) bar.scrollIntoView({ block: 'end', behavior: 'instant' });
                }"""
            )
            page.wait_for_timeout(400)
        if scroll_selection:
            page.evaluate(
                """() => {
                  const bar = document.getElementById('selection-bar');
                  if (bar) bar.scrollIntoView({ block: 'end', behavior: 'instant' });
                }"""
            )
            page.wait_for_timeout(400)
        page.screenshot(path=str(out), full_page=False, type="png")
        browser.close()
    w = VIEWPORT_WIDTH * DEVICE_SCALE
    h = VIEWPORT_HEIGHT * DEVICE_SCALE
    print(f"wrote {out} ({w}×{h})")


def main() -> None:
    for html_name, png_name, opts in SHOTS:
        html = PREVIEW / html_name
        if not html.is_file():
            raise SystemExit(f"missing {html} — run scripts/build_preview_pages.py first")
        capture(html.as_uri(), OUT / png_name, **opts)


if __name__ == "__main__":
    main()
