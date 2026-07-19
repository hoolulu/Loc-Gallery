# -*- coding: utf-8 -*-
"""生成与正式页面结构一致的 README 截图预览页。"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PREVIEW = ROOT / "static" / "preview"
THUMB_COUNT = 32
TOTAL_IN_CAT = 64
PAGE_SIZE = 32
TOTAL_PAGES = 2
CURRENT_PAGE = 1
FILTERED_COUNT = 12

CATEGORIES = [
    ("自然风光", 64, True, True),
    ("城市夜景", 186, False, False),
    ("海岸晨曦", 142, False, True),
    ("山林徒步", 128, False, False),
    ("星空银河", 96, True, False),
    ("四季田野", 84, False, False),
]

SUBDIRS = [
    ("山地航拍", 86, False),
    ("湖畔晨雾", 72, True),
    ("云海日出", 58, False),
    ("林间小径", 32, False),
]

TITLES = [
    "阿尔卑斯晨雾", "冰岛海岸线", "京都初夏", "挪威峡湾",
    "黄山云海", "撒哈拉暮色", "新西兰湖泊", "张家界峰林",
    "桂林山水", "青海湖画卷", "稻城秋色", "喀纳斯湖",
    "婺源村落", "塞罕坝草原", "泸沽湖镜", "亚丁三神山",
    "梅里雪山", "纳木错晨曲", "祁连山草原", "西双版纳雨林",
    "霞浦滩涂", "元阳梯田", "茶卡盐湖", "梵净山金顶",
    "大兴安岭秋色", "泸沽湖晨雾", "普者黑荷塘", "扎尕那石城",
    "可可西里", "若尔盖花湖", "巴音布鲁克", "天山天池",
]

PLAYLIST = TITLES[:10]
FAVORITE_INDICES = [1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17]
HISTORY_INDICES = [3, 1, 6, 2, 9, 4, 11, 7, 12, 5, 8, 10]
BATCH_SELECTED = {2, 5, 9, 14}


@dataclass
class GalleryView:
    page_name: str
    title: str
    body_classes: str = "preview flex h-full flex-col overflow-hidden bg-surface text-zinc-100 antialiased"
    breadcrumb: str = f'自然风光<span class="sep">/</span>湖畔晨雾'
    status: str = f"共 {TOTAL_IN_CAT} 个 · 第 {CURRENT_PAGE} / {TOTAL_PAGES} 页"
    card_indices: list[int] = field(default_factory=lambda: list(range(1, THUMB_COUNT + 1)))
    fav_indices: set[int] = field(default_factory=lambda: {2, 7, 15})
    selected_indices: set[int] = field(default_factory=set)
    playing_index: int | None = 1
    view_mode: str | None = None
    show_subdir: bool = True
    category_active: str | None = "自然风光"
    pagination: tuple[int, int] | None = (CURRENT_PAGE, TOTAL_PAGES)
    manage_active: bool = False
    settings_active: bool = False
    settings_open: bool = False
    selection_count: int = 0
    show_batch_clear: bool = False
    sort_history: bool = False


def cat_html(active_category: str | None = "自然风光") -> str:
    total = sum(c[1] for c in CATEGORIES)
    all_active = " active" if active_category is None else ""
    rows = [
        f'''      <div class="cat-item cat-all{all_active}" role="button" tabindex="0">
        <span class="cat-left"><span class="cat-name">全部</span></span>
        <span class="cat-count">{total}</span>
      </div>'''
    ]
    for name, count, starred, _active in CATEGORIES:
        cls = "cat-item"
        if active_category == name:
            cls += " active"
        if starred:
            cls += " starred"
        star_cls = "cat-star on" if starred else "cat-star"
        rows.append(
            f'''      <div class="{cls}" data-category="{name}" role="button" tabindex="0">
        <span class="cat-left">
          <span class="cat-grip" title="按住拖拽排序">⋮⋮</span>
          <span class="{star_cls}" title="加星标">★</span>
          <span class="cat-name" title="{name}">{name}</span>
        </span>
        <span class="cat-count">{count}</span>
      </div>'''
        )
    return "\n".join(rows)


def subdir_html() -> str:
    rows = ['<div class="subdir-title">子目录</div>']
    for name, count, active in SUBDIRS:
        cls = "subdir-item" + (" active" if active else "")
        rows.append(
            f'''      <button type="button" class="{cls}">
        <span class="subdir-name">{name}</span>
        <span class="subdir-count">{count}</span>
      </button>'''
        )
    return "\n".join(rows)


def pagination_numbers(page: int, total_pages: int) -> str:
    parts = []
    for p in range(1, total_pages + 1):
        active = " active" if p == page else ""
        parts.append(f'<button type="button" class="page-num ui-btn{active}">{p}</button>')
    return "\n            ".join(parts)


def grid_html(view: GalleryView) -> str:
    cards = []
    for i in view.card_indices:
        title = TITLES[i - 1]
        fav = " on" if i in view.fav_indices else ""
        playing = " playing" if view.playing_index == i else ""
        selected = " selected" if i in view.selected_indices else ""
        checked = " checked" if i in view.selected_indices else ""
        cards.append(
            f'''        <div class="card{playing}{selected}" data-id="demo-{i}">
          <div class="thumb-wrap" id="thumb-demo-{i}">
            <img src="assets/thumb-{i:02d}.jpg" alt="{title}" loading="eager">
          </div>
          <button type="button" class="card-fav{fav}" aria-label="收藏">♥</button>
          <input type="checkbox" class="card-check" aria-label="选择"{checked}>
          <div class="card-title">{title}</div>
        </div>'''
        )
    return "\n".join(cards)


def playlist_html() -> str:
    items = []
    for i, title in enumerate(PLAYLIST, start=1):
        active = " active" if i == 1 else ""
        items.append(
            f'''          <button type="button" class="player-pl-item{active}">
            <div class="player-pl-thumb"><img src="assets/thumb-{i:02d}.jpg" alt=""></div>
            <div class="player-pl-meta min-w-0">
              <p class="truncate text-xs font-medium">{title}</p>
              <p class="truncate text-[10px] text-zinc-600">scenery_clip_{i:02d}.mp4</p>
            </div>
          </button>'''
        )
    return "\n".join(items)


def view_mode_btn(label: str, icon: str, mode: str, active: str | None) -> str:
    cls = "view-mode-btn ui-btn rounded-lg border border-surface-border px-2.5 py-1 text-xs"
    if active == mode:
        cls += " active"
    return (
        f'<button type="button" class="{cls}" data-view="{mode}">'
        f'<span class="view-mode-icon" aria-hidden="true">{icon}</span>{label}</button>'
    )


def pagination_block(view: GalleryView) -> str:
    if not view.pagination:
        return ""
    page, total_pages = view.pagination
    page_text = f"第 {page} / {total_pages} 页"
    nums = pagination_numbers(page, total_pages)
    prev_disabled = " disabled" if page <= 1 else ""
    next_disabled = " disabled" if page >= total_pages else ""
    first_disabled = prev_disabled
    last_disabled = next_disabled
    return f'''
          <nav id="pagination-bottom" class="pagination-bar">
            <button type="button" class="page-nav ui-btn" data-action="first" title="第一页"{first_disabled}>«</button>
            <button type="button" class="page-nav ui-btn" data-action="prev" title="上一页"{prev_disabled}>◀ 上一页</button>
            <div id="page-numbers" class="page-numbers">
            {nums}
            </div>
            <span id="page-info-bottom" class="page-info-text">{page_text}</span>
            <button type="button" class="page-nav ui-btn" data-action="next" title="下一页"{next_disabled}>下一页 ▶</button>
            <button type="button" class="page-nav ui-btn" data-action="last" title="最后一页"{last_disabled}>»</button>
            <label class="page-jump">跳至
              <input type="number" id="page-jump-input" min="1" value="{page}" class="dlg-input">
              页
            </label>
          </nav>'''


def settings_dialog_html(*, open_dialog: bool) -> str:
    open_attr = " open" if open_dialog else ""
    return f'''
  <dialog id="settings-dialog" class="app-dialog"{open_attr}>
    <form id="settings-form" class="p-6">
      <h2 class="text-lg font-semibold">设置</h2>
      <div class="mt-5">
        <span class="text-sm text-zinc-400">播放方式</span>
        <div class="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-surface-border bg-zinc-950 p-1">
          <label class="cursor-pointer">
            <input type="radio" name="player-mode" value="html5" class="peer sr-only">
            <span class="flex items-center justify-center rounded-lg px-3 py-2.5 text-sm text-zinc-500 transition peer-checked:bg-accent peer-checked:text-white">网页 HTML5</span>
          </label>
          <label class="cursor-pointer">
            <input type="radio" name="player-mode" value="potplayer" class="peer sr-only" checked>
            <span class="flex items-center justify-center rounded-lg px-3 py-2.5 text-sm text-zinc-500 transition peer-checked:bg-accent peer-checked:text-white">PotPlayer</span>
          </label>
        </div>
        <p class="hint mt-2">HTML5 在页面内播放；碎片化视频将自动边切边播。PotPlayer 调用本地播放器。</p>
      </div>
      <label class="mt-4 block text-sm text-zinc-400">截图位置（仅影响新生成的缩略图）
        <input type="number" value="0.6" min="0.05" max="0.95" step="0.05" class="dlg-input mt-1.5 w-full">
      </label>
      <label class="mt-4 block text-sm text-zinc-400">随机截图范围（用于「随机生成」）
        <div class="range-inputs mt-1.5 flex items-center gap-2">
          <input type="number" value="0.5" min="0.05" max="0.95" step="0.05" class="dlg-input w-full">
          <span class="range-sep text-zinc-600">~</span>
          <input type="number" value="0.8" min="0.05" max="0.95" step="0.05" class="dlg-input w-full">
        </div>
      </label>
      <label class="mt-4 block text-sm text-zinc-400">并发线程数
        <input type="number" value="3" min="1" max="8" step="1" class="dlg-input mt-1.5 w-full">
      </label>
      <label class="mt-4 block text-sm text-zinc-400">空闲时扫描全库
        <select class="dlg-input mt-1.5 w-full">
          <option value="true">是</option>
          <option value="false" selected>否（仅按需生成）</option>
        </select>
      </label>
      <label class="mt-4 block text-sm text-zinc-400">默认每页数量
        <select class="dlg-input mt-1.5 w-full">
          <option value="32" selected>32</option>
          <option value="64">64</option>
          <option value="0">全部</option>
        </select>
      </label>
      <label class="mt-4 block text-sm text-zinc-400">PotPlayer 路径
        <input type="text" value="C:\\Program Files\\DAUM\\PotPlayer\\PotPlayerMini64.exe" class="dlg-input mt-1.5 w-full text-xs">
      </label>
      <label class="mt-4 block text-sm text-zinc-400">最近播放保留天数
        <input type="number" value="180" min="1" max="3650" step="1" class="dlg-input mt-1.5 w-full">
      </label>
      <button type="button" class="ui-btn mt-3 w-full rounded-lg border border-surface-border px-4 py-2 text-sm">清空最近播放记录</button>
      <p class="hint mt-4">修改截图比例不会改动已有缩略图；并发数需重启服务后生效</p>
      <div class="dialog-btns mt-6 flex justify-end gap-2">
        <button type="button" class="ui-btn rounded-lg px-4 py-2">取消</button>
        <button type="button" class="ui-btn ui-btn-primary rounded-lg px-4 py-2">保存</button>
      </div>
    </form>
  </dialog>'''


def selection_bar_html(count: int) -> str:
    if count <= 0:
        return ""
    return f'''
  <div id="selection-bar" class="selection-bar">
    <span id="selection-count">已选 {count} 个</span>
    <button class="ui-btn">加入收藏</button>
    <button class="ui-btn">取消收藏</button>
    <button class="ui-btn">播放</button>
    <button class="ui-btn">重命名</button>
    <button class="ui-btn">移动</button>
    <button class="ui-btn">生成缩略图</button>
    <button class="ui-btn danger">删除到回收站</button>
    <button class="ui-btn">取消</button>
  </div>'''


def gallery_page(view: GalleryView) -> str:
    page_text = ""
    if view.pagination:
        page_text = f"第 {view.pagination[0]} / {view.pagination[1]} 页"

    manage_cls = " ui-btn active" if view.manage_active else ""
    settings_cls = " ui-btn active" if view.settings_active else ""
    batch_clear_cls = "" if view.show_batch_clear else " hidden"
    subdir_panel = subdir_html() if view.show_subdir else ""
    subdir_cls = "subdir-nav" if view.show_subdir else "subdir-nav hidden"

    toolbar_pagination = ""
    if view.pagination:
        page, total_pages = view.pagination
        toolbar_pagination = f'''
            <div class="pagination flex items-center gap-2 text-sm">
              <button class="ui-btn rounded-lg border border-surface-border px-2 py-1"{" disabled" if page <= 1 else ""}>◀</button>
              <span class="text-zinc-500">{page_text}</span>
              <button class="ui-btn rounded-lg border border-surface-border px-2 py-1"{" disabled" if page >= total_pages else ""}>▶</button>
            </div>'''

    sort_options = [
        ('mtime_desc', '最新优先', not view.sort_history),
        ('played_desc', '最近播放', view.sort_history),
        ('title_asc', '标题 A-Z', False),
        ('size_desc', '体积最大', False),
    ]
    sort_html = "\n".join(
        f'              <option value="{val}"{" selected" if selected else ""}>{label}</option>'
        for val, label, selected in sort_options
    )

    return f"""<!DOCTYPE html>
<html lang="zh-CN" class="h-full">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Loc Gallery · {view.title}</title>
  <link rel="stylesheet" href="../tailwind.css?v=1">
  <link rel="stylesheet" href="../style.css?v=46">
  <style>
    body.preview .card-fav.on {{ opacity: 1; }}
    body.preview .card:hover .card-fav.on {{ opacity: 1; }}
  </style>
</head>
<body class="{view.body_classes}">

  <header class="z-50 shrink-0 border-b border-surface-border bg-surface-raised/95 backdrop-blur-sm">
    <div class="flex flex-wrap items-center gap-3 px-5 py-3">
      <h1 class="text-lg font-bold tracking-tight"><span class="text-accent">Loc</span> Gallery</h1>
      <div class="ml-auto flex min-w-[280px] flex-1 items-center justify-end gap-2">
        <input type="search" placeholder="搜索标题 / 文件名 / 分类..." autocomplete="off"
          class="w-full max-w-sm rounded-lg border border-surface-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30">
        <button class="ui-btn shrink-0 rounded-lg border border-surface-border px-3 py-2 text-sm{manage_cls}">批量</button>
        <button class="ui-btn shrink-0 rounded-lg border border-surface-border px-3 py-2 text-sm{settings_cls}">设置</button>
        <button class="ui-btn shrink-0 rounded-lg border border-surface-border bg-zinc-800 px-3 py-2 text-sm">刷新</button>
      </div>
    </div>
    <div class="progress-bar-wrap px-5 pb-3">
      <div class="progress-info">
        <div class="progress-info-left">
          <span id="progress-text">全库 64/65 (98.5%) | 当前页 {PAGE_SIZE}/{PAGE_SIZE} | 队列 0 | 生成中 0 | 未开始 1 · 仅按需生成当前浏览页面的缩略图</span>
        </div>
        <div class="progress-actions">
          <button class="ui-btn sm rounded-md border border-surface-border px-2.5 py-1">暂停</button>
        </div>
      </div>
      <div class="progress-track mt-2"><div id="progress-fill" class="progress-fill" style="width:99.9%"></div></div>
    </div>
  </header>

  <div class="layout flex min-h-0 flex-1">
    <aside id="sidebar" class="flex w-60 shrink-0 flex-col border-r border-surface-border bg-surface">
      <div class="sidebar-head border-b border-surface-border">
        <div class="sidebar-title">分类</div>
        <select class="sidebar-sort" title="分类排序">
          <option selected>自定义（拖拽排序）</option>
          <option>名称 A-Z</option>
          <option>数量多到少</option>
        </select>
      </div>
      <div id="category-list" class="cat-nav">
{cat_html(view.category_active)}
      </div>
      <div id="folder-panel" class="{subdir_cls}">
{subdir_panel}
      </div>
    </aside>

    <div id="content-wrap" class="flex min-h-0 min-w-0 flex-1">
      <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div id="gallery-toolbar" class="toolbar flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 pt-4">
          <div class="toolbar-left flex flex-wrap items-center gap-3">
            <span id="breadcrumb" class="breadcrumb text-sm text-zinc-400">{view.breadcrumb}</span>
            <span id="status" class="status text-sm text-zinc-500">{view.status}</span>
            <div class="batch-tools flex items-center gap-2 border-l border-surface-border pl-3">
              <label class="batch-select-label flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
                <input type="checkbox" id="select-page-all" class="h-4 w-4 accent-red-600">
                <span>全选本页</span>
              </label>
              <button type="button" id="btn-batch-clear" class="ui-btn sm rounded-md px-2 py-1{batch_clear_cls}">取消选择</button>
            </div>
            <select id="sort" class="rounded-lg border border-surface-border bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300">
{sort_html}
            </select>
          </div>
          <div class="toolbar-right flex items-center gap-3">
            <div class="view-mode-btns flex gap-1 border-r border-surface-border pr-3">
              {view_mode_btn("我的收藏", "♥", "favorites", view.view_mode)}
              {view_mode_btn("最近播放", "⏱", "history", view.view_mode)}
            </div>
            <div class="page-size-btns flex gap-1">
              <button class="page-size ui-btn rounded-lg px-2.5 py-1 text-xs active">32</button>
              <button class="page-size ui-btn rounded-lg border border-surface-border px-2.5 py-1 text-xs">64</button>
              <button class="page-size ui-btn rounded-lg border border-surface-border px-2.5 py-1 text-xs">全部</button>
            </div>{toolbar_pagination}
          </div>
        </div>

        <div id="gallery-view" class="min-h-0 flex-1 overflow-y-auto px-5 pb-20 pt-4">
          <div id="grid" class="grid">
{grid_html(view)}
          </div>{pagination_block(view)}
        </div>
      </main>
    </div>
  </div>
{selection_bar_html(view.selection_count)}{settings_dialog_html(open_dialog=view.settings_open)}
</body>
</html>"""


def player_html() -> str:
    return f"""<!DOCTYPE html>
<html lang="zh-CN" class="h-full">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Loc Gallery · Player Preview</title>
  <link rel="stylesheet" href="../tailwind.css?v=1">
  <link rel="stylesheet" href="../style.css?v=46">
  <style>
    .player-mock {{
      position: relative;
      display: flex;
      flex: 1 1 auto;
      width: 100%;
      height: 100%;
      min-height: 12rem;
      overflow: hidden;
      background: #000;
      border-radius: 0.25rem;
    }}
    .player-mock-frame {{
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }}
    .player-mock-controls {{
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      gap: 0.65rem;
      padding: 0.45rem 0.75rem;
      background: linear-gradient(transparent, rgba(0,0,0,0.82));
      color: #f4f4f5;
      font: 12px/1.2 system-ui, sans-serif;
    }}
    .player-mock-btn {{
      width: 1.5rem;
      height: 1.5rem;
      border: 0;
      border-radius: 0.25rem;
      background: transparent;
      color: inherit;
      font-size: 0.95rem;
      cursor: default;
    }}
    .player-mock-progress {{
      flex: 1;
      height: 0.28rem;
      border-radius: 999px;
      background: rgba(255,255,255,0.25);
      overflow: hidden;
    }}
    .player-mock-progress > span {{
      display: block;
      width: 28%;
      height: 100%;
      background: #e50914;
      border-radius: inherit;
    }}
    .player-mock-time {{ opacity: 0.9; white-space: nowrap; }}
    .player-mock-icon {{ opacity: 0.85; font-size: 0.9rem; }}
  </style>
</head>
<body class="flex h-full flex-col overflow-hidden bg-surface text-zinc-100 antialiased">

  <header class="z-50 shrink-0 border-b border-surface-border bg-surface-raised/95 backdrop-blur-sm">
    <div class="flex flex-wrap items-center gap-3 px-5 py-3">
      <h1 class="text-lg font-bold tracking-tight"><span class="text-accent">Loc</span> Gallery</h1>
      <div class="ml-auto flex min-w-[280px] flex-1 items-center justify-end gap-2">
        <input type="search" placeholder="搜索标题 / 文件名 / 分类..." class="w-full max-w-sm rounded-lg border border-surface-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none">
        <button class="ui-btn shrink-0 rounded-lg border border-surface-border px-3 py-2 text-sm">批量</button>
        <button class="ui-btn shrink-0 rounded-lg border border-surface-border px-3 py-2 text-sm">设置</button>
        <button class="ui-btn shrink-0 rounded-lg border border-surface-border bg-zinc-800 px-3 py-2 text-sm">刷新</button>
      </div>
    </div>
    <div class="progress-bar-wrap px-5 pb-3">
      <div class="progress-info">
        <div class="progress-info-left">
          <span>全库 64/65 (98.5%) | 当前页 {PAGE_SIZE}/{PAGE_SIZE} | 队列 0 | 生成中 0 | 未开始 1 · 仅按需生成当前浏览页面的缩略图</span>
        </div>
        <div class="progress-actions">
          <button class="ui-btn sm rounded-md border border-surface-border px-2.5 py-1">暂停</button>
        </div>
      </div>
      <div class="progress-track mt-2"><div class="progress-fill" style="width:99.9%"></div></div>
    </div>
  </header>

  <div class="layout flex min-h-0 flex-1">
    <aside id="sidebar" class="flex w-60 shrink-0 flex-col border-r border-surface-border bg-surface">
      <div class="sidebar-head border-b border-surface-border">
        <div class="sidebar-title">分类</div>
        <select class="sidebar-sort"><option selected>自定义（拖拽排序）</option></select>
      </div>
      <div id="category-list" class="cat-nav">
{cat_html()}
      </div>
      <div id="folder-panel" class="subdir-nav">
{subdir_html()}
      </div>
    </aside>

    <div id="content-wrap" class="flex min-h-0 min-w-0 flex-1">
      <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div id="player-view" class="player-view flex min-h-0 flex-1 flex-col overflow-hidden">
          <div class="player-view-header flex shrink-0 flex-wrap items-center gap-3 border-b border-surface-border px-5 py-3">
            <button type="button" class="ui-btn rounded-lg border border-surface-border px-3 py-1.5 text-sm">← 返回列表</button>
            <div class="min-w-0 flex-1">
              <h2 class="truncate text-sm font-semibold text-zinc-100">阿尔卑斯晨雾</h2>
              <p class="truncate text-xs text-zinc-500" title="D:\\Videos\\自然风光\\湖畔晨雾\\scenery_clip_01.mp4">D:\\Videos\\自然风光\\湖畔晨雾\\scenery_clip_01.mp4</p>
              <p class="player-status text-xs text-amber-400/90">标准格式 · H264</p>
            </div>
            <div class="flex gap-2">
              <button type="button" class="ui-btn sm rounded px-2 py-1 text-xs">上一个</button>
              <button type="button" class="ui-btn sm rounded px-2 py-1 text-xs">下一个</button>
              <button type="button" class="ui-btn sm rounded px-2 py-1 text-xs">PotPlayer</button>
            </div>
          </div>
          <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
            <div id="player-stage" class="player-stage flex min-h-0 flex-1 p-2 sm:p-4">
              <div class="player-mock" aria-label="模拟播放界面">
                <img class="player-mock-frame" src="assets/hero.jpg" alt="阿尔卑斯晨雾">
                <div class="player-mock-controls">
                  <button type="button" class="player-mock-btn" aria-hidden="true">⏸</button>
                  <div class="player-mock-progress" aria-hidden="true"><span></span></div>
                  <span class="player-mock-time">0:42 / 3:18</span>
                  <span class="player-mock-icon" aria-hidden="true">🔊</span>
                  <span class="player-mock-icon" aria-hidden="true">⛶</span>
                </div>
              </div>
            </div>
            <div id="player-playlist" class="player-playlist w-full shrink-0 overflow-y-auto border-t border-surface-border p-2 lg:w-72 lg:border-l lg:border-t-0">
{playlist_html()}
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</body>
</html>"""


def gallery_views() -> list[tuple[str, GalleryView]]:
    return [
        ("gallery.html", GalleryView(page_name="gallery", title="Gallery")),
        ("favorites.html", GalleryView(
            page_name="favorites",
            title="Favorites",
            breadcrumb="我的收藏",
            status=f"{FILTERED_COUNT} 个收藏",
            card_indices=FAVORITE_INDICES,
            fav_indices=set(FAVORITE_INDICES),
            playing_index=None,
            view_mode="favorites",
            show_subdir=False,
            category_active=None,
            pagination=None,
        )),
        ("history.html", GalleryView(
            page_name="history",
            title="History",
            breadcrumb="最近播放",
            status=f"{FILTERED_COUNT} 条最近播放",
            card_indices=HISTORY_INDICES,
            fav_indices={2, 7, 11},
            playing_index=HISTORY_INDICES[0],
            view_mode="history",
            show_subdir=False,
            category_active=None,
            pagination=None,
            sort_history=True,
        )),
        ("settings.html", GalleryView(
            page_name="settings",
            title="Settings",
            settings_active=True,
            settings_open=True,
        )),
        ("batch.html", GalleryView(
            page_name="batch",
            title="Batch Select",
            body_classes="preview manage-mode has-selection flex h-full flex-col overflow-hidden bg-surface text-zinc-100 antialiased",
            selected_indices=BATCH_SELECTED,
            playing_index=None,
            manage_active=True,
            selection_count=len(BATCH_SELECTED),
            show_batch_clear=True,
        )),
    ]


def main() -> None:
    PREVIEW.mkdir(parents=True, exist_ok=True)
    written = []
    for filename, view in gallery_views():
        path = PREVIEW / filename
        path.write_text(gallery_page(view), encoding="utf-8")
        written.append(filename)
    (PREVIEW / "player.html").write_text(player_html(), encoding="utf-8")
    written.append("player.html")
    print("wrote " + ", ".join(written))


if __name__ == "__main__":
    main()
