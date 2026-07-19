(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const LS_KEY = "loc-gallery-state";

  const state = {
    category: "",
    folder: "",
    query: "",
    sort: "mtime_desc",
    page: 1,
    pageSize: 32,
    categorySortMode: "custom",
    expandedCategories: new Set(),
    folderTrees: {},
    manageMode: false,
    selected: new Set(),
    pageItems: [],
    total: 0,
    totalPages: 1,
    ctxTarget: null,
    thumbBust: {},
    playingId: null,
    playerMode: "potplayer",
    playerViewOpen: false,
    failedItems: [],
    playSession: 0,
    activeSliceVideoId: null,
    viewMode: "browse",
  };

  let searchTimer = null;
  let thumbRetryTimers = {};
  let progressTimer = null;
  let progressPollMs = 8000;
  let lastProgressSig = "";
  let versionDebounceTimer = null;
  let lastLibraryVersion = "";
  let hlsInstance = null;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      if (saved.category !== undefined) state.category = saved.category;
      if (saved.folder !== undefined) state.folder = saved.folder;
      if (saved.expandedCategories) state.expandedCategories = new Set(saved.expandedCategories);
      if (saved.sort) state.sort = saved.sort;
      if (saved.pageSize !== undefined) {
        const ps = saved.pageSize;
        state.pageSize = ps === 28 ? 32 : ps === 56 ? 64 : ps;
      }
      if (saved.page) state.page = saved.page;
    } catch (_) { /* ignore */ }
  }

  function saveState() {
    localStorage.setItem(LS_KEY, JSON.stringify({
      category: state.category,
      folder: state.folder,
      expandedCategories: [...state.expandedCategories],
      sort: state.sort,
      pageSize: state.pageSize,
      page: state.page,
    }));
  }

  let pathTipTimer = null;
  let pathTipAnchor = null;

  function getPathDir(path, filename) {
    if (!path) return "";
    if (filename && path.endsWith(filename)) {
      return path.slice(0, path.length - filename.length).replace(/[\\/]+$/, "");
    }
    const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
    return idx >= 0 ? path.slice(0, idx) : "";
  }

  function renderPathSegments(dir) {
    if (!dir) return "";
    const parts = dir.split(/[/\\]/).filter(Boolean);
    return parts.map((seg, i) => {
      const sep = i > 0 ? '<span class="path-sep">\\</span>' : "";
      return `${sep}<span class="path-seg">${esc(seg)}</span>`;
    }).join("");
  }

  function positionPathTip(anchor) {
    const tip = $("#path-tip");
    const rect = anchor.getBoundingClientRect();
    tip.style.visibility = "hidden";
    tip.classList.remove("hidden");
    const tipRect = tip.getBoundingClientRect();
    const pad = 10;
    let left = rect.left + (rect.width - tipRect.width) / 2;
    let top = rect.top - tipRect.height - 8;
    if (left < pad) left = pad;
    if (left + tipRect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - tipRect.width - pad);
    }
    if (top < pad) top = rect.bottom + 8;
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
    tip.style.visibility = "";
  }

  function formatTs(ts) {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    const pad = n => String(n).padStart(2, "0");
    const now = new Date();
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    if (d.toDateString() === now.toDateString()) return `今天 ${hh}:${mm}`;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hh}:${mm}`;
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    if (d.getFullYear() === now.getFullYear()) return `${m}-${day} ${hh}:${mm}`;
    return `${y}-${m}-${day} ${hh}:${mm}`;
  }

  function pathTipExtras(item) {
    const parts = [];
    if (item.favorited && item.favoritedAt) {
      parts.push(`收藏于 ${formatTs(item.favoritedAt)}`);
    } else if (item.favorited) {
      parts.push("已收藏");
    }
    if (item.playedAt) {
      const n = item.playCount || 1;
      parts.push(`最近播放 ${formatTs(item.playedAt)} · 累计 ${n} 次`);
    }
    return parts.map(t => `<div class="path-tip-meta">${esc(t)}</div>`).join("");
  }

  function showPathTip(anchor, item) {
    if (!item?.path) return;
    pathTipAnchor = anchor;
    const tip = $("#path-tip");
    const dir = getPathDir(item.path, item.filename);
    tip.innerHTML = `
      <div class="path-tip-file">${esc(item.filename || item.path)}</div>
      <div class="path-tip-dir"><div class="path-segments">${renderPathSegments(dir)}</div></div>
      ${pathTipExtras(item)}`;
    positionPathTip(anchor);
  }

  function hidePathTip() {
    clearTimeout(pathTipTimer);
    pathTipTimer = null;
    pathTipAnchor = null;
    $("#path-tip")?.classList.add("hidden");
  }

  function schedulePathTip(anchor, item) {
    if (pathTipAnchor === anchor) return;
    clearTimeout(pathTipTimer);
    pathTipTimer = setTimeout(() => showPathTip(anchor, item), 220);
  }

  function bindPathTip(wrap, item) {
    wrap.addEventListener("mouseenter", () => schedulePathTip(wrap, item));
    wrap.addEventListener("mouseleave", hidePathTip);
  }

  async function api(path, opts) {
    const res = await fetch(path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || res.statusText);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("json")) return res.json();
    return res;
  }

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function escAttr(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function highlight(text, query) {
    if (!query) return esc(text);
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) return esc(text);
    return esc(text.slice(0, idx))
      + "<mark>" + esc(text.slice(idx, idx + query.length)) + "</mark>"
      + esc(text.slice(idx + query.length));
  }

  function getPaged() {
    return {
      items: state.pageItems,
      totalPages: state.totalPages,
      page: state.page,
      total: state.total,
    };
  }

  function updatePagination(totalPages, page, total) {
    const showPager = state.pageSize !== 0 && total > 0;
    $("#pagination-bottom").classList.toggle("hidden", !showPager);

    const prevDisabled = page <= 1;
    const nextDisabled = page >= totalPages || state.pageSize === 0;

    $("#btn-prev").disabled = prevDisabled;
    $("#btn-next").disabled = nextDisabled;

    const pageText = state.pageSize === 0
      ? `全部 ${total} 个`
      : `第 ${page} / ${totalPages} 页`;

    $("#page-info").textContent = pageText;
    $("#page-info-bottom").textContent = pageText;
    $("#page-jump-input").value = page;
    $("#page-jump-input").max = totalPages;

    document.querySelectorAll(".page-nav").forEach(btn => {
      const action = btn.dataset.action;
      if (action === "first" || action === "prev") btn.disabled = prevDisabled;
      if (action === "next" || action === "last") btn.disabled = nextDisabled;
    });

    const nums = $("#page-numbers");
    if (!showPager) {
      nums.innerHTML = "";
      return;
    }

    const pages = [];
    const windowSize = 5;
    let start = Math.max(1, page - Math.floor(windowSize / 2));
    let end = Math.min(totalPages, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    if (start > 1) {
      pages.push(1);
      if (start > 2) pages.push("...");
    }
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages) {
      if (end < totalPages - 1) pages.push("...");
      pages.push(totalPages);
    }

    nums.innerHTML = pages.map(p => {
      if (p === "...") return `<span class="page-ellipsis">…</span>`;
      return `<button class="page-num ${p === page ? "active" : ""}" data-page="${p}">${p}</button>`;
    }).join("");

    nums.querySelectorAll(".page-num").forEach(btn => {
      btn.addEventListener("click", () => goToPage(parseInt(btn.dataset.page, 10)));
    });
  }

  function goToPage(page) {
    const totalPages = state.totalPages || 1;
    state.page = Math.max(1, Math.min(page, totalPages));
    loadVideos();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function getCategoryOrderFromDom(list) {
    return [...list.querySelectorAll(".cat-item[data-category]")]
      .map(el => el.dataset.category)
      .filter(Boolean);
  }

  async function saveCategoryOrder(order) {
    if (!order?.length) return;
    const data = await api("/api/categories/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
    await renderCategoryList(data.items, state.categorySortMode);
  }

  function bindCategoryDrag(list) {
    if (state.categorySortMode !== "custom") return;

    let dragging = null;

    const onMove = (e) => {
      if (!dragging) return;
      const y = e.clientY;
      const starred = dragging.classList.contains("starred");
      const siblings = [...list.querySelectorAll(".cat-item[data-category]")]
        .filter(el => el.dataset.category && el !== dragging
          && el.classList.contains("starred") === starred);
      for (const sib of siblings) {
        const box = sib.getBoundingClientRect();
        if (y < box.top + box.height / 2) {
          if (dragging !== sib && dragging.nextElementSibling !== sib) {
            list.insertBefore(dragging, sib);
          }
          return;
        }
      }
      const last = siblings[siblings.length - 1];
      if (last && last !== dragging) {
        list.insertBefore(dragging, last.nextSibling);
      }
    };

    const onUp = async () => {
      if (!dragging) return;
      dragging.classList.remove("dragging");
      dragging = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      await saveCategoryOrder(getCategoryOrderFromDom(list));
    };

    list.querySelectorAll(".cat-grip").forEach(grip => {
      grip.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const item = grip.closest(".cat-item");
        if (!item?.dataset.category) return;
        dragging = item;
        item.classList.add("dragging");
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    });
  }

  async function fetchFolderTree(category) {
    if (!state.folderTrees[category]) {
      state.folderTrees[category] = await api(
        `/api/folders?category=${encodeURIComponent(category)}`
      );
    }
    return state.folderTrees[category];
  }

  function flattenFolders(nodes, depth = 0) {
    const out = [];
    for (const n of nodes) {
      out.push({ ...n, depth });
      if (n.children?.length) out.push(...flattenFolders(n.children, depth + 1));
    }
    return out;
  }

  async function renderSubdirPanel(cats) {
    const panel = $("#folder-panel");
    if (!state.category) {
      panel.classList.add("hidden");
      panel.innerHTML = "";
      return;
    }
    let tree;
    try {
      tree = await fetchFolderTree(state.category);
    } catch (_) {
      panel.classList.add("hidden");
      panel.innerHTML = "";
      return;
    }
    const flat = flattenFolders(tree.folders || []);
    if (!flat.length) {
      panel.classList.add("hidden");
      panel.innerHTML = "";
      return;
    }
    panel.classList.remove("hidden");
    panel.innerHTML = `
      <div class="subdir-title">子目录</div>
      <button type="button" class="subdir-item ${!state.folder ? "active" : ""}" data-folder="">
        <span class="subdir-name">本目录</span>
        <span class="subdir-count">${tree.direct_count}</span>
      </button>
      ${flat.map(n => `
        <button type="button" class="subdir-item ${state.folder === n.path ? "active" : ""}"
                data-folder="${escAttr(n.path)}" style="padding-left:${14 + n.depth * 12}px">
          <span class="subdir-name" title="${escAttr(n.path)}">${esc(n.name)}</span>
          <span class="subdir-count">${n.total}</span>
        </button>`).join("")}`;
    panel.querySelectorAll(".subdir-item").forEach(btn => {
      btn.addEventListener("click", () => {
        selectCategory(state.category, btn.dataset.folder || "");
      });
    });
  }

  function selectCategory(category, folder = "") {
    if (state.viewMode !== "browse") {
      state.viewMode = "browse";
      updateViewModeButtons();
    }
    state.category = category;
    state.folder = folder;
    state.page = 1;
    if (!category) state.folder = "";
    saveState();
    loadCategories();
    loadVideos({ forceRebuild: true });
  }

  async function regenerateRandomThumbs(ids) {
    if (!ids.length) return;
    try {
      markThumbsRegenerating(ids, "random");
      const result = await api("/api/thumb/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, thumb_random: true }),
      });
      if (result.versions) {
        Object.entries(result.versions).forEach(([id, ver]) => {
          state.thumbBust[id] = ver;
        });
      }
      loadProgress();
      ids.forEach(id => scheduleThumbRefresh(id));
    } catch (err) {
      alert("重新生成失败: " + err.message);
    }
  }

  function updateViewModeButtons() {
    $$(".view-mode-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.view === state.viewMode);
    });
  }

  function setViewMode(mode) {
    if (state.viewMode === mode) {
      state.viewMode = "browse";
    } else {
      state.viewMode = mode;
      state.category = "";
      state.folder = "";
    }
    state.page = 1;
    updateViewModeButtons();
    saveState();
    loadCategories();
    loadVideos({ forceRebuild: true });
  }

  function statusLabel(total, page, totalPages) {
    if (!total) {
      if (state.viewMode === "favorites") return "暂无收藏";
      if (state.viewMode === "history") return "暂无最近播放";
      return "0 个视频";
    }
    let prefix = `${total} 个视频`;
    if (state.viewMode === "favorites") prefix = `${total} 个收藏`;
    else if (state.viewMode === "history") prefix = `${total} 条最近播放`;
    return `${prefix} · 第 ${page}/${totalPages} 页`;
  }

  function updateEmptyMessage(total) {
    let msg = "暂无视频";
    if (state.viewMode === "favorites") msg = "暂无收藏";
    else if (state.viewMode === "history") msg = "暂无最近播放";
    $("#empty").textContent = msg;
    $("#empty").classList.toggle("hidden", total > 0);
    $("#grid").classList.toggle("hidden", total === 0);
  }

  function updateBreadcrumb() {
    const el = $("#breadcrumb");
    if (state.viewMode === "favorites") {
      el.textContent = "我的收藏";
      el.classList.remove("hidden");
      return;
    }
    if (state.viewMode === "history") {
      el.textContent = "最近播放";
      el.classList.remove("hidden");
      return;
    }
    if (!state.category || state.query) {
      el.classList.add("hidden");
      return;
    }
    let html = esc(state.category);
    if (state.folder) {
      state.folder.split("/").forEach(part => {
        html += `<span class="sep">/</span>${esc(part)}`;
      });
    }
    el.innerHTML = html;
    el.classList.remove("hidden");
  }

  async function renderCategoryList(cats, sortMode) {
    state.categorySortMode = sortMode || state.categorySortMode;
    state._lastCats = cats;
    const total = cats.reduce((s, c) => s + c.count, 0);
    const list = $("#category-list");
    const sortSelect = $("#category-sort");
    if (sortSelect) sortSelect.value = state.categorySortMode;
    list.className = "cat-nav";

    const grip = state.categorySortMode === "custom"
      ? '<span class="cat-grip" title="按住拖拽排序">⋮⋮</span>'
      : "";

    list.innerHTML = `
      <div class="cat-item cat-all ${state.category === "" ? "active" : ""}" data-category="" role="button" tabindex="0">
        <span class="cat-left"><span class="cat-name">全部</span></span>
        <span class="cat-count">${total}</span>
      </div>
      ${cats.map(c => `
        <div class="cat-item ${state.category === c.name && !state.folder ? "active" : ""}${c.starred ? " starred" : ""}"
             data-category="${escAttr(c.name)}" role="button" tabindex="0">
          <span class="cat-left">
            ${grip}
            <span class="cat-star ${c.starred ? "on" : ""}" title="${c.starred ? "取消星标" : "加星标"}">★</span>
            <span class="cat-name" title="${escAttr(c.name)}">${esc(c.name)}</span>
          </span>
          <span class="cat-count">${c.count}</span>
        </div>`).join("")}`;

    list.querySelector(".cat-all")?.addEventListener("click", () => {
      state.folder = "";
      selectCategory("", "");
    });
    list.querySelector(".cat-all")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); state.folder = ""; selectCategory("", ""); }
    });

    list.querySelectorAll(".cat-item[data-category]").forEach(el => {
      const name = el.dataset.category;
      if (!name) return;
      el.addEventListener("click", (e) => {
        if (e.target.closest(".cat-star") || e.target.closest(".cat-grip")) return;
        state.folder = "";
        selectCategory(name, "");
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          if (e.target.closest(".cat-star") || e.target.closest(".cat-grip")) return;
          e.preventDefault();
          state.folder = "";
          selectCategory(name, "");
        }
      });
    });

    list.querySelectorAll(".cat-star").forEach(star => {
      star.addEventListener("click", async (e) => {
        e.stopPropagation();
        const el = star.closest(".cat-item");
        const name = el?.dataset.category;
        if (!name) return;
        const starred = !star.classList.contains("on");
        const data = await api("/api/categories/star", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, starred }),
        });
        await renderCategoryList(data.items, state.categorySortMode);
      });
    });

    bindCategoryDrag(list);
    await renderSubdirPanel(cats);
  }

  async function loadCategories() {
    const data = await api("/api/categories");
    await renderCategoryList(data.items, data.sort_mode);
  }

  function getItemById(id) {
    return state.pageItems.find(v => v.id === id);
  }

  function getFilenameStem(filename) {
    const dot = filename.lastIndexOf(".");
    return dot > 0 ? filename.slice(0, dot) : filename;
  }

  function getFilenameExt(filename) {
    const dot = filename.lastIndexOf(".");
    return dot > 0 ? filename.slice(dot) : "";
  }

  function thumbCacheKey(v) {
    if (state.thumbBust[v.id]) return state.thumbBust[v.id];
    if (v.thumbVersion) return v.thumbVersion;
    if (v.thumbReady) return `s${v.size}_${v.mtime}`;
    return "";
  }

  function thumbSig(v) {
    if (!v.thumbReady) return v.thumbStatus || "missing";
    const key = thumbCacheKey(v);
    return key ? `ready:${key}` : "ready";
  }

  function pageThumbsNeedPolling(items) {
    return items.some(v =>
      v.thumbStatus === "generating"
      || v.thumbStatus === "queued"
      || (!v.thumbReady && v.thumbStatus !== "failed")
    );
  }

  function stampThumbWrap(wrap, v) {
    if (!wrap || !v) return;
    wrap.dataset.thumbSig = thumbSig(v);
    const img = wrap.querySelector("img");
    if (img && v.thumbReady) img.dataset.thumbV = String(thumbCacheKey(v));
  }

  function stampGridThumbs(items) {
    items.forEach(v => stampThumbWrap(document.getElementById(`thumb-${v.id}`), v));
  }

  function buildVideosParams() {
    const params = new URLSearchParams();
    if (state.viewMode === "favorites") params.set("favorites", "1");
    else if (state.viewMode === "history") params.set("history", "1");
    else {
      if (state.category) params.set("category", state.category);
      if (state.category && !state.query) params.set("folder", state.folder || "");
    }
    if (state.query) params.set("q", state.query);
    params.set("sort", state.sort);
    params.set("page", String(state.page));
    params.set("page_size", String(state.pageSize));
    return params;
  }

  function thumbsNeedRefresh(items) {
    if (pageThumbsNeedPolling(items)) return true;
    return items.some(v => {
      const wrap = document.getElementById(`thumb-${v.id}`);
      return wrap && wrap.dataset.thumbSig !== thumbSig(v);
    });
  }

  function markThumbsRegenerating(ids, position) {
    const bust = `${Date.now()}_${position}`;
    ids.forEach(id => {
      state.thumbBust[id] = bust;
      const item = getItemById(id);
      if (item) {
        item.thumbReady = false;
        item.thumbStatus = "queued";
        item.thumbVersion = "";
      }
      const wrap = document.getElementById(`thumb-${id}`);
      if (wrap) {
        applyThumbToWrap(wrap, {
          id,
          title: item?.title || "",
          thumbReady: false,
          thumbStatus: "queued",
        });
      }
    });
  }

  function renderThumbHtml(v) {
    if (v.thumbReady) {
      const bust = thumbCacheKey(v);
      return `<img src="/api/thumb/${v.id}?v=${encodeURIComponent(bust)}" alt="${esc(v.title)}" loading="lazy">`;
    }
    if (v.thumbStatus === "failed") {
      const hint = v.thumbError || "缩略图失败";
      let label = "缩略图失败";
      if (hint.includes("图片")) label = "非视频文件";
      else if (hint.includes("分辨率")) label = "占位文件";
      return `<div class="thumb-placeholder failed" title="${esc(hint)}">${esc(label)}</div>`;
    }
    if (v.thumbStatus === "generating") {
      return `<div class="thumb-placeholder">生成中...</div>`;
    }
    if (v.thumbStatus === "queued") {
      return `<div class="thumb-placeholder">排队中...</div>`;
    }
    return `<div class="thumb-placeholder">等待中...</div>`;
  }

  function bindThumbImgError(img, v) {
    img.onerror = () => {
      if (img.dataset.retried) return;
      img.dataset.retried = "1";
      delete state.thumbBust[v.id];
      setTimeout(() => refreshThumbById(v.id), 600);
    };
  }

  function applyThumbToWrap(wrap, v) {
    if (!wrap) return;
    const sig = thumbSig(v);
    if (wrap.dataset.thumbSig === sig) return;

    if (v.thumbReady) {
      const key = String(thumbCacheKey(v));
      const src = `/api/thumb/${v.id}?v=${encodeURIComponent(key)}`;
      const img = wrap.querySelector("img");
      if (img) {
        if (img.dataset.thumbV !== key) {
          img.dataset.thumbV = key;
          img.src = src;
        }
        if (v.title) img.alt = v.title;
        bindThumbImgError(img, v);
        wrap.dataset.thumbSig = sig;
        wrap.closest(".card")?.classList.toggle("card-failed", false);
        return;
      }
    }

    wrap.innerHTML = renderThumbHtml(v);
    const newImg = wrap.querySelector("img");
    if (newImg) {
      newImg.dataset.thumbV = String(thumbCacheKey(v));
      bindThumbImgError(newImg, v);
    }
    wrap.dataset.thumbSig = sig;
    const card = wrap.closest(".card");
    if (card) card.classList.toggle("card-failed", v.thumbStatus === "failed");
  }

  function updateCardFavorite(card, item) {
    const favBtn = card.querySelector(".card-fav");
    if (!favBtn) return;
    favBtn.classList.toggle("on", !!item?.favorited);
    favBtn.title = item?.favorited ? "取消收藏" : "收藏";
    favBtn.setAttribute("aria-label", item?.favorited ? "取消收藏" : "收藏");
  }

  function syncCardFavorites() {
    state.pageItems.forEach(v => {
      const card = document.querySelector(`.card[data-id="${CSS.escape(v.id)}"]`);
      if (card) updateCardFavorite(card, v);
    });
  }

  async function toggleFavorite(id) {
    try {
      const r = await api("/api/favorites/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const item = getItemById(id);
      if (item) {
        item.favorited = r.favorited;
        item.favoritedAt = r.favorited ? r.favoritedAt : null;
      }
      const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
      if (card) updateCardFavorite(card, item || { id, favorited: r.favorited });
      if (state.viewMode === "favorites" && !r.favorited) {
        await loadVideos({ forceRebuild: true });
      }
    } catch (err) {
      alert("收藏操作失败: " + err.message);
    }
  }

  async function batchFavoritesAction(action) {
    const ids = [...state.selected];
    if (!ids.length) return;
    try {
      await api("/api/favorites/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action }),
      });
      const now = Date.now() / 1000;
      ids.forEach(id => {
        const item = getItemById(id);
        if (!item) return;
        item.favorited = action === "add";
        item.favoritedAt = action === "add" ? now : null;
      });
      if (state.viewMode === "favorites" && action === "remove") {
        clearSelection({ exitBatch: false });
        await loadVideos({ forceRebuild: true });
      } else {
        syncCardFavorites();
        clearSelection({ exitBatch: false });
      }
    } catch (err) {
      alert("批量收藏失败: " + err.message);
    }
  }

  function bumpLocalPlayMeta(id) {
    const item = getItemById(id);
    if (!item) return;
    const now = Date.now() / 1000;
    item.playedAt = now;
    item.playCount = (item.playCount || 0) + 1;
  }

  async function recordPlayHistory(id) {
    try {
      const r = await api("/api/history/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const item = getItemById(id);
      if (item) {
        item.playedAt = r.played_at;
        item.playCount = r.play_count;
      }
    } catch (_) { /* ignore */ }
  }

  function bindCard(card, item) {
    const id = card.dataset.id;
    card.addEventListener("click", (e) => {
      if (e.target.closest(".card-check") || e.target.closest(".card-fav")) return;
      if (state.manageMode || state.selected.size > 0) {
        const cb = card.querySelector(".card-check");
        cb.checked = !cb.checked;
        toggleSelect(id, cb.checked);
        return;
      }
      playVideo(id);
    });
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showCtxMenu(e.clientX, e.clientY, id);
    });
    const cb = card.querySelector(".card-check");
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", (e) => {
      e.stopPropagation();
      toggleSelect(id, cb.checked);
    });
    const favBtn = card.querySelector(".card-fav");
    favBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite(id);
    });
    bindPathTip(card.querySelector(".thumb-wrap"), item);
  }

  function patchGridCards(items) {
    const grid = $("#grid");
    items.forEach(v => {
      const card = grid.querySelector(`.card[data-id="${CSS.escape(v.id)}"]`);
      if (!card) return;
      card.classList.toggle("selected", state.selected.has(v.id));
      card.classList.toggle("card-failed", v.thumbStatus === "failed");
      const cb = card.querySelector(".card-check");
      if (cb) cb.checked = state.selected.has(v.id);
      applyThumbToWrap(card.querySelector(".thumb-wrap"), v);
      const title = card.querySelector(".card-title");
      if (title) {
        const html = highlight(v.title, state.query);
        if (title.innerHTML !== html) title.innerHTML = html;
      }
      updateCardFavorite(card, v);
    });
  }

  function canPatchGrid(items) {
    const grid = $("#grid");
    const cards = [...grid.querySelectorAll(".card")];
    if (cards.length !== items.length) return false;
    const oldIds = cards.map(c => c.dataset.id).join("\0");
    const newIds = items.map(v => v.id).join("\0");
    return oldIds === newIds;
  }

  async function loadVideos({ forceRebuild = false } = {}) {
    if (state.playerViewOpen) hideHtml5Player();
    const params = buildVideosParams();

    let data;
    try {
      data = await api(`/api/videos?${params}`);
    } catch (err) {
      $("#status").textContent = `加载失败: ${err.message}`;
      return;
    }
    state.pageItems = data.items;
    state.total = data.total;
    state.totalPages = data.totalPages;
    state.page = data.page;

    updateBreadcrumb();

    const { items, totalPages, page, total } = getPaged();

    $("#status").textContent = statusLabel(total, page, totalPages);
    updateEmptyMessage(total);

    updatePagination(totalPages, page, total);

    const grid = $("#grid");
    if (!forceRebuild && canPatchGrid(items)) {
      patchGridCards(items);
      items.filter(v => !v.thumbReady && v.thumbStatus === "missing").forEach(v => {
        if (!thumbRetryTimers[v.id]) scheduleThumbRefresh(v.id);
      });
      const pageIds = items
        .filter(v => !v.thumbReady && v.thumbStatus !== "failed")
        .map(v => v.id);
      if (pageIds.length) {
        api("/api/thumb/priority", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: pageIds }),
        }).catch(() => {});
      }
      updateUrl();
      saveState();
      updateSelectionBar();
      updatePageSelectAll();
      renderPlayerPlaylist();
      highlightPlayingCard();
      return;
    }

    grid.innerHTML = items.map(v => {
      const checked = state.selected.has(v.id) ? "checked" : "";
      const selected = state.selected.has(v.id) ? "selected" : "";
      const failed = v.thumbStatus === "failed" ? "card-failed" : "";
      const favOn = v.favorited ? "on" : "";
      return `
        <div class="card ${selected} ${failed}" data-id="${v.id}">
          <div class="thumb-wrap" id="thumb-${v.id}">${renderThumbHtml(v)}</div>
          <button type="button" class="card-fav ${favOn}" data-id="${v.id}" title="${v.favorited ? "取消收藏" : "收藏"}" aria-label="${v.favorited ? "取消收藏" : "收藏"}">♥</button>
          <input type="checkbox" class="card-check" data-id="${v.id}" ${checked} aria-label="选择">
          <div class="card-title">${highlight(v.title, state.query)}</div>
        </div>`;
    }).join("");

    grid.querySelectorAll(".card").forEach(card => {
      const item = items.find(v => v.id === card.dataset.id);
      if (item) bindCard(card, item);
    });
    stampGridThumbs(items);

    items.filter(v => !v.thumbReady && v.thumbStatus === "missing").forEach(v => {
      if (!thumbRetryTimers[v.id]) scheduleThumbRefresh(v.id);
    });

    const pageIds = items
      .filter(v => !v.thumbReady && v.thumbStatus !== "failed")
      .map(v => v.id);
    if (pageIds.length) {
      api("/api/thumb/priority", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: pageIds }),
      }).catch(() => {});
    }

    updateUrl();
    saveState();
    updateSelectionBar();
    updatePageSelectAll();
    renderPlayerPlaylist();
    highlightPlayingCard();
  }

  function updateUrl() {
    const params = new URLSearchParams();
    if (state.category) params.set("category", state.category);
    if (state.folder && !state.query) params.set("folder", state.folder);
    if (state.query) params.set("q", state.query);
    if (state.page > 1) params.set("page", state.page);
    if (state.pageSize !== 32) params.set("size", state.pageSize);
    const qs = params.toString();
    history.replaceState(null, "", qs ? `?${qs}` : "/");
  }

  function parseUrl() {
    const params = new URLSearchParams(location.search);
    if (params.has("category")) state.category = params.get("category");
    if (params.has("folder")) {
      state.folder = params.get("folder");
      if (state.category) state.expandedCategories.add(state.category);
    }
    if (params.has("q")) {
      state.query = params.get("q");
      $("#search").value = state.query;
    }
    if (params.has("page")) state.page = parseInt(params.get("page"), 10) || 1;
    if (params.has("size")) state.pageSize = parseInt(params.get("size"), 10);
  }

  function scheduleThumbRefresh(id) {
    if (thumbRetryTimers[id]) return;
    thumbRetryTimers[id] = setTimeout(async () => {
      delete thumbRetryTimers[id];
      const pending = await refreshThumbById(id);
      if (pending) scheduleThumbRefresh(id);
    }, 1500);
  }

  async function refreshThumbById(id) {
    const wrap = document.getElementById(`thumb-${id}`);
    if (!wrap) return false;
    try {
      const v = await api(`/api/videos/${encodeURIComponent(id)}`);
      const idx = state.pageItems.findIndex(x => x.id === id);
      if (idx >= 0) state.pageItems[idx] = { ...state.pageItems[idx], ...v };
      applyThumbToWrap(wrap, v);
      const card = wrap.closest(".card");
      if (card) card.classList.toggle("card-failed", v.thumbStatus === "failed");
      if (v.thumbReady) delete state.thumbBust[id];
      if (state.playerViewOpen) syncPlayerPlaylistThumbs([v]);
      return !v.thumbReady && v.thumbStatus !== "failed";
    } catch (_) {
      return true;
    }
  }

  async function refreshVisibleThumbs() {
    const { items } = getPaged();
    if (!items.length) return;

    const targets = items.filter(v => {
      if (v.thumbStatus === "generating" || v.thumbStatus === "queued") return true;
      if (!v.thumbReady && v.thumbStatus !== "failed") return true;
      const wrap = document.getElementById(`thumb-${v.id}`);
      return wrap && wrap.dataset.thumbSig !== thumbSig(v);
    });
    if (!targets.length) return;

    const results = await Promise.all(targets.map(v => refreshThumbById(v.id)));
    targets.forEach((v, i) => {
      if (results[i]) scheduleThumbRefresh(v.id);
    });
  }

  async function loadFailedItems() {
    try {
      const data = await api("/api/thumb/failed");
      state.failedItems = data.items || [];
      updateFailedBar();
      if ($("#failed-dialog")?.open) renderFailedList();
    } catch (_) {
      state.failedItems = [];
      updateFailedBar();
    }
  }

  function formatFailedHint() {
    if (!state.failedItems.length) return " · 失败 1+";
    const f = state.failedItems[0];
    const label = f.filename || f.title || f.id;
    const path = f.path || "";
    const more = state.failedItems.length > 1 ? ` 等 ${state.failedItems.length} 项` : "";
    if (path) return ` · 失败: ${label} | ${path}${more}`;
    return ` · 失败: ${label}${more}`;
  }

  function updateFailedBar() {
    const bar = $("#thumb-failed-bar");
    const summary = $("#thumb-failed-summary");
    if (!bar) return;
    const n = state.failedItems.length;
    bar.classList.toggle("hidden", n === 0);
    if (summary && n > 0) {
      const f = state.failedItems[0];
      const label = f.filename || f.title || f.id;
      const path = f.path || "";
      summary.textContent = path
        ? (n === 1 ? path : `${path} 等 ${n} 项`)
        : (n === 1 ? label : `${label} 等 ${n} 项`);
      summary.title = state.failedItems.map(i => `${i.filename || i.title}\n${i.path || ""}\n${i.error || ""}`).join("\n\n");
    }
  }

  function renderFailedList() {
    const el = $("#failed-list");
    if (!el) return;
    if (!state.failedItems.length) {
      el.innerHTML = '<p class="text-sm text-zinc-500">暂无失败项</p>';
      return;
    }
    el.innerHTML = state.failedItems.map(item => `
      <div class="failed-item" data-id="${escAttr(item.id)}">
        <div class="failed-item-main min-w-0">
          <p class="text-sm font-medium text-zinc-200">${esc(item.filename || item.title)}</p>
          <p class="failed-item-path" title="点击选中路径">${esc(item.path || "(无路径)")}</p>
          <p class="failed-item-meta text-xs text-zinc-500">${esc(item.category || "")}${item.subfolder ? " / " + esc(item.subfolder) : ""}</p>
          <p class="failed-item-error text-xs text-red-400/90">${esc(item.error || "未知错误")}</p>
        </div>
        <div class="failed-item-actions shrink-0">
          <button type="button" class="ui-btn sm failed-copy" data-path="${escAttr(item.path || "")}">复制路径</button>
          <button type="button" class="ui-btn sm failed-locate" data-id="${escAttr(item.id)}">定位</button>
          <button type="button" class="ui-btn sm failed-retry" data-id="${escAttr(item.id)}">重试</button>
        </div>
      </div>`).join("");
    el.querySelectorAll(".failed-copy").forEach(btn => {
      btn.addEventListener("click", () => {
        const p = btn.dataset.path;
        if (p) navigator.clipboard.writeText(p).then(() => { btn.textContent = "已复制"; setTimeout(() => { btn.textContent = "复制路径"; }, 1500); });
      });
    });
    el.querySelectorAll(".failed-locate").forEach(btn => {
      btn.addEventListener("click", () => locateFailedVideo(btn.dataset.id));
    });
    el.querySelectorAll(".failed-retry").forEach(btn => {
      btn.addEventListener("click", () => retryFailedIds([btn.dataset.id]));
    });
  }

  function showFailedDialog() {
    renderFailedList();
    $("#failed-dialog")?.showModal();
  }

  async function locateFailedVideo(id) {
    const item = state.failedItems.find(i => i.id === id);
    if (!item) return;
    $("#failed-dialog")?.close();
    hideHtml5Player();
    state.category = item.category || "";
    state.folder = item.subfolder || "";
    state.query = item.filename || "";
    state.page = 1;
    $("#search").value = state.query;
    await loadCategories();
    await loadVideos();
    requestAnimationFrame(() => {
      const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
      card?.scrollIntoView({ block: "center", behavior: "smooth" });
      card?.classList.add("card-locate-flash");
      setTimeout(() => card?.classList.remove("card-locate-flash"), 2000);
    });
  }

  async function retryAllFailed() {
    if (!state.failedItems.length) return;
    if (!confirm(`重试全部 ${state.failedItems.length} 个失败项？`)) return;
    await retryFailedIds(state.failedItems.map(i => i.id), { bulk: true });
  }

  async function retryFailedIds(ids, { bulk = false } = {}) {
    if (!ids.length) return;
    try {
      if (bulk) {
        await api("/api/thumb/regenerate-failed", { method: "POST" });
      } else {
        markThumbsRegenerating(ids, "retry");
        await api("/api/thumb/regenerate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
      }
      $("#failed-dialog")?.close();
      loadProgress();
      refreshVisibleThumbs();
    } catch (err) {
      alert("重试失败: " + err.message);
    }
  }

  async function loadProgress() {
    try {
      const pageIds = state.pageItems.map(v => v.id);
      const global = await api("/api/thumb/status");
      let page = null;
      if (pageIds.length) {
        const params = new URLSearchParams();
        params.set("page_ids", pageIds.join(","));
        page = await api(`/api/thumb/status?${params}`);
      }

      const idleOn = !!global.idle_scan;
      const working = ((global.generating || 0) + (global.queue_size ?? 0)) > 0;
      const failCount = global.failed ?? 0;
      const notReady = Math.max(0, (global.total ?? 0) - (global.ready ?? 0));

      if (failCount > 0) await loadFailedItems();
      else {
        state.failedItems = [];
        updateFailedBar();
      }

      const badge = $("#idle-scan-badge");
      badge.classList.toggle("hidden", !idleOn);
      badge.classList.toggle("active", idleOn && working && !global.paused);

      const pauseHint = global.paused ? " · 已暂停" : "";
      let statusHint;
      if (idleOn) {
        if (global.paused) {
          statusHint = " · 后台补全已暂停";
        } else if (working) {
          statusHint = " · 后台持续补全未生成的缩略图";
        } else if (failCount > 0 && (global.missing ?? 0) === 0) {
          statusHint = " · 全库补全完成，有失败项待处理";
        } else if (notReady > 0 && (global.missing ?? 0) === 0 && failCount === 0) {
          statusHint = ` · 有 ${notReady} 个未就绪（若已删除文件请点「刷新」）`;
        } else if ((global.missing ?? 0) === 0 && notReady === 0) {
          statusHint = " · 全库缩略图已就绪";
        } else {
          statusHint = " · 后台补全已开启";
        }
      } else {
        statusHint = " · 仅按需生成当前浏览页面的缩略图";
      }

      const failHint = failCount > 0 ? formatFailedHint() : "";
      const pagePart = page ? ` | 当前页 ${page.ready}/${page.total}` : "";
      $("#progress-text").textContent =
        `全库 ${global.ready}/${global.total} (${global.percent}%)${pagePart}`
        + ` | 队列 ${global.queue_size ?? 0} | 生成中 ${global.generating ?? 0}`
        + ` | 未开始 ${global.missing ?? 0}${failHint}${pauseHint}${statusHint}`;
      $("#progress-fill").style.width = `${global.percent}%`;

      $("#btn-pause").classList.toggle("hidden", global.paused);
      $("#btn-resume").classList.toggle("hidden", !global.paused);

      $("#progress-text")?.classList.toggle("progress-has-failed", failCount > 0);
      $("#progress-text").title = failCount > 0
        ? (state.failedItems.map(i => `${i.path || i.filename}: ${i.error || ""}`).join("\n") || "点击查看失败详情")
        : "";

      const progressSig = `${global.ready}:${global.total}:${page?.ready ?? ""}:${page?.total ?? ""}:${failCount}`;
      const thumbWorkActive = (global.generating ?? 0) > 0
        || (global.queue_size ?? 0) > 0
        || (global.missing ?? 0) > 0;
      const pageNeedsThumbs = thumbsNeedRefresh(state.pageItems);
      if (progressSig !== lastProgressSig) {
        lastProgressSig = progressSig;
        if (thumbWorkActive || pageNeedsThumbs) {
          refreshVisibleThumbs();
        }
      }

      const allIdle = !thumbWorkActive && !pageNeedsThumbs && failCount === 0;
      const nextPoll = allIdle ? 30000 : (idleOn ? 3000 : 8000);
      if (nextPoll !== progressPollMs) {
        progressPollMs = nextPoll;
        if (progressTimer) clearInterval(progressTimer);
        progressTimer = setInterval(loadProgress, progressPollMs);
      }
    } catch (e) {
      $("#progress-text").textContent = "缩略图: 状态获取失败";
    }
  }

  async function loadPlayerSettings() {
    try {
      const s = await api("/api/settings");
      state.playerMode = s.player_mode || "potplayer";
      return s;
    } catch (_) {
      return null;
    }
  }

  function updatePotplayerPathVisibility() {
    const pot = document.querySelector('input[name="player-mode"][value="potplayer"]')?.checked;
    $("#potplayer-path-wrap")?.classList.toggle("hidden", !pot);
  }

  function highlightPlayingCard() {
    $$(".card").forEach(card => {
      card.classList.toggle("playing", card.dataset.id === state.playingId);
    });
  }

  let _playlistRenderedIds = "";

  function playlistItemIds() {
    return state.pageItems.map(v => v.id).join("\0");
  }

  function updatePlayerPlaylistActive() {
    $("#player-playlist")?.querySelectorAll(".player-pl-item").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.id === state.playingId);
    });
  }

  function syncPlayerPlaylistThumbs(items) {
    if (!state.playerViewOpen) return;
    const list = items || state.pageItems;
    list.forEach(v => {
      const item = $("#player-playlist")?.querySelector(`.player-pl-item[data-id="${v.id}"]`);
      if (!item) return;
      const wrap = item.querySelector(".player-pl-thumb");
      if (!wrap) return;
      const sig = thumbSig(v);
      if (wrap.dataset.thumbSig === sig) return;
      applyThumbToWrap(wrap, v);
    });
  }

  function renderPlayerPlaylist(force = false) {
    const el = $("#player-playlist");
    if (!el) return;
    if (!state.pageItems.length) {
      el.innerHTML = '<p class="px-2 py-4 text-center text-xs text-zinc-600">当前页无视频</p>';
      _playlistRenderedIds = "";
      return;
    }
    const ids = playlistItemIds();
    if (!force && ids === _playlistRenderedIds && el.querySelector(".player-pl-item")) {
      updatePlayerPlaylistActive();
      return;
    }
    _playlistRenderedIds = ids;
    el.innerHTML = state.pageItems.map(v => `
      <button type="button" class="player-pl-item w-full ${v.id === state.playingId ? "active" : ""}" data-id="${escAttr(v.id)}">
        <div class="player-pl-thumb">${renderThumbHtml(v)}</div>
        <div class="player-pl-meta min-w-0">
          <p class="truncate text-xs font-medium">${esc(v.title || v.filename)}</p>
          <p class="truncate text-[10px] text-zinc-600">${esc(v.filename)}</p>
        </div>
      </button>`).join("");
    el.querySelectorAll(".player-pl-item").forEach(btn => {
      btn.addEventListener("click", () => playVideo(btn.dataset.id));
    });
    el.querySelectorAll(".player-pl-thumb").forEach((wrap, i) => {
      const v = state.pageItems[i];
      if (v) applyThumbToWrap(wrap, v);
    });
  }

  function destroyHlsPlayer() {
    if (hlsInstance) {
      try { hlsInstance.destroy(); } catch (_) { /* ignore */ }
      hlsInstance = null;
    }
  }

  /** 立即停止服务端 HLS 切片/转码进程（保留磁盘缓存） */
  async function stopActiveSlice() {
    destroyHlsPlayer();
    state.activeSliceVideoId = null;
    try {
      await api("/api/play/stop", { method: "POST" });
    } catch (_) { /* ignore */ }
  }

  function setPlayerStatus(text) {
    const el = $("#player-status");
    if (!el) return;
    if (text) {
      el.textContent = text;
      el.classList.remove("hidden");
    } else {
      el.textContent = "";
      el.classList.add("hidden");
    }
  }

  let playOverlayTimer = null;
  let playOverlayStarted = 0;
  let pendingPlayId = null;

  function cancelPlayback() {
    state.playSession += 1;
    pendingPlayId = null;
    hidePlayOverlay();
    parkVideoEngine();
    const video = getPlaybackVideo();
    resetVideoDisplay(video);
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    stopActiveSlice();
    if (state.playerViewOpen) {
      state.playerViewOpen = false;
      $("#player-view")?.classList.add("hidden");
      $("#player-view")?.classList.remove("flex");
      $("#gallery-view")?.classList.remove("hidden");
      $("#gallery-toolbar")?.classList.remove("hidden");
      state.playingId = null;
      highlightPlayingCard();
    }
  }

  function setPlayOverlayProgress(pct, indeterminate = false) {
    const fill = $("#play-overlay-fill");
    if (!fill) return;
    fill.classList.toggle("indeterminate", indeterminate);
    if (!indeterminate) {
      fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    }
  }

  function showPlayOverlay(title, detail = "", { progress = null, indeterminate = false, item = null, info = null } = {}) {
    const el = $("#play-overlay");
    if (!el) return;
    playOverlayStarted = Date.now();
    if (item || info) setPlayOverlayContext(item, info);
    $("#play-overlay-title").textContent = title || "准备播放";
    $("#play-overlay-detail").textContent = detail || "";
    if (progress != null) {
      setPlayOverlayProgress(progress, false);
    } else {
      setPlayOverlayProgress(0, indeterminate);
    }
    el.classList.remove("hidden");
    clearInterval(playOverlayTimer);
    playOverlayTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - playOverlayStarted) / 1000);
      const elp = $("#play-overlay-elapsed");
      if (elp) elp.textContent = `已等待 ${sec} 秒`;
    }, 400);
  }

  function updatePlayOverlay(title, detail, opts = {}) {
    if (opts.item || opts.info) setPlayOverlayContext(opts.item, opts.info);
    if (title) $("#play-overlay-title").textContent = title;
    if (detail != null) $("#play-overlay-detail").textContent = detail;
    if (opts.progress != null) {
      setPlayOverlayProgress(opts.progress, false);
    } else if (opts.indeterminate != null) {
      setPlayOverlayProgress(0, opts.indeterminate);
    }
  }

  function hidePlayOverlay() {
    clearInterval(playOverlayTimer);
    playOverlayTimer = null;
    playOverlayStarted = 0;
    $("#play-overlay")?.classList.add("hidden");
    setPlayOverlayProgress(0, false);
    const elp = $("#play-overlay-elapsed");
    if (elp) elp.textContent = "";
  }

  function showPlayToast(text) {
    if (text) showPlayOverlay(text);
    else hidePlayOverlay();
  }

  function hidePlayToast() {
    hidePlayOverlay();
  }

  function showPlayerPreparing(text) {
    updatePlayOverlay(null, text, { indeterminate: true });
  }

  function hidePlayerPreparing() {
    setPlayerStatus("");
    hidePlayOverlay();
  }

  function getPlaybackVideo() {
    return $("#html5-player");
  }

  function parkVideoEngine() {
    const video = getPlaybackVideo();
    const host = $("#video-engine-host");
    if (video && host && video.parentElement !== host) {
      host.appendChild(video);
    }
  }

  function mountVideoToPlayer() {
    const video = getPlaybackVideo();
    const stage = $("#player-stage");
    if (video && stage && video.parentElement !== stage) {
      stage.appendChild(video);
    }
  }

  function formatPlaybackLabel(info) {
    if (!info) return { text: "", cls: "" };
    const codec = (info.codec || "").toUpperCase();
    const kind = info.structure?.kind;
    if (info.container === "image" || ["PNG", "MJPEG", "JPEG", "GIF", "BMP", "WEBP", "APNG"].includes(codec)) {
      return { text: `非视频文件${codec ? ` · ${codec}` : ""}`, cls: "fmt-unsupported" };
    }
    if (info.disguised || info.structure?.kind === "disguised_mpegts" || info.structure?.kind === "disguised_h264") {
      const mins = info.structure?.duration_sec
        ? ` · 约 ${Math.round(info.structure.duration_sec / 60)} 分钟`
        : "";
      return { text: `伪装格式 · 切片播放${mins}`, cls: "fmt-disguised" };
    }
    if (info.mode === "hls" && info.transcode) {
      return { text: `转码播放${codec ? ` · ${codec}` : ""}`, cls: "fmt-transcode" };
    }
    if (kind === "fragmented") {
      return { text: `碎片化 MP4${codec ? ` · ${codec}` : ""}`, cls: "fmt-fragmented" };
    }
    if (kind === "moov_end") {
      return { text: `索引在末尾${codec ? ` · ${codec}` : ""}`, cls: "fmt-moov-end" };
    }
    if (info.mode === "hls") {
      return { text: `大文件切片${codec ? ` · ${codec}` : ""}`, cls: "fmt-large" };
    }
    if (info.mode === "direct") {
      return { text: `标准格式${codec ? ` · ${codec}` : ""}`, cls: "fmt-standard" };
    }
    return { text: codec || "未知格式", cls: "" };
  }

  function setPlayOverlayContext(item, info) {
    const titleEl = $("#play-overlay-video-title");
    const formatEl = $("#play-overlay-format");
    const name = item?.title || item?.filename || "";
    if (titleEl) titleEl.textContent = name;
    if (formatEl) {
      const { text, cls } = formatPlaybackLabel(info);
      if (text) {
        formatEl.textContent = text;
        formatEl.className = `play-overlay-format ${cls}`.trim();
        formatEl.classList.remove("hidden");
      } else {
        formatEl.textContent = "";
        formatEl.classList.add("hidden");
      }
    }
  }

  function playStageLabel(info) {
    if (!info) return "";
    if (info.mode === "hls" && info.transcode) return "AV1/HEVC 转码";
    if (info.mode === "hls") return "碎片化切片";
    if (info.structure?.kind === "moov_end") return "拉取索引";
    return "直连播放";
  }

  function formatSize(bytes) {
    if (!bytes) return "";
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  function openPlayerView(item) {
    if (!item?.id) return;
    state.playingId = item.id;
    state.playerViewOpen = true;
    $("#gallery-view")?.classList.add("hidden");
    $("#gallery-toolbar")?.classList.add("hidden");
    const view = $("#player-view");
    view?.classList.remove("hidden");
    view?.classList.add("flex");
    const title = item.title || item.filename || item.id;
    $("#player-title").textContent = title;
    const pathEl = $("#player-path");
    if (pathEl) {
      pathEl.textContent = item.path || "";
      pathEl.title = item.path || "";
    }
    renderPlayerPlaylist();
    highlightPlayingCard();
  }

  function resetVideoDisplay(video) {
    video?.classList.remove("is-playing");
  }

  function revealPlayerView(item, video) {
    mountVideoToPlayer();
    openPlayerView(item);
    video?.classList.add("is-playing");
    pendingPlayId = null;
    recordPlayHistory(item.id);
  }

  function videoHasPicture(video) {
    return !!(video && video.videoWidth > 0 && video.videoHeight > 0);
  }

  function waitCanPlay(video, session, timeoutMs = 120000, onProgress) {
    return new Promise((resolve, reject) => {
      if (session !== state.playSession) {
        reject(new Error("已切换视频"));
        return;
      }
      let timer;
      let tickTimer;
      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(tickTimer);
        video.removeEventListener("canplay", onReady);
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("progress", onProgressEvt);
        video.removeEventListener("error", onError);
      };
      const onReady = () => {
        if (!videoHasPicture(video)) return;
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("视频加载失败"));
      };
      const onProgressEvt = () => {
        if (typeof onProgress !== "function") return;
        try {
          const buf = video.buffered;
          if (buf.length && video.duration) {
            onProgress(buf.end(buf.length - 1) / video.duration);
          }
        } catch (_) { /* ignore */ }
      };
      if (videoHasPicture(video) && video.readyState >= 3) {
        resolve();
        return;
      }
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(videoHasPicture(video) ? "视频缓冲超时" : "浏览器无法解码此视频"));
      }, timeoutMs);
      tickTimer = setInterval(onProgressEvt, 500);
      video.addEventListener("canplay", onReady);
      video.addEventListener("loadeddata", onReady);
      video.addEventListener("progress", onProgressEvt);
      video.addEventListener("error", onError, { once: true });
    });
  }

  function waitPlaying(video, session, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      if (session !== state.playSession) {
        reject(new Error("已切换视频"));
        return;
      }
      if (!video.paused && videoHasPicture(video)) {
        resolve();
        return;
      }
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("error", onError);
      };
      const onPlaying = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("视频播放失败"));
      };
      timer = setTimeout(() => {
        cleanup();
        if (videoHasPicture(video)) resolve();
        else reject(new Error("视频起播超时"));
      }, timeoutMs);
      video.addEventListener("playing", onPlaying, { once: true });
      video.addEventListener("error", onError, { once: true });
    });
  }

  async function startDirectStream(id, item, session, info) {
    destroyHlsPlayer();
    parkVideoEngine();
    const video = getPlaybackVideo();
    if (!video) return;
    resetVideoDisplay(video);
    mountVideoToPlayer();
    openPlayerView(item);
    video.removeAttribute("src");
    video.load();
    video.src = `/api/stream/${id}`;
    const moovEnd = info?.structure?.kind === "moov_end";
    const sizeHint = info?.structure?.size_bytes ? formatSize(info.structure.size_bytes) : "";
    updatePlayOverlay(
      "加载视频",
      moovEnd
        ? `索引在文件末尾${sizeHint ? `（${sizeHint}）` : ""}，正在拉取…`
        : `正在缓冲${sizeHint ? `（${sizeHint}）` : ""}…`,
      { indeterminate: true },
    );
    await waitCanPlay(video, session, moovEnd ? 180000 : 90000, (ratio) => {
      updatePlayOverlay(null, `已缓冲 ${Math.round(ratio * 100)}%`, { progress: ratio * 100 });
    });
    if (session !== state.playSession) return;
    updatePlayOverlay("即将播放", "正在启动播放器…", { progress: 95 });
    await video.play().catch(() => {});
    await waitPlaying(video, session);
    if (session !== state.playSession) return;
    hidePlayOverlay();
    revealPlayerView(item, video);
  }

  async function startHlsStream(id, item, session, transcode = false) {
    destroyHlsPlayer();
    parkVideoEngine();
    const video = getPlaybackVideo();
    if (!video) return;
    const url = `/api/hls/${id}/playlist.m3u8`;
    resetVideoDisplay(video);
    video.removeAttribute("src");
    video.load();
    updatePlayOverlay(
      transcode ? "转码播放" : "HLS 播放",
      "正在连接切片流…",
      { indeterminate: true },
    );
    if (window.Hls && Hls.isSupported()) {
      await new Promise((resolve, reject) => {
        let timer = setTimeout(() => reject(new Error("HLS 清单加载超时，请重试或改用 PotPlayer")), 45000);
        hlsInstance = new Hls({ enableWorker: true });
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(video);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
          clearTimeout(timer);
          resolve();
        });
        hlsInstance.on(Hls.Events.ERROR, (_, data) => {
          if (!data?.fatal) return;
          clearTimeout(timer);
          reject(new Error("HLS 播放失败"));
        });
      });
      await waitCanPlay(video, session, transcode ? 180000 : 120000, (ratio) => {
        updatePlayOverlay(null, `已缓冲 ${Math.round(ratio * 100)}%`, { progress: ratio * 100 });
      });
      if (session !== state.playSession) return;
      updatePlayOverlay("即将播放", "正在启动播放器…", { progress: 95 });
      await video.play().catch(() => {});
      await waitPlaying(video, session);
      if (session !== state.playSession) return;
      hidePlayOverlay();
      revealPlayerView(item, video);
      return;
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      await waitCanPlay(video, session, transcode ? 180000 : 120000);
      if (session !== state.playSession) return;
      await video.play().catch(() => {});
      await waitPlaying(video, session);
      if (session !== state.playSession) return;
      hidePlayOverlay();
      revealPlayerView(item, video);
      return;
    }
    throw new Error("浏览器不支持 HLS，请改用 PotPlayer");
  }

  async function waitHlsReady(id, session, maxSec = 180, transcode = false) {
    const limitSec = transcode ? Math.max(maxSec, 300) : maxSec;
    const start = Date.now();
    let lastSeg = 0;
    while (Date.now() - start < limitSec * 1000) {
      if (session !== state.playSession) throw new Error("已切换视频");
      const st = await api(`/api/play/status/${id}`);
      if (st.ready) {
        updatePlayOverlay(transcode ? "转码完成" : "切片就绪", "即将加载播放器…", { progress: 100 });
        return st;
      }
      if (st.state === "error") throw new Error(st.error || "HLS 准备失败");
      const segs = st.segments || 0;
      const elapsed = st.elapsed_sec || 0;
      const detail = transcode
        ? `已生成 ${segs} 个片段 · 耗时 ${elapsed}s`
        : `已切片 ${segs} 个片段 · 耗时 ${elapsed}s`;
      const pct = segs > 0 ? Math.min(92, 12 + segs * 8) : null;
      updatePlayOverlay(transcode ? "正在转码" : "正在切片", detail, {
        progress: pct,
        indeterminate: segs <= 0,
      });
      if (segs > lastSeg) lastSeg = segs;
      await new Promise(r => setTimeout(r, 600));
    }
    throw new Error(transcode ? "转码准备超时，请使用 PotPlayer" : "准备超时，请使用 PotPlayer");
  }

  async function playVideoHtml5(id, item) {
    const session = ++state.playSession;
    pendingPlayId = id;

    // 切换视频时立刻停掉上一路的 ffmpeg，避免在检测格式期间旧进程仍在读写磁盘
    await stopActiveSlice();

    const base = item || { id, title: id, filename: "", path: "" };
    parkVideoEngine();
    hidePlayerPreparing();
    setPlayOverlayContext(base, null);
    showPlayOverlay("检测兼容性", "正在分析视频格式…", { indeterminate: true, item: base });

    try {
      if (session !== state.playSession) return;
      const info = await api(`/api/play/info/${id}`);
      if (session !== state.playSession) return;
      if (info.title) base.title = info.title;
      if (info.path) base.path = info.path;
      if (info.filename) base.filename = info.filename;

      setPlayOverlayContext(base, info);
      updatePlayOverlay(
        info.cached ? "准备播放" : "检测完成",
        info.reason || "",
        { progress: info.cached ? 20 : 15, item: base, info },
      );

      if (info.mode === "unsupported") {
        hidePlayOverlay();
        if (confirm(`${info.reason}\n\n是否用 PotPlayer 打开？`)) {
          await playVideoExternal(id);
        }
        return;
      }

      if (info.mode === "hls") {
        const transcode = !!info.transcode;
        state.activeSliceVideoId = id;
        updatePlayOverlay(
          prepTitle(transcode, null),
          "正在准备切片任务…",
          { indeterminate: true, item: base, info },
        );
        const prep = await api(`/api/play/prepare/${id}`, { method: "POST" });
        if (session !== state.playSession) return;
        if (prep.error && prep.state === "error") throw new Error(prep.error);
        if (prep.cached) {
          updatePlayOverlay("使用缓存", "跳过转码，直接加载…", { progress: 80 });
        } else if (!prep.ready) {
          updatePlayOverlay(
            prepTitle(transcode, prep),
            transcode ? "首次转码可能较慢，请稍候" : "边切边播，首段就绪即可播放",
            { indeterminate: true },
          );
          await waitHlsReady(id, session, 180, transcode);
        }
        if (session !== state.playSession) return;
        await startHlsStream(id, base, session, transcode);
        return;
      }

      await startDirectStream(id, base, session, info);
    } catch (err) {
      if (session !== state.playSession || err.message === "已切换视频") return;
      pendingPlayId = null;
      hidePlayOverlay();
      parkVideoEngine();
      resetVideoDisplay(getPlaybackVideo());
      const msg = err.message || "未知错误";
      if (confirm(`播放失败: ${msg}\n\n是否用 PotPlayer 打开？`)) {
        await playVideoExternal(id);
      } else {
        hideHtml5Player();
      }
    }
  }

  function prepTitle(transcode, prep) {
    if (prep?.cached) return "使用缓存";
    if (transcode) return "正在转码";
    return "正在切片";
  }

  function showHtml5Player(item) {
    playVideoHtml5(item.id, item);
  }

  function hideHtml5Player() {
    state.playSession += 1;
    hidePlayOverlay();
    stopActiveSlice();
    state.playerViewOpen = false;
    hidePlayerPreparing();
    const video = getPlaybackVideo();
    resetVideoDisplay(video);
    parkVideoEngine();
    $("#player-view")?.classList.add("hidden");
    $("#player-view")?.classList.remove("flex");
    $("#gallery-view")?.classList.remove("hidden");
    $("#gallery-toolbar")?.classList.remove("hidden");
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    state.playingId = null;
    highlightPlayingCard();
  }

  function playAdjacentVideo(delta) {
    if (!state.playingId || !state.pageItems.length) return;
    const idx = state.pageItems.findIndex(v => v.id === state.playingId);
    if (idx < 0) return;
    const next = state.pageItems[idx + delta];
    if (next) playVideo(next.id);
  }

  async function playVideoExternal(id) {
    try {
      await api(`/api/play-external/${id}`, { method: "POST" });
      bumpLocalPlayMeta(id);
    } catch (e) {
      alert("PotPlayer 打开失败: " + e.message);
    }
  }

  async function playVideo(id) {
    const item = getItemById(id);
    const mode = state.playerMode || "potplayer";

    if (mode === "html5") {
      await playVideoHtml5(id, item || { id, title: id, filename: "", path: "" });
      return;
    }

    try {
      await api(`/api/play/${id}`, { method: "POST" });
      bumpLocalPlayMeta(id);
    } catch (e) {
      alert("播放失败: " + e.message);
    }
  }

  function enableBatchMode() {
    if (state.manageMode) return;
    state.manageMode = true;
    document.body.classList.add("manage-mode");
    $("#btn-manage").classList.add("active");
  }

  function updatePageSelectAll() {
    const pageCb = $("#select-page-all");
    if (!pageCb) return;
    const items = state.pageItems;
    const selectedOnPage = items.filter(v => state.selected.has(v.id)).length;
    pageCb.indeterminate = selectedOnPage > 0 && selectedOnPage < items.length;
    pageCb.checked = items.length > 0 && selectedOnPage === items.length;
    pageCb.disabled = items.length === 0;
    $("#btn-batch-clear")?.classList.toggle("hidden", state.selected.size === 0);
    document.body.classList.toggle("has-selection", state.selected.size > 0);
  }

  function selectAllOnPage(checked) {
    if (checked) enableBatchMode();
    state.pageItems.forEach(v => toggleSelect(v.id, checked, { silent: true }));
    updateSelectionBar();
    updatePageSelectAll();
    syncCardCheckboxes();
  }

  function syncCardCheckboxes() {
    $$(".card-check").forEach(cb => {
      cb.checked = state.selected.has(cb.dataset.id);
      cb.closest(".card")?.classList.toggle("selected", cb.checked);
    });
  }

  function clearSelection({ exitBatch = false } = {}) {
    state.selected.clear();
    updateSelectionBar();
    updatePageSelectAll();
    syncCardCheckboxes();
    if (exitBatch) setManageMode(false, { reload: false });
  }

  function toggleSelect(id, on, opts = {}) {
    if (on) enableBatchMode();
    if (on) state.selected.add(id);
    else state.selected.delete(id);
    const card = document.querySelector(`.card[data-id="${id}"]`);
    if (card) card.classList.toggle("selected", on);
    if (!opts.silent) {
      updateSelectionBar();
      updatePageSelectAll();
    }
  }

  function updateSelectionBar() {
    const n = state.selected.size;
    const bar = $("#selection-bar");
    bar.classList.toggle("hidden", n === 0);
    $("#selection-count").textContent = `已选 ${n} 个`;
    $("#btn-sel-rename").disabled = n !== 1;
    $("#btn-sel-play").disabled = n === 0;
    $("#btn-sel-move").disabled = n === 0;
    $("#btn-sel-delete").disabled = n === 0;
    $("#btn-sel-regen").disabled = n === 0;
    $("#btn-sel-fav-add").disabled = n === 0;
    $("#btn-sel-fav-remove").disabled = n === 0;
  }

  async function confirmDelete(ids) {
    const items = ids.map(id => getItemById(id)).filter(Boolean);
    const names = items.map(v => v.filename).slice(0, 3).join("\n");
    const more = items.length > 3 ? `\n...等共 ${items.length} 个` : "";
    const msg = `确定将以下视频移到回收站？\n\n${names}${more}`;
    return confirm(msg);
  }

  async function deleteVideos(ids) {
    if (!ids.length) return;
    if (!await confirmDelete(ids)) return;
    const result = await api("/api/videos/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (result.errors?.length) {
      alert(result.errors.map(e => `${e.id}: ${e.error}`).join("\n"));
    }
    state.selected.clear();
    await loadCategories();
    await loadVideos();
    loadProgress();
  }

  let renameTargetId = null;

  async function openRenameDialog(id) {
    const item = getItemById(id);
    if (!item) return alert("请先在当前页选择该视频");
    renameTargetId = id;
    $("#rename-input").value = getFilenameStem(item.filename);
    $("#rename-ext-hint").textContent = `扩展名保留为 ${getFilenameExt(item.filename)}`;
    $("#rename-dialog").showModal();
  }

  async function openMoveDialog(ids) {
    const data = await api("/api/categories");
    const cats = data.items;
    const select = $("#move-category");
    select.innerHTML = "";
    const rootOpt = document.createElement("option");
    rootOpt.value = "根目录";
    rootOpt.textContent = "根目录";
    select.appendChild(rootOpt);
    cats.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.name;
      opt.textContent = `${c.name} (${c.count})`;
      select.appendChild(opt);
    });
    select.dataset.ids = ids.join(",");
    $("#move-dialog").showModal();
  }

  async function moveVideos(ids, category) {
    if (!ids.length || !category) return;
    const result = await api("/api/videos/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, category }),
    });
    if (result.errors?.length) {
      alert(result.errors.map(e => `${e.error}`).join("\n"));
    }
    state.selected.clear();
    await loadCategories();
    await loadVideos();
    loadProgress();
  }

  function showCtxMenu(x, y, id) {
    state.ctxTarget = id;
    const item = getItemById(id);
    const favBtn = $("#ctx-menu")?.querySelector('[data-action="fav-toggle"]');
    if (favBtn) favBtn.textContent = item?.favorited ? "取消收藏" : "加入收藏";
    const menu = $("#ctx-menu");
    menu.classList.remove("hidden");
    menu.style.visibility = "hidden";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      const pad = 8;
      let left = x;
      let top = y;
      if (left + rect.width > window.innerWidth - pad) {
        left = Math.max(pad, window.innerWidth - rect.width - pad);
      }
      if (top + rect.height > window.innerHeight - pad) {
        top = Math.max(pad, window.innerHeight - rect.height - pad);
      }
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.style.visibility = "";
    });
  }

  function hideCtxMenu() {
    $("#ctx-menu").classList.add("hidden");
    state.ctxTarget = null;
    hidePathTip();
  }

  function setManageMode(on, { reload = true } = {}) {
    state.manageMode = on;
    document.body.classList.toggle("manage-mode", on);
    $("#btn-manage").classList.toggle("active", on);
    if (!on) {
      state.selected.clear();
      updateSelectionBar();
      updatePageSelectAll();
    }
    if (reload) loadVideos();
    else syncCardCheckboxes();
  }

  function setPageSize(size) {
    state.pageSize = size;
    state.page = 1;
    $$(".page-size").forEach(btn => {
      btn.classList.toggle("active", parseInt(btn.dataset.size, 10) === size);
    });
    saveState();
    loadVideos();
  }

  function connectSSE() {
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      const colon = e.data.indexOf(":");
      const type = colon >= 0 ? e.data.slice(0, colon) : e.data;
      const payload = colon >= 0 ? e.data.slice(colon + 1) : "";
      if (type === "version") {
        clearTimeout(versionDebounceTimer);
        versionDebounceTimer = setTimeout(async () => {
          const versionChanged = payload && payload !== lastLibraryVersion;
          lastLibraryVersion = payload;
          state.folderTrees = {};
          await loadCategories();
          if (state.category) await renderSubdirPanel(state._lastCats || []);
          if (versionChanged) {
            await loadVideos({ forceRebuild: false });
          } else if (pageThumbsNeedPolling(state.pageItems)) {
            refreshVisibleThumbs();
          }
        }, 500);
      } else if (type === "progress") {
        loadProgress();
      }
    };
    es.onerror = () => {
      es.close();
      setTimeout(connectSSE, 5000);
    };
  }

  async function openSettings() {
    const s = await api("/api/settings");
    state.playerMode = s.player_mode || "potplayer";
    $("#set-position").value = s.thumb_position;
    $("#set-random-min").value = s.thumb_random_min ?? 0.5;
    $("#set-random-max").value = s.thumb_random_max ?? 0.8;
    $("#set-workers").value = s.thumb_workers;
    $("#set-idle-scan").value = String(s.thumb_idle_scan);
    $("#set-page-size").value = String(s.default_page_size);
    $("#set-potplayer").value = s.potplayer_path;
    $("#set-history-days").value = s.history_retention_days ?? 180;
    const modeInput = document.querySelector(`input[name="player-mode"][value="${state.playerMode}"]`);
    if (modeInput) modeInput.checked = true;
    updatePotplayerPathVisibility();
    $("#settings-dialog").showModal();
  }

  // --- Event bindings ---

  $("#search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = e.target.value.trim();
      state.page = 1;
      loadVideos();
    }, 300);
  });

  $("#search").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.target.value = "";
      state.query = "";
      state.page = 1;
      loadVideos();
    }
  });

  $("#sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    state.page = 1;
    saveState();
    loadVideos();
  });

  $$(".page-size").forEach(btn => {
    btn.addEventListener("click", () => setPageSize(parseInt(btn.dataset.size, 10)));
  });

  $("#btn-prev").addEventListener("click", () => goToPage(state.page - 1));

  $("#btn-next").addEventListener("click", () => goToPage(state.page + 1));

  $("#pagination-bottom").addEventListener("click", (e) => {
    const btn = e.target.closest(".page-nav");
    if (!btn || btn.disabled) return;
    const { totalPages } = getPaged();
    if (btn.dataset.action === "first") goToPage(1);
    else if (btn.dataset.action === "prev") goToPage(state.page - 1);
    else if (btn.dataset.action === "next") goToPage(state.page + 1);
    else if (btn.dataset.action === "last") goToPage(totalPages);
  });

  $("#page-jump-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const p = parseInt(e.target.value, 10);
      if (p) goToPage(p);
    }
  });

  $("#btn-manage").addEventListener("click", () => setManageMode(!state.manageMode));

  $("#select-page-all").addEventListener("change", (e) => selectAllOnPage(e.target.checked));

  $("#btn-batch-clear").addEventListener("click", () => clearSelection({ exitBatch: true }));

  $("#btn-rescan").addEventListener("click", async () => {
    $("#status").textContent = "扫描中...";
    state.folderTrees = {};
    await api("/api/rescan", { method: "POST" });
    await loadCategories();
    await loadVideos();
    await loadProgress();
  });

  $("#btn-pause").addEventListener("click", async () => {
    await api("/api/thumb/pause", { method: "POST" });
    loadProgress();
  });

  $("#btn-resume").addEventListener("click", async () => {
    await api("/api/thumb/resume", { method: "POST" });
    loadProgress();
  });

  $("#btn-view-favorites").addEventListener("click", () => setViewMode("favorites"));
  $("#btn-view-history").addEventListener("click", () => setViewMode("history"));

  $("#btn-sel-fav-add").addEventListener("click", () => batchFavoritesAction("add"));
  $("#btn-sel-fav-remove").addEventListener("click", () => batchFavoritesAction("remove"));

  $("#btn-clear-history").addEventListener("click", async () => {
    if (!confirm("确定清空全部最近播放记录？此操作不可恢复。")) return;
    try {
      await api("/api/history/clear", { method: "POST" });
      if (state.viewMode === "history") {
        await loadVideos({ forceRebuild: true });
      }
    } catch (err) {
      alert("清空失败: " + err.message);
    }
  });

  $("#btn-sel-play").addEventListener("click", () => {
    const first = [...state.selected][0];
    if (first) playVideo(first);
  });

  $("#btn-sel-regen").addEventListener("click", () => {
    const ids = [...state.selected];
    if (ids.length) regenerateRandomThumbs(ids);
  });

  $("#btn-sel-rename").addEventListener("click", () => {
    const id = [...state.selected][0];
    if (id) openRenameDialog(id);
  });

  $("#btn-sel-move").addEventListener("click", () => {
    const ids = [...state.selected];
    if (ids.length) openMoveDialog(ids);
  });

  $("#btn-sel-delete").addEventListener("click", () => {
    deleteVideos([...state.selected]);
  });

  $("#btn-sel-cancel").addEventListener("click", () => clearSelection({ exitBatch: true }));

  $("#btn-settings").addEventListener("click", openSettings);

  document.querySelectorAll('input[name="player-mode"]').forEach(r => {
    r.addEventListener("change", updatePotplayerPathVisibility);
  });

  $("#btn-player-back").addEventListener("click", hideHtml5Player);
  $("#play-overlay-close")?.addEventListener("click", cancelPlayback);
  $("#play-overlay-potplayer")?.addEventListener("click", async () => {
    const id = pendingPlayId;
    cancelPlayback();
    if (id) await playVideoExternal(id);
  });
  $("#progress-text")?.addEventListener("click", () => {
    if (state.failedItems.length) showFailedDialog();
  });
  $("#btn-show-failed-list").addEventListener("click", showFailedDialog);
  $("#btn-retry-all-failed").addEventListener("click", retryAllFailed);
  $("#failed-dialog-close").addEventListener("click", () => $("#failed-dialog")?.close());
  $("#failed-dialog-retry-all").addEventListener("click", retryAllFailed);

  $("#btn-player-prev").addEventListener("click", () => playAdjacentVideo(-1));
  $("#btn-player-next").addEventListener("click", () => playAdjacentVideo(1));
  $("#btn-player-potplayer").addEventListener("click", () => {
    if (state.playingId) playVideoExternal(state.playingId);
  });

  $("#category-sort").addEventListener("change", async (e) => {
    const data = await api("/api/categories/sort-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sort_mode: e.target.value }),
    });
    await renderCategoryList(data.items, data.sort_mode);
  });

  $("#settings-save").addEventListener("click", async () => {
    const pos = parseFloat($("#set-position").value);
    const rMin = parseFloat($("#set-random-min").value);
    const rMax = parseFloat($("#set-random-max").value);
    if (Number.isNaN(pos) || pos < 0.05 || pos > 0.95) {
      alert("截图位置需在 0.05 ~ 0.95 之间");
      return;
    }
    if (Number.isNaN(rMin) || Number.isNaN(rMax) || rMin < 0.05 || rMax > 0.95) {
      alert("随机范围需在 0.05 ~ 0.95 之间");
      return;
    }
    if (rMin > rMax) {
      alert("随机范围的最小值不能大于最大值");
      return;
    }
    const historyDays = parseInt($("#set-history-days").value, 10);
    if (Number.isNaN(historyDays) || historyDays < 1 || historyDays > 3650) {
      alert("最近播放保留天数需在 1 ~ 3650 之间");
      return;
    }
    try {
      await api("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thumb_position: pos,
          thumb_random_min: rMin,
          thumb_random_max: rMax,
          thumb_workers: parseInt($("#set-workers").value, 10),
          thumb_idle_scan: $("#set-idle-scan").value === "true",
          default_page_size: parseInt($("#set-page-size").value, 10),
          potplayer_path: $("#set-potplayer").value,
          player_mode: document.querySelector('input[name="player-mode"]:checked')?.value || "potplayer",
          history_retention_days: historyDays,
        }),
      });
      state.playerMode = document.querySelector('input[name="player-mode"]:checked')?.value || "potplayer";
      $("#settings-dialog").close();
      loadProgress();
      if ($("#set-idle-scan").value === "true") {
        alert("已开启全库后台补全，顶部进度条将显示详细进度。");
      }
    } catch (err) {
      alert("保存失败: " + err.message);
    }
  });

  $("#settings-cancel").addEventListener("click", () => {
    $("#settings-dialog").close();
  });

  $("#rename-dialog").addEventListener("close", async (e) => {
    if (e.target.returnValue !== "save" || !renameTargetId) return;
    try {
      await api("/api/videos/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: renameTargetId, new_name: $("#rename-input").value.trim() }),
      });
      state.selected.clear();
      await loadCategories();
      await loadVideos();
      loadProgress();
    } catch (err) {
      alert("重命名失败: " + err.message);
    } finally {
      renameTargetId = null;
    }
  });

  $("#move-dialog").addEventListener("close", async (e) => {
    if (e.target.returnValue !== "save") return;
    const ids = ($("#move-category").dataset.ids || "").split(",").filter(Boolean);
    const category = $("#move-category").value;
    if (!ids.length) return;
    await moveVideos(ids, category);
  });

  $("#ctx-menu").addEventListener("click", async (e) => {
    const action = e.target.dataset.action;
    const id = state.ctxTarget;
    if (!action || !id) return;
    hideCtxMenu();
    if (action === "play") playVideo(id);
    else if (action === "folder") await api(`/api/open-folder/${id}`, { method: "POST" });
    else if (action === "regen-random") await regenerateRandomThumbs([id]);
    else if (action === "copy") {
      const v = getItemById(id);
      if (v?.path) navigator.clipboard.writeText(v.path);
    } else if (action === "fav-toggle") {
      await toggleFavorite(id);
    } else if (action === "rename") {
      openRenameDialog(id);
    } else if (action === "move") {
      openMoveDialog([id]);
    } else if (action === "delete") {
      deleteVideos([id]);
    }
  });

  document.addEventListener("click", hideCtxMenu);

  window.addEventListener("pagehide", () => {
    fetch("/api/play/stop", { method: "POST", keepalive: true }).catch(() => {});
  });

  document.querySelector("main")?.addEventListener("scroll", hidePathTip, { passive: true });
  window.addEventListener("resize", hidePathTip, { passive: true });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#play-overlay")?.classList.contains("hidden")) {
      e.preventDefault();
      cancelPlayback();
      return;
    }
    if (e.key === "/" && document.activeElement !== $("#search")) {
      e.preventDefault();
      $("#search").focus();
    }
    if (e.key === "ArrowLeft" && !e.target.matches("input, select, textarea")) {
      goToPage(state.page - 1);
    }
    if (e.key === "ArrowRight" && !e.target.matches("input, select, textarea")) {
      goToPage(state.page + 1);
    }
  });

  // --- Init ---
  parkVideoEngine();
  loadState();
  parseUrl();
  $("#sort").value = state.sort;
  $$(".page-size").forEach(btn => {
    btn.classList.toggle("active", parseInt(btn.dataset.size, 10) === state.pageSize);
  });

  loadPlayerSettings().then(() => updatePotplayerPathVisibility());
  updateViewModeButtons();
  loadCategories().then(() => {
    loadVideos({ forceRebuild: true }).then(loadProgress);
  });
  connectSSE();
  progressTimer = setInterval(loadProgress, progressPollMs);
})();
