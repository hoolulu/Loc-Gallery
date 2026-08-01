(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  /** 与 style.css `.grid` 的 CSS 变量一致；列数优先从 DOM 实测 */
  const GRID_LAYOUT = { titleH: 34, hPad: 40, maxCols: 10 };

  let lastAutoPageSize = 0;
  let autoPageSizeTimer = null;
  let autoReconcileLock = false;
  let _catTreeDelegateBound = false;

  function parseCssLength(val, rootPx) {
    if (!val) return 0;
    const v = String(val).trim();
    if (v.endsWith("rem")) return parseFloat(v) * rootPx;
    if (v.endsWith("px")) return parseFloat(v);
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  function readGridMetrics() {
    const grid = $("#grid");
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    if (!grid) {
      return { min: 200, max: 260, gap: 14, maxCols: GRID_LAYOUT.maxCols };
    }
    const cs = getComputedStyle(grid);
    const maxCols = parseInt(cs.getPropertyValue("--grid-max-cols"), 10) || GRID_LAYOUT.maxCols;
    return {
      min: parseCssLength(cs.getPropertyValue("--grid-min"), rootPx) || 200,
      max: parseCssLength(cs.getPropertyValue("--grid-max"), rootPx) || 260,
      gap: parseCssLength(cs.getPropertyValue("--grid-gap"), rootPx) || 14,
      maxCols,
    };
  }

  function getGridContentWidth() {
    const grid = $("#grid");
    if (grid && grid.clientWidth > 0) return grid.clientWidth;
    const gallery = $("#gallery-view");
    if (!gallery) return 0;
    return Math.max(0, gallery.clientWidth - GRID_LAYOUT.hPad);
  }

  function estimateGridColumns(containerWidth, metrics) {
    const { min, max, gap, maxCols } = metrics;
    const w = Math.max(min, containerWidth);
    if (w <= 0) return 1;
    const floorMin = Math.max(
      min,
      (w - (maxCols - 1) * gap) / maxCols,
    );
    const minCols = Math.max(1, Math.ceil((w + gap) / (max + gap)));
    let cols = minCols;
    for (let n = minCols; n <= maxCols; n++) {
      const cell = (w - (n - 1) * gap) / n;
      if (cell >= floorMin - 1) cols = n;
      else break;
    }
    return Math.min(maxCols, cols);
  }

  function measureRenderedGridColumns() {
    const grid = $("#grid");
    if (!grid) return 0;
    const cards = grid.querySelectorAll(".card");
    if (!cards.length) return 0;
    const top = cards[0].offsetTop;
    let cols = 0;
    for (const card of cards) {
      if (card.offsetTop <= top + 2) cols += 1;
      else break;
    }
    return cols || 1;
  }

  function computeAutoPageSize(forcedCols) {
    const gallery = $("#gallery-view");
    if (!gallery) return 32;
    const metrics = readGridMetrics();
    const width = getGridContentWidth();
    const cols = forcedCols || estimateGridColumns(width, metrics);
    const cellW = Math.min(
      metrics.max,
      Math.max(metrics.min, (width - (cols - 1) * metrics.gap) / cols),
    );
    const cardH = cellW * (9 / 16) + GRID_LAYOUT.titleH;
    const availH = Math.max(cardH, gallery.clientHeight - 16);
    const rows = Math.max(2, Math.floor((availH + metrics.gap) / (cardH + metrics.gap)));
    const size = cols * rows;
    return Math.min(128, Math.max(cols * 2, size));
  }

  function playbackInProgress() {
    if (pendingPlayId) return true;
    if (state.playerViewOpen) return true;
    const ov = $("#play-overlay");
    return !!(ov && !ov.classList.contains("hidden"));
  }

  function reconcileAutoPageSizeAfterRender() {
    if (state.pageSize !== "auto" || autoReconcileLock) return;
    if (playbackInProgress()) return;
    if (pageThumbsPending(state.pageItems)) return;
    requestAnimationFrame(() => {
      const cols = measureRenderedGridColumns();
      if (!cols) return;
      const target = computeAutoPageSize(cols);
      const n = state.pageItems.length;
      const requested = lastAutoPageSize || target;
      const fullPage = requested > 0 && n >= requested;
      const raggedFullPage = fullPage && n % cols !== 0;
      const targetChanged = target !== requested;

      if (!raggedFullPage && !targetChanged) {
        lastAutoPageSize = target;
        return;
      }
      if (!raggedFullPage && targetChanged) {
        lastAutoPageSize = target;
        state.page = 1;
        scheduleAutoPageSizeCheck();
        return;
      }
      autoReconcileLock = true;
      lastAutoPageSize = target;
      state.page = 1;
      loadVideos().finally(() => {
        autoReconcileLock = false;
      });
    });
  }

  function getEffectivePageSize() {
    if (state.pageSize === "auto") {
      const measured = measureRenderedGridColumns();
      return computeAutoPageSize(measured || undefined);
    }
    if (state.pageSize === 0) return 0;
    return Number(state.pageSize) || 40;
  }

  function syncPageSizeControls() {
    const ps = state.pageSize;
    const isAuto = ps === "auto";
    const isAll = ps === 0 || ps === "0";
    const isPre40 = Number(ps) === 40;
    const isPre80 = Number(ps) === 80;
    $("#btn-page-size-40")?.classList.toggle("active", isPre40);
    $("#btn-page-size-80")?.classList.toggle("active", isPre80);
    $("#btn-page-size-all")?.classList.toggle("active", isAll);
    const input = $("#page-size-custom");
    if (!input) return;
    const custom = !isAuto && !isAll && !isPre40 && !isPre80 && Number(ps) > 0;
    input.classList.toggle("page-size-input-active", custom);
    if (custom) input.value = String(ps);
    else input.value = "";
  }

  function scheduleAutoPageSizeCheck() {
    if (state.pageSize !== "auto") return;
    if (playbackInProgress()) return;
    if (pageThumbsPending(state.pageItems)) return;
    clearTimeout(autoPageSizeTimer);
    autoPageSizeTimer = setTimeout(() => {
      const cols = measureRenderedGridColumns();
      const next = computeAutoPageSize(cols || undefined);
      if (next > 0 && next !== lastAutoPageSize) {
        lastAutoPageSize = next;
        state.page = 1;
        loadVideos();
      }
    }, 200);
  }

  const LS_KEY = "loc-gallery-state";
  const THEME_LS_KEY = "loc-gallery-theme";

  const state = {
    category: "",
    folder: "",
    query: "",
    sort: "mtime_desc",
    formatFilter: "",
    formatIndexStatus: null,
    page: 1,
    pageSize: 40,
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
    playerMode: "html5",
    playerViewOpen: false,
    failedItems: [],
    playSession: 0,
    activeSliceVideoId: null,
    viewMode: "browse",
    albumId: "",
    albums: [],
    currentAlbum: null,
    albumFormPendingIds: [],
    albumCtxTarget: null,
    libraryId: "",
    libraries: [],
    playlistSort: "page",
    playlistAutoplay: true,
    playerPrevKey: ".",
    playerNextKey: "/",
    playlistItems: [],
    playlistLoadedThrough: 0,
    playlistTotalPages: 1,
    playlistLoading: false,
    playlistScopeKey: "",
    playlistCanLoadMore: false,
    resumePlayback: true,
    wheelSeekSec: 5,
    thumbProgressBar: "auto",
    pendingRestorePlayId: null,
    theme: "dark",
    randomSeed: null,
    playlistRandomSeed: null,
  };

  let thumbProgressManualExpand = false;
  let thumbProgressUserDismissed = false;
  let lastThumbProgressGlobal = null;
  let lastDurationStatus = null;
  let durationStatusSupported = true;
  let durationStatusTimer = null;
  let searchTimer = null;
  let thumbRetryTimers = {};
  let progressTimer = null;
  let progressPollMs = 8000;
  let lastProgressSig = "";
  let gridJustLoaded = false;
  let loadProgressInFlight = false;
  let loadProgressPending = false;
  let progressDebounceTimer = null;
  let lastThumbRefreshAt = 0;
  let lastPriorityQueueAt = 0;
  let thumbPagePollTimer = null;
  let pageThumbWorkTimer = null;
  let thumbRefreshSeq = 0;
  let versionDebounceTimer = null;
  let lastLibraryVersion = "";
  let hlsInstance = null;

  /**
   * HLS 切片水位：最多领先播放点约 2 分钟；跌到约 1 分钟时恢复切片（留 1 分钟给机械盘续切）。
   * 拖进度条后若磁盘上已切内容不够 2 分钟，立即续切。
   */
  const HLS_SLICE_SEGMENT_SEC_DEFAULT = 30;
  const SLICE_AHEAD_MAX_SEC = 120;
  const SLICE_AHEAD_MIN_SEC = 60;
  /** 距已切末尾不足此时长时强制续切（约 3 个分片） */
  const SLICE_EDGE_RESERVE_SEC = 90;
  let hlsSliceThrottle = null;
  let sliceCatchupTimer = null;
  const playInfoCache = new Map();
  const playInfoInflight = new Map();
  const PLAY_INFO_CACHE_TTL_MS = 15 * 60 * 1000;

  function stashPlayInfo(id, info) {
    if (!id || !info) return;
    playInfoCache.set(id, { info, at: Date.now() });
    if (playInfoCache.size > 12) {
      const oldest = [...playInfoCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) playInfoCache.delete(oldest[0]);
    }
  }

  function takeCachedPlayInfo(id) {
    const row = playInfoCache.get(id);
    if (!row) return null;
    if (Date.now() - row.at > PLAY_INFO_CACHE_TTL_MS) {
      playInfoCache.delete(id);
      return null;
    }
    playInfoCache.delete(id);
    return row.info;
  }

  function prefetchPlayInfo(id) {
    if (!id) return;
    const row = playInfoCache.get(id);
    if (row && Date.now() - row.at <= PLAY_INFO_CACHE_TTL_MS) return;
    if (playInfoInflight.has(id)) return;
    const p = api(`/api/play/info/${id}`)
      .then((info) => { stashPlayInfo(id, info); })
      .catch(() => {})
      .finally(() => { playInfoInflight.delete(id); });
    playInfoInflight.set(id, p);
  }

  function prefetchAdjacentPlayInfo(delta = 1) {
    const list = getPlaylistItems();
    const idx = state.playingId ? list.findIndex(v => v.id === state.playingId) : -1;
    if (idx < 0) return;
    const next = list[idx + delta];
    if (next?.id) prefetchPlayInfo(next.id);
  }

  /** 立刻断开浏览器视频拉流，停止 Range 请求与后台缓冲；hard 时替换节点（退出播放页用） */
  function detachVideoStream(video, { hard = false } = {}) {
    if (!video) {
      if (hard) recreateVideoElement();
      return getPlaybackVideo();
    }
    destroyHlsPlayer();
    try { video.pause(); } catch (_) { /* ignore */ }
    try { video.preload = "none"; } catch (_) { /* ignore */ }
    video.removeAttribute("poster");
    try {
      if (video.srcObject) {
        const tracks = video.srcObject.getTracks?.();
        if (tracks) tracks.forEach((t) => { try { t.stop(); } catch (_) { /* ignore */ } });
        video.srcObject = null;
      }
    } catch (_) { /* ignore */ }
    video.removeAttribute("src");
    video.src = "";
    [...video.querySelectorAll("source")].forEach(el => el.remove());
    try { video.load(); } catch (_) { /* ignore */ }
    if (hard) recreateVideoElement();
    return getPlaybackVideo();
  }

  /** 替换 DOM 节点，迫使浏览器取消所有媒体 Range 请求 */
  function recreateVideoElement() {
    const old = document.getElementById("html5-player");
    if (!old?.parentElement) return;
    const video = document.createElement("video");
    video.id = "html5-player";
    video.className = old.className;
    video.controls = true;
    video.playsInline = true;
    video.preload = "none";
    old.parentElement.replaceChild(video, old);
  }

  /** 播放页顶栏标题最多显示字数 */
  const PLAYER_TITLE_MAX_CHARS = 26;

  function setPlayerHeaderTitle(full) {
    const text = String(full || "").trim();
    const el = $("#player-title");
    if (!el) return;
    el.title = text;
    el.textContent = text.length > PLAYER_TITLE_MAX_CHARS
      ? `${text.slice(0, PLAYER_TITLE_MAX_CHARS)}…`
      : text;
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      if (saved.category !== undefined) state.category = saved.category;
      if (saved.folder !== undefined) state.folder = saved.folder;
      if (saved.expandedCategories) state.expandedCategories = new Set(saved.expandedCategories);
      if (saved.sort) state.sort = saved.sort;
      if (saved.formatFilter) state.formatFilter = saved.formatFilter;
      if (saved.pageSize !== undefined) {
        const ps = saved.pageSize;
        if (ps === "auto") state.pageSize = 40;
        else if (ps === "all" || ps === 0 || ps === "0") state.pageSize = 0;
        else state.pageSize = Number(ps) || 40;
      }
      if (saved.libraryId !== undefined) state.libraryId = saved.libraryId;
      if (saved.playlistSort) state.playlistSort = saved.playlistSort;
      if (saved.randomSeed != null) state.randomSeed = saved.randomSeed;
      else if (state.sort === "random") state.randomSeed = Date.now();
      if (saved.playlistRandomSeed != null) state.playlistRandomSeed = saved.playlistRandomSeed;
      else if (state.playlistSort === "random") state.playlistRandomSeed = Date.now();
    } catch (_) { /* ignore */ }
  }

  function saveState() {
    localStorage.setItem(LS_KEY, JSON.stringify({
      category: state.category,
      folder: state.folder,
      expandedCategories: [...state.expandedCategories],
      sort: state.sort,
      formatFilter: state.formatFilter,
      pageSize: state.pageSize,
      page: state.page,
      libraryId: state.libraryId,
      playlistSort: state.playlistSort,
      randomSeed: state.randomSeed,
      playlistRandomSeed: state.playlistRandomSeed,
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
    const pad = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left;
    let top;

    const spaceRight = vw - rect.right - pad;
    const spaceLeft = rect.left - pad;
    const spaceAbove = rect.top - pad;
    const spaceBelow = vh - rect.bottom - pad;

    const inPlaylist = !!anchor.closest(".player-playlist");

    if (inPlaylist && spaceLeft >= tipRect.width) {
      left = rect.left - tipRect.width - pad;
      top = rect.top + rect.height / 2 - tipRect.height / 2;
    } else if (spaceRight >= tipRect.width) {
      left = rect.right + pad;
      top = rect.top + rect.height / 2 - tipRect.height / 2;
    } else if (spaceLeft >= tipRect.width) {
      left = rect.left - tipRect.width - pad;
      top = rect.top + rect.height / 2 - tipRect.height / 2;
    } else if (spaceAbove >= tipRect.height) {
      left = rect.left + rect.width / 2 - tipRect.width / 2;
      top = rect.top - tipRect.height - pad;
    } else {
      left = rect.left + rect.width / 2 - tipRect.width / 2;
      top = rect.bottom + pad;
    }

    left = Math.min(Math.max(pad, left), vw - tipRect.width - pad);
    top = Math.min(Math.max(pad, top), vh - tipRect.height - pad);
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

  function shortenMiddle(str, maxLen) {
    if (!str || str.length <= maxLen) return str || "";
    const edge = Math.max(6, Math.floor((maxLen - 1) / 2));
    return `${str.slice(0, edge)}…${str.slice(-edge)}`;
  }

  function renderPathTipDir(item) {
    const path = item.path || "";
    const filename = item.filename || "";
    const dir = getPathDir(path, filename);
    const parts = dir.split(/[/\\]/).filter(Boolean);
    if (!parts.length) return "";
    const maxSegs = 5;
    let prefix = "";
    let segs = parts;
    if (parts.length > maxSegs) {
      segs = parts.slice(-(maxSegs - 1));
      prefix = `<span class="path-seg path-seg-ellipsis" title="${esc(dir)}">…</span><span class="path-sep">\\</span>`;
    }
    const body = segs.map((seg, i) => {
      const sep = i > 0 || prefix ? '<span class="path-sep">\\</span>' : "";
      const label = seg.length > 22 ? shortenMiddle(seg, 22) : seg;
      return `${sep}<span class="path-seg" title="${esc(seg)}">${esc(label)}</span>`;
    }).join("");
    return `<div class="path-tip-dir">${prefix}${body}</div>`;
  }

  function renderPathTipName(item) {
    const name = item.filename || "";
    if (!name) return "";
    const short = shortenMiddle(name, 40);
    return `<div class="path-tip-file" title="${esc(name)}">${esc(short)}</div>`;
  }

  function pathTipAnchorItemId(anchor) {
    if (!anchor) return null;
    if (anchor.id?.startsWith("thumb-")) return anchor.id.slice(6);
    return anchor.dataset?.id || null;
  }

  function pathTipExtras(item) {
    const techParts = [];
    const dur = formatDuration(videoDurationSec(item));
    if (dur) techParts.push(`时长 ${dur}`);
    const badgeMeta = FORMAT_BADGE_META[item.formatBadge];
    if (badgeMeta?.label) techParts.push(badgeMeta.label);
    if (item.size) techParts.push(formatSize(item.size));
    if (item.mtime) techParts.push(`修改于 ${formatTs(item.mtime)}`);

    const userParts = [];
    if (item.favorited && item.favoritedAt) {
      userParts.push(`收藏于 ${formatTs(item.favoritedAt)}`);
    } else if (item.favorited) {
      userParts.push("已收藏");
    }
    if (item.playedAt) {
      const n = item.playCount || 1;
      userParts.push(`最近播放 ${formatTs(item.playedAt)} · 累计 ${n} 次`);
    }

    const lines = [];
    if (techParts.length) lines.push(`<div class="path-tip-meta">${techParts.map(t => `<span class="path-tip-chip">${esc(t)}</span>`).join("")}</div>`);
    if (userParts.length) lines.push(`<div class="path-tip-meta">${userParts.map(t => `<span class="path-tip-chip">${esc(t)}</span>`).join("")}</div>`);
    return lines.join("");
  }

  function computePageThumbStats(items) {
    const counts = {
      scope: "page",
      total: items.length,
      ready: 0,
      missing: 0,
      queued: 0,
      generating: 0,
      failed: 0,
      percent: 0,
    };
    items.forEach(v => {
      if (v.thumbReady) counts.ready += 1;
      else if (v.thumbStatus === "failed") counts.failed += 1;
      else if (v.thumbStatus === "generating") counts.generating += 1;
      else if (v.thumbStatus === "queued") counts.queued += 1;
      else counts.missing += 1;
    });
    counts.percent = counts.total
      ? Math.round(counts.ready / counts.total * 1000) / 10
      : 100;
    return counts;
  }

  function pageThumbsPending(items) {
    return items.some(v =>
      !v.thumbReady
      && v.thumbStatus !== "failed"
      && v.thumbStatus !== "generating"
      && v.thumbStatus !== "queued",
    );
  }

  function startThumbPagePoll() {
    clearInterval(thumbPagePollTimer);
    thumbPagePollTimer = setInterval(() => {
      const items = state.pageItems;
      if (!items.length || !pageThumbsPending(items)) {
        stopThumbPagePoll();
        return;
      }
      const now = Date.now();
      if (now - lastPriorityQueueAt > 5000) {
        lastPriorityQueueAt = now;
        queuePageThumbPriority(items);
      }
      void refreshVisibleThumbs();
    }, 5000);
  }

  function schedulePageThumbWork(reqId) {
    clearTimeout(pageThumbWorkTimer);
    if (!pageThumbsPending(state.pageItems)) {
      refreshPageThumbProgressUi();
      return;
    }
    syncThumbProgressUi();
    pageThumbWorkTimer = setTimeout(() => {
      if (reqId !== videosLoadSeq) return;
      const items = state.pageItems;
      if (!items.length || !pageThumbsPending(items)) {
        refreshPageThumbProgressUi();
        return;
      }
      lastPriorityQueueAt = Date.now();
      queuePageThumbPriority(items);
      startThumbPagePoll();
      syncThumbProgressUi();
      scheduleLoadProgress(400);
    }, 500);
  }

  function stopThumbPagePoll() {
    clearInterval(thumbPagePollTimer);
    thumbPagePollTimer = null;
  }

  function clearThumbRetryTimers() {
    Object.keys(thumbRetryTimers).forEach(id => {
      clearTimeout(thumbRetryTimers[id]);
      delete thumbRetryTimers[id];
    });
  }

  function pageThumbPriorityIds(items) {
    return items
      .filter(v => !v.thumbReady && v.thumbStatus !== "failed")
      .slice(0, 15)
      .map(v => v.id);
  }

  function queuePageThumbPriority(items) {
    const pageIds = pageThumbPriorityIds(items);
    if (!pageIds.length) return;
    api("/api/thumb/priority", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: pageIds }),
    }).catch(() => {});
  }

  function syncPathTipLayout(tip, anchor) {
    const img = tip.querySelector(".path-tip-preview img");
    const body = tip.querySelector(".path-tip-body");
    const preview = tip.querySelector(".path-tip-preview");
    tip.classList.add("path-tip--measuring");
    tip.style.width = "";
    tip.style.maxWidth = "";
    if (body) {
      body.style.width = "";
      body.style.maxWidth = "";
    }
    const apply = () => {
      let w = 0;
      if (img) {
        w = Math.round(img.getBoundingClientRect().width);
        if (w <= 0 && img.naturalWidth > 0) {
          const maxW = Math.min(window.innerWidth * 0.88, 920);
          const maxH = Math.min(window.innerHeight * 0.7, 720);
          const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
          w = Math.round(img.naturalWidth * scale);
        }
      }
      if (w <= 0 && preview) {
        w = Math.round(preview.getBoundingClientRect().width);
      }
      if (w <= 0 && anchor) {
        w = Math.min(Math.round(anchor.getBoundingClientRect().width * 3), Math.min(window.innerWidth * 0.88, 920));
      }
      if (w > 0) {
        tip.style.width = `${w}px`;
        tip.style.maxWidth = `${w}px`;
        if (body) {
          body.style.width = `${w}px`;
          body.style.maxWidth = `${w}px`;
        }
      }
      tip.classList.remove("path-tip--measuring");
      if (anchor) positionPathTip(anchor);
    };
    if (!img) {
      apply();
      return;
    }
    if (img.complete && img.naturalWidth) apply();
    else img.addEventListener("load", apply, { once: true });
  }

  function showPathTip(anchor, item) {
    if (!item?.path) return;
    pathTipAnchor = anchor;
    const tip = $("#path-tip");
    tip.title = item.path;
    const latest = getItemById(item.id) || item;
    const bust = thumbCacheKey(latest);
    const overlays = thumbOverlaysHtml(latest);
    const preview = (latest.thumbReady || latest.thumbVersion)
      ? `<div class="path-tip-preview"><img src="${libThumbUrl(latest.id, bust)}" alt="" decoding="async">${overlays}</div>`
      : `<div class="path-tip-preview path-tip-preview--empty">暂无缩略图${overlays}</div>`;
    tip.innerHTML = `
      ${preview}
      <div class="path-tip-body">
        ${renderPathTipDir(item)}
        ${renderPathTipName(item)}
        ${pathTipExtras(item)}
      </div>`;
    syncPathTipLayout(tip, anchor);
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
    pathTipTimer = setTimeout(() => {
      const latest = getItemById(item.id) || item;
      showPathTip(anchor, latest);
    }, 220);
  }

  function bindPathTip(anchor, item) {
    if (!anchor || anchor.dataset.pathTipBound) return;
    anchor.dataset.pathTipBound = "1";
    anchor.addEventListener("mouseenter", () => {
      const latest = getItemById(item.id) || item;
      schedulePathTip(anchor, latest);
    });
    anchor.addEventListener("mouseleave", (e) => {
      if (!anchor.contains(e.relatedTarget)) hidePathTip();
    });
  }

  function bindPlaylistPathTips() {
    $("#player-playlist")?.querySelectorAll(".player-pl-item").forEach(btn => {
      const item = getPlaylistItems().find(v => v.id === btn.dataset.id);
      if (item) bindPathTip(btn, item);
    });
  }

  async function api(path, opts) {
    let url = path;
    const skipLib = path.startsWith("/api/libraries") && !path.includes("/activate");
    if (state.libraryId && !skipLib && !path.includes("library_id=")) {
      url += (path.includes("?") ? "&" : "?") + `library_id=${encodeURIComponent(state.libraryId)}`;
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || res.statusText);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("json")) return res.json();
    return res;
  }

  function libThumbUrl(id, bust) {
    const q = new URLSearchParams();
    if (state.libraryId) q.set("library_id", state.libraryId);
    if (bust) q.set("v", bust);
    const qs = q.toString();
    return `/api/thumb/${id}${qs ? `?${qs}` : ""}`;
  }

  async function loadLibraries() {
    const data = await api("/api/libraries");
    state.libraries = data.items || [];
    if (!state.libraryId) state.libraryId = data.active_library_id || state.libraries[0]?.id || "";
    renderLibrarySwitcher();
    return data;
  }

  function renderLibrarySwitcher() {
    const sel = $("#library-select");
    if (!sel) return;
    sel.innerHTML = state.libraries.map(lib => {
      const miss = lib.exists === false ? "（路径不可用）" : "";
      return `<option value="${escAttr(lib.id)}" ${lib.id === state.libraryId ? "selected" : ""}>${esc(lib.alias)}${miss}</option>`;
    }).join("");
  }

  async function switchLibrary(libraryId, { resetBrowse = true } = {}) {
    if (!libraryId || libraryId === state.libraryId) return;
    try {
      await api(`/api/libraries/${encodeURIComponent(libraryId)}/activate`, { method: "POST" });
    } catch (_) { /* 已激活也可继续 */ }
    state.libraryId = libraryId;
    lastLibraryVersion = "";
    state.folderTrees = {};
    if (resetBrowse) {
      state.category = "";
      state.folder = "";
      state.query = "";
      state.page = 1;
      state.viewMode = "browse";
      state.albumId = "";
      state.currentAlbum = null;
      state.albums = [];
      $("#search").value = "";
    }
    renderLibrarySwitcher();
    updateViewModeButtons();
    await loadPlayerSettings();
    updatePotplayerPathVisibility();
    await loadCategories();
    if (state.viewMode === "albums") {
      await loadAlbums();
    } else {
      await loadVideos({ forceRebuild: true });
    }
    loadProgress();
    updateUrl(true);
    saveState();    connectSSE(true);
  }

  function currentLibraryAlias() {
    const lib = state.libraries.find(l => l.id === state.libraryId);
    return lib?.alias || state.libraryId || "";
  }

  const SETTINGS_DEFAULTS = {
    player_mode: "html5",
    thumb_position: 0.6,
    thumb_workers: 3,
    thumb_idle_scan: false,
    thumb_candidate_count: 6,
  thumb_auto_select_best: false,
  thumb_batch_auto_select: true,
    thumb_jitter_pct: 10,
    thumb_jitter_min: 6,
    thumb_jitter_max: 94,
    default_page_size: 40,
    potplayer_path: "",
    history_retention_days: 180,
    hls_large_h264: false,
    hls_moov_end_h264: false,
    html5_fragmented_mp4: "external",
    html5_modern_codecs_direct: true,
    html5_player_prev_key: ".",
    html5_player_next_key: "/",
    html5_playlist_autoplay: true,
    html5_resume_playback: true,
    html5_wheel_seek_sec: 5,
    thumb_progress_bar: "auto",
    ui_theme: "dark",
  };

  function readStoredTheme() {
    try {
      const t = localStorage.getItem(THEME_LS_KEY);
      if (t === "light" || t === "dark") return t;
    } catch (_) { /* ignore */ }
    return null;
  }

  function resolveTheme(settings) {
    if (settings?.ui_theme) return normalizeTheme(settings.ui_theme);
    const stored = readStoredTheme();
    if (stored) return normalizeTheme(stored);
    return "dark";
  }

  function normalizeTheme(mode) {
    return (mode || "").trim().toLowerCase() === "light" ? "light" : "dark";
  }

  function applyTheme(theme, { persistLocal = true } = {}) {
    const t = normalizeTheme(theme);
    state.theme = t;
    document.documentElement.dataset.theme = t;
    if (persistLocal) {
      try { localStorage.setItem(THEME_LS_KEY, t); } catch (_) { /* ignore */ }
    }
    const btn = $("#btn-theme-toggle");
    if (btn) {
      const label = t === "light" ? "切换到夜间模式" : "切换到白天模式";
      btn.title = label;
      btn.setAttribute("aria-label", label);
    }
    const sel = $("#set-ui-theme");
    if (sel && sel.value !== t) sel.value = t;
  }

  async function persistTheme(theme) {
    const t = normalizeTheme(theme);
    applyTheme(t, { persistLocal: true });
    try {
      await api("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ui_theme: t, scope: "global" }),
      });
    } catch (_) { /* 本地已保存，刷新仍可用 */ }
  }

  function toggleTheme() {
    void persistTheme(state.theme === "light" ? "dark" : "light");
  }

  function normalizeWheelSeekSec(raw) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(120, Math.max(1, n));
  }

  function normalizePlayerHotkey(raw, fallback) {
    const s = String(raw ?? "").trim();
    if (!s) return fallback;
    const aliases = {
      Period: ".",
      Slash: "/",
      Comma: ",",
      BracketLeft: "[",
      BracketRight: "]",
    };
    if (aliases[s]) return aliases[s];
    return s.length === 1 ? s : s.slice(0, 1);
  }

  function keyEventMatchesHotkey(e, hotkey) {
    const hk = normalizePlayerHotkey(hotkey, "");
    if (!hk) return false;
    if (e.key === hk) return true;
    if (hk === "." && e.key === "Period") return true;
    if (hk === "/" && e.key === "Slash") return true;
    if (hk === "," && e.key === "Comma") return true;
    return false;
  }

  function applyPlayerHotkeySettings(s) {
    state.playerPrevKey = normalizePlayerHotkey(
      s?.html5_player_prev_key,
      SETTINGS_DEFAULTS.html5_player_prev_key,
    );
    state.playerNextKey = normalizePlayerHotkey(
      s?.html5_player_next_key,
      SETTINGS_DEFAULTS.html5_player_next_key,
    );
    syncPlayerNavHint();
  }

  function syncPlayerNavHint() {
    const prev = state.playerPrevKey || SETTINGS_DEFAULTS.html5_player_prev_key;
    const next = state.playerNextKey || SETTINGS_DEFAULTS.html5_player_next_key;
    const hint = $("#player-nav-hint");
    if (hint) hint.textContent = `${prev} 上一个  ${next} 下一个`;
    const prevBtn = $("#btn-player-prev");
    const nextBtn = $("#btn-player-next");
    if (prevBtn) prevBtn.title = `上一个（${prev}）`;
    if (nextBtn) nextBtn.title = `下一个（${next}）`;
  }

  function resolveSettingsPageSize(pageSize) {
    const ps = pageSize ?? 40;
    if (ps === 0 || ps === "0" || ps === "all") return { mode: "all", custom: "" };
    const n = parseInt(ps, 10);
    if (n === 40 || n === 80) return { mode: String(n), custom: "" };
    if (ps === -1 || ps === "auto") return { mode: "auto", custom: "" };
    return { mode: "custom", custom: String(ps) };
  }

  function syncSettingsPageSizeUi() {
    const mode = $("#set-page-size-mode")?.value || "40";
    const custom = $("#set-page-size-custom");
    if (custom) custom.classList.toggle("hidden", mode !== "custom");
  }

  function readSettingsPageSize() {
    const mode = $("#set-page-size-mode")?.value || "40";
    if (mode === "all") return 0;
    if (mode === "auto") return -1;
    const n = parseInt(mode, 10);
    if (n === 40 || n === 80) return n;
    const custom = parseInt($("#set-page-size-custom")?.value, 10);
    return Number.isFinite(custom) && custom > 0 ? custom : 40;
  }

  function fillSettingsPageSize(pageSize) {
    const { mode, custom } = resolveSettingsPageSize(pageSize);
    const modeEl = $("#set-page-size-mode");
    const customEl = $("#set-page-size-custom");
    if (modeEl) modeEl.value = mode;
    if (customEl) customEl.value = custom;
    syncSettingsPageSizeUi();
  }

  function setRestartOverlayMode(on) {
    $("#play-overlay-close")?.classList.toggle("hidden", on);
    $("#play-overlay-potplayer")?.closest(".play-overlay-actions")?.classList.toggle("hidden", on);
    $("#play-overlay-format")?.classList.add("hidden");
    $("#play-overlay-video-title")?.classList.toggle("hidden", on);
    if (on) {
      const titleEl = $("#play-overlay-video-title");
      if (titleEl) titleEl.textContent = "";
    }
  }

  async function probeServiceHealth() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch("/api/health", { cache: "no-store", signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return { up: false, bootId: null };
      const data = await res.json().catch(() => null);
      return { up: !!data?.ok, bootId: data?.boot_id || null };
    } catch (_) {
      return { up: false, bootId: null };
    }
  }

  async function waitForServiceRestart(oldBootId, onProgress, maxMs = 120000) {
    const start = Date.now();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const elapsedSec = () => Math.floor((Date.now() - start) / 1000);

    onProgress?.("正在停止旧服务…", 15, elapsedSec());
    const downDeadline = start + 60000;
    while (Date.now() < downDeadline) {
      const h = await probeServiceHealth();
      if (!h.up) break;
      if (oldBootId && h.bootId && h.bootId !== oldBootId) {
        onProgress?.("服务已恢复，正在刷新页面…", 100, elapsedSec());
        await sleep(400);
        return true;
      }
      onProgress?.("正在停止旧服务…", 15 + Math.min(20, elapsedSec()), elapsedSec());
      await sleep(500);
    }

    onProgress?.("正在启动新服务…", 45, elapsedSec());
    const upDeadline = start + maxMs;
    while (Date.now() < upDeadline) {
      const sec = elapsedSec();
      let progress = 45 + Math.min(50, Math.floor(sec * 2));
      const h = await probeServiceHealth();
      if (h.up && oldBootId && h.bootId && h.bootId !== oldBootId) {
        onProgress?.("服务已恢复，正在刷新页面…", 100, sec);
        await sleep(400);
        return true;
      }
      const detail = sec < 8 ? "正在启动新服务…" : sec < 20 ? "等待服务就绪…" : "仍在等待（首次启动可能较慢）…";
      onProgress?.(detail, progress, sec);
      await sleep(700);
    }
    throw new Error("服务重启超时。可尝试手动运行 python restart.py，或查看 data/logs/server.log / restart.log");
  }

  async function restartServiceFromSettings() {
    if (!confirm("确定重启服务？重启期间页面会自动刷新，不会打开新标签。")) return;
    const btn = $("#btn-restart-service");
    $("#settings-dialog")?.close();
    setRestartOverlayMode(true);
    showPlayOverlay("正在重启服务", "正在发送重启请求…", { indeterminate: true });
    if (btn) {
      btn.disabled = true;
      btn.textContent = "重启中…";
    }
    try {
      const before = await probeServiceHealth();
      const res = await fetch("/api/service/restart", { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.message || `HTTP ${res.status}`);
      }
      const data = await res.json().catch(() => ({}));
      const oldBootId = data.boot_id || before.bootId;
      if (!oldBootId) throw new Error("无法获取服务标识，请手动运行 python restart.py");
      if (data.queued === false) {
        updatePlayOverlay("正在重启服务", data.message || "重启已在进行中…", { indeterminate: true });
      } else {
        updatePlayOverlay("正在重启服务", "重启请求已发送，旧服务即将停止…", { progress: 8 });
      }
      await waitForServiceRestart(oldBootId, (detail, progress) => {
        updatePlayOverlay("正在重启服务", detail, { progress });
      });
      location.reload();
    } catch (err) {
      hidePlayOverlay();
      setRestartOverlayMode(false);
      alert("重启失败：" + (err.message || String(err)) + "\n\n可手动运行 python restart.py 或查看 data/logs/restart.log");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "重启服务";
      }
    }
  }

  function wheelSeekStepSec() {
    return normalizeWheelSeekSec(state.wheelSeekSec);
  }

  function playlistAutoplayEnabled() {
    return state.playlistAutoplay !== false;
  }

  function resumePlaybackEnabled() {
    return state.resumePlayback !== false;
  }

  function regenerateRandomSeedIfNeeded() {
    if (state.sort === "random") {
      state.randomSeed = Date.now();
    }
    if (state.playlistSort === "random") {
      state.playlistRandomSeed = Date.now();
    }
  }

  function normalizePlayerMode(mode) {
    const m = (mode || SETTINGS_DEFAULTS.player_mode).trim().toLowerCase();
    return m === "smart" ? "html5" : m;
  }

  function normalizeThumbProgressBar(mode) {
    const m = (mode || SETTINGS_DEFAULTS.thumb_progress_bar || "auto").trim().toLowerCase();
    if (m === "always" || m === "never") return m;
    return "auto";
  }

  function isPageThumbActive() {
    if (!state.pageItems.length) return false;
    const s = computePageThumbStats(state.pageItems);
    return (s.generating + s.queued + s.missing) > 0;
  }

  function isThumbProgressIdle(global) {
    if (!global) return !isPageThumbActive();
    const failCount = global.failed ?? 0;
    if (failCount > 0) return false;
    if (global.paused) return false;
    const generating = global.generating ?? 0;
    const queueSize = global.queue_size ?? 0;
    if (generating > 0 || queueSize > 0) return false;
    // 按需模式：当前页有缩略图在排队/生成/等待时视为活动
    if (!global.idle_scan) return !isPageThumbActive();
    if ((global.missing ?? 0) > 0) return false;
    const notReady = Math.max(0, (global.total ?? 0) - (global.ready ?? 0));
    return notReady === 0;
  }

  function isDurationProgressIdle(st) {
    return !isDurationWorkActive(st);
  }

  function pageMissingDurationCount(items = state.pageItems) {
    return items.filter(v =>
      !videoDurationSec(v) && VIDEO_FILE_EXT_RE.test(v.filename || v.title || "")
    ).length;
  }

  function isDurationWorkActive(st = lastDurationStatus) {
    if (st) {
      if ((st.pending ?? 0) > 0) return true;
      if ((st.queued ?? 0) > 0) return true;
      if ((st.probing ?? 0) > 0) return true;
      return false;
    }
    if (durationStatusSupported === false) return pageMissingDurationCount() > 0;
    return false;
  }

  function buildFallbackDurationStatus() {
    const total = state.pageItems.length;
    const missing = pageMissingDurationCount();
    const cached = Math.max(0, total - missing);
    return {
      fallback: true,
      total,
      cached,
      pending: missing,
      queued: missing,
      probing: 0,
      skipped: 0,
      percent: total ? round((cached / total) * 100, 1) : 100,
      ready: missing === 0,
    };
  }

  function round(n, d = 0) {
    const p = 10 ** d;
    return Math.round(n * p) / p;
  }

  async function refreshDurationStatus() {
    try {
      const st = await api("/api/duration/status");
      durationStatusSupported = true;
      lastDurationStatus = st;
      updateDurationProgressUI(st);
      updateProgressBarVisibility(lastThumbProgressGlobal, st);
      return st;
    } catch (err) {
      const msg = String(err?.message || err);
      if (msg.includes("404") || msg.includes("Not Found")) {
        durationStatusSupported = false;
      }
      const missing = pageMissingDurationCount();
      if (missing > 0 || !durationStatusSupported) {
        const st = buildFallbackDurationStatus();
        lastDurationStatus = st;
        updateDurationProgressUI(st);
        updateProgressBarVisibility(lastThumbProgressGlobal, st);
        return st;
      }
      lastDurationStatus = null;
      updateDurationProgressUI(null);
      updateProgressBarVisibility(lastThumbProgressGlobal, null);
      return null;
    }
  }

  function startDurationStatusPolling() {
    clearTimeout(durationStatusTimer);
    const tick = async () => {
      await refreshDurationStatus();
      const active = isDurationWorkActive(lastDurationStatus);
      durationStatusTimer = setTimeout(tick, active ? 3000 : 20000);
    };
    durationStatusTimer = setTimeout(tick, 800);
  }

  function formatDurationProgressText(st) {
    if (!st) return "时长探测: 加载中…";
    if (st.fallback) {
      const base = `当前页时长补全 ${st.cached}/${st.total} (${st.percent ?? 0}%)`;
      return durationStatusSupported === false
        ? `${base} · 服务需重启后可见全库进度`
        : base;
    }
    const remaining = Math.max(0, st.remaining ?? st.pending ?? 0);
    const workersTotal = st.workers_total ?? st.worker_count ?? 2;
    const workersActive = st.workers_active ?? st.probing ?? 0;
    const rate = Number(st.rate_per_min) || 0;
    let detail = ` | 剩余 ${remaining}`;
    if (rate > 0) {
      detail += ` · 约 ${rate} 个/分钟`;
      const etaMin = Math.ceil(remaining / rate);
      if (etaMin > 0 && etaMin < 9999) detail += ` · 预计 ${etaMin} 分钟`;
    }
    detail += ` · ffprobe ${workersTotal} 路并行`;
    if (workersActive > 0) {
      detail += `（${workersActive} 路 ffprobe 运行中）`;
    } else if (remaining > 0 && st.worker_alive !== false) {
      detail += `（线程间歇，大文件可能单次需数十秒）`;
    }
    const workerPart = st.worker_alive === false && remaining > 0
      ? " · 探测线程未运行，正在尝试恢复"
      : "";
    const skipPart = st.skipped ? ` · 跳过 ${st.skipped}（下载中/不可处理）` : "";
    return `时长探测 ${st.cached ?? 0}/${st.total ?? 0} (${st.percent ?? 0}%)${detail}${workerPart}${skipPart}`;
  }

  function updateDurationProgressUI(st) {
    const wrap = $("#duration-progress-wrap");
    const text = $("#duration-progress-text");
    const fill = $("#duration-progress-fill");
    const chip = $("#duration-status-chip");
    if (!wrap || !text || !fill) return;
    const busy = isDurationWorkActive(st);
    wrap.classList.toggle("hidden", !busy);
    if (chip) chip.classList.remove("hidden");
    chip?.classList.toggle("duration-status-chip--idle", !busy);
    if (!busy) {
      chip?.classList.add("hidden");
      return;
    }
    text.textContent = formatDurationProgressText(st);
    fill.style.width = `${Math.max(0, Math.min(100, st?.percent ?? 0))}%`;
    const hint = $("#duration-progress-hint");
    if (hint) {
      hint.textContent = st?.fallback
        ? "当前仅显示本页进度。请运行 python restart.py 加载新版服务后，可查看全库时长探测进度。"
        : "后台用 ffprobe 逐条探测（默认 2 路并行，大文件单次可能较慢）；结果写入缩略图索引，已有播放记录会先复用。";
    }
    text.title = "服务启动或点「刷新」后会自动排队；当前页缺失时也会优先补全。结果写入缩略图索引，卡片左下角显示。";
    if (chip) {
      chip.title = `${formatDurationProgressText(st)} · 点击展开详情`;
    }
  }

  function refreshPageThumbProgressUi() {
    if (isPageThumbActive()) {
      syncThumbProgressUi();
      scheduleLoadProgress(500);
      return;
    }
    stopThumbPagePoll();
    updateProgressBarVisibility(lastThumbProgressGlobal);
  }

  function syncThumbProgressUi() {
    updateProgressBarVisibility(lastThumbProgressGlobal);
    if (!isPageThumbActive() || !state.pageItems.length) return;
    const page = computePageThumbStats(state.pageItems);
    const el = $("#progress-text");
    if (!el) return;
    const g = lastThumbProgressGlobal;
    if (g?.total) {
      const pagePart = ` | 当前页 ${page.ready}/${page.total}`;
      if (!el.textContent.includes("当前页")) {
        el.textContent =
          `全库 ${g.ready}/${g.total} (${g.percent}%)${pagePart}`
          + ` | 队列 ${g.queue_size ?? 0} | 生成中 ${g.generating ?? 0}`
          + ` | 未开始 ${g.missing ?? 0} · 当前页生成中`;
      }
    } else {
      el.textContent = `当前页 ${page.ready}/${page.total} · 缩略图生成中…`;
    }
  }

  function resetThumbProgressOverride() {
    thumbProgressUserDismissed = false;
    thumbProgressManualExpand = false;
  }

  function updateProgressBarVisibility(global, durationSt = lastDurationStatus) {
    const mode = normalizeThumbProgressBar(state.thumbProgressBar);
    const thumbIdle = isThumbProgressIdle(global);
    const durationBusy = !isDurationProgressIdle(durationSt);
    const idle = thumbIdle && !durationBusy;

    let showBar;
    if (mode === "always") showBar = true;
    else if (mode === "never") showBar = durationBusy;
    else if (!idle) showBar = !thumbProgressUserDismissed;
    else showBar = thumbProgressManualExpand;

    $("#progress-bar-wrap")?.classList.toggle("progress-bar-collapsed", !showBar);

    const chip = $("#thumb-status-chip");
    const dot = chip?.querySelector(".thumb-status-dot");
    if (!chip || !dot) return;
    const showChip = mode === "auto";
    chip.classList.toggle("hidden", !showChip);
    chip.classList.toggle("thumb-status-chip--expanded", showChip && showBar);
    chip.setAttribute("aria-expanded", showChip && showBar ? "true" : "false");
    if (!thumbIdle && thumbProgressUserDismissed) {
      chip.title = "缩略图生成中，点击展开进度";
    } else if (showBar) {
      chip.title = "点击收起缩略图进度";
    } else {
      chip.title = "缩略图状态，点击展开详情";
    }
    dot.classList.remove("thumb-status-dot--ok", "thumb-status-dot--busy", "thumb-status-dot--fail");
    if (!showChip) return;
    const failCount = global?.failed ?? 0;
    const busy = !thumbIdle;
    if (failCount > 0) dot.classList.add("thumb-status-dot--fail");
    else if (busy) dot.classList.add("thumb-status-dot--busy");
    else dot.classList.add("thumb-status-dot--ok");

    updateDurationProgressUI(durationSt);
  }

  function toggleThumbProgressBar() {
    const mode = normalizeThumbProgressBar(state.thumbProgressBar);
    if (mode !== "auto") return;
    const thumbIdle = isThumbProgressIdle(lastThumbProgressGlobal);
    const durationBusy = !isDurationProgressIdle(lastDurationStatus);
    if (!thumbIdle || durationBusy) thumbProgressUserDismissed = !thumbProgressUserDismissed;
    else thumbProgressManualExpand = !thumbProgressManualExpand;
    updateProgressBarVisibility(lastThumbProgressGlobal, lastDurationStatus);
  }

  function fillSettingsForm(raw) {
    const s = { ...SETTINGS_DEFAULTS, ...(raw || {}) };
    state.playerMode = normalizePlayerMode(s.player_mode);
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val ?? "";
    };
    setVal("set-position", s.thumb_position);
    setVal("set-workers", s.thumb_workers);
    setVal("set-idle-scan", String(!!s.thumb_idle_scan));
    setVal("set-thumb-progress-bar", normalizeThumbProgressBar(s.thumb_progress_bar));
    setVal("set-candidate-count", s.thumb_candidate_count ?? 6);
    setVal("set-auto-select-best", String(!!(s.thumb_auto_select_best ?? SETTINGS_DEFAULTS.thumb_auto_select_best)));
    setVal("set-batch-auto-select", String(!!(s.thumb_batch_auto_select ?? SETTINGS_DEFAULTS.thumb_batch_auto_select)));
    setVal("set-jitter-pct", s.thumb_jitter_pct ?? 10);
    setVal("set-jitter-min", s.thumb_jitter_min ?? 6);
    setVal("set-jitter-max", s.thumb_jitter_max ?? 94);
    state.thumbProgressBar = normalizeThumbProgressBar(s.thumb_progress_bar);
    setVal("set-ui-theme", resolveTheme(s));
    applyTheme(resolveTheme(s), { persistLocal: true });
    fillSettingsPageSize(s.default_page_size);
    setVal("set-potplayer", s.potplayer_path || "");
    setVal("set-history-days", s.history_retention_days ?? 180);
    setVal("set-hls-large-h264", String(!!s.hls_large_h264));
    setVal("set-hls-moov-end-h264", String(!!s.hls_moov_end_h264));
    setVal("set-html5-fragmented-mp4", s.html5_fragmented_mp4 || "external");
    setVal("set-html5-modern-codecs-direct", String(s.html5_modern_codecs_direct !== false));
    setVal("set-html5-playlist-autoplay", String(s.html5_playlist_autoplay !== false));
    setVal("set-html5-resume-playback", String(s.html5_resume_playback !== false));
    setVal("set-html5-wheel-seek-sec", String(normalizeWheelSeekSec(s.html5_wheel_seek_sec ?? SETTINGS_DEFAULTS.html5_wheel_seek_sec)));
    state.playlistAutoplay = s.html5_playlist_autoplay !== false;
    state.resumePlayback = s.html5_resume_playback !== false;
    state.wheelSeekSec = normalizeWheelSeekSec(s.html5_wheel_seek_sec ?? SETTINGS_DEFAULTS.html5_wheel_seek_sec);
    applyPlayerHotkeySettings(s);
    setVal("set-html5-player-prev-key", state.playerPrevKey);
    setVal("set-html5-player-next-key", state.playerNextKey);
    document.querySelectorAll('input[name="player-mode"]').forEach(r => {
      r.checked = r.value === state.playerMode;
    });
    updatePotplayerPathVisibility();
  }

  function renderLibrarySettings() {
    const box = $("#library-list");
    if (!box) return;
    if (!state.libraries.length) {
      box.innerHTML = '<div class="lib-table-row lib-empty"><span class="hint-inline" style="grid-column:1/-1">暂无视频库</span></div>';
      return;
    }
    box.innerHTML = state.libraries.map(lib => `
      <div class="lib-table-row" data-id="${escAttr(lib.id)}">
        <input type="text" class="dlg-input compact-input lib-alias" value="${escAttr(lib.alias)}" placeholder="别名" title="${escAttr(lib.id)}">
        <div class="lib-path-cell">
          <input type="text" class="dlg-input compact-input lib-path" value="${escAttr(lib.path)}" placeholder="文件夹路径">
          <button type="button" class="ui-btn sm lib-browse">浏览</button>
        </div>
        <div class="lib-col-actions">
          <button type="button" class="ui-btn sm lib-save">保存</button>
          <button type="button" class="ui-btn sm danger lib-delete" ${state.libraries.length <= 1 ? "disabled" : ""}>删</button>
        </div>
      </div>`).join("");
    box.querySelectorAll(".lib-table-row[data-id]").forEach(row => {
      const id = row.dataset.id;
      row.querySelector(".lib-browse")?.addEventListener("click", async () => {
        try {
          const r = await api("/api/libraries/pick-folder", { method: "POST" });
          if (r.cancelled) return;
          const pathInput = row.querySelector(".lib-path");
          if (pathInput) pathInput.value = r.path;
        } catch (err) {
          alert("选择文件夹失败: " + err.message);
        }
      });
      row.querySelector(".lib-save")?.addEventListener("click", async () => {
        const alias = row.querySelector(".lib-alias")?.value.trim();
        const path = row.querySelector(".lib-path")?.value.trim();
        try {
          await api(`/api/libraries/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alias, path }),
          });
          await loadLibraries();
          renderLibrarySettings();
        } catch (err) {
          alert("保存失败: " + err.message);
        }
      });
      row.querySelector(".lib-delete")?.addEventListener("click", async () => {
        if (!confirm("确定删除此视频库？可选择仅移除注册或同时删除其数据。")) return;
        const deleteData = confirm("是否同时删除该库的数据目录（收藏/历史/缩略图等）？\n确定 = 删除数据，取消 = 仅移除注册");
        try {
          await fetch(`/api/libraries/${encodeURIComponent(id)}?library_id=${encodeURIComponent(state.libraryId)}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ delete_data: deleteData }),
          }).then(async (res) => {
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.detail || res.statusText);
            }
            return res.json();
          });
          const data = await loadLibraries();
          if (state.libraryId === id) state.libraryId = data.active_library_id;
          await switchLibrary(state.libraryId, { resetBrowse: true });
          renderLibrarySettings();
        } catch (err) {
          alert("删除失败: " + err.message);
        }
      });
    });
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

  function dismissToast(el) {
    if (!el || el.classList.contains("hide")) return;
    clearTimeout(el._toastTimer);
    el.classList.remove("show");
    el.classList.add("hide");
    setTimeout(() => el.remove(), 280);
  }

  function showToast(message, { type = "info", duration = 3200 } = {}) {
    const stack = $("#toast-stack");
    if (!stack || !message) return;
    const icon = type === "success" ? "✓" : type === "error" ? "!" : "ℹ";
    const el = document.createElement("div");
    el.className = `toast toast--${type}`;
    el.setAttribute("role", type === "error" ? "alert" : "status");
    el.innerHTML = `<span class="toast-icon" aria-hidden="true">${icon}</span><span class="toast-text">${esc(message)}</span>`;
    el.addEventListener("click", () => dismissToast(el));
    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    el._toastTimer = setTimeout(() => dismissToast(el), duration);
  }

  function itemDisplayTitle(itemOrId) {
    const item = typeof itemOrId === "string" ? getItemById(itemOrId) : itemOrId;
    if (!item) return "视频";
    const t = (item.title || "").trim();
    const raw = t || item.filename || "视频";
    return raw.length > 32 ? `${raw.slice(0, 32)}…` : raw;
  }

  function albumDisplayName(albumId) {
    const found = state.albums.find(a => a.id === albumId);
    if (found?.name) return found.name;
    if (state.currentAlbum?.id === albumId && state.currentAlbum?.name) {
      return state.currentAlbum.name;
    }
    return "专辑";
  }

  function formatNameList(names, max = 2) {
    const uniq = [...new Set((names || []).filter(Boolean))];
    if (!uniq.length) return "";
    if (uniq.length <= max) return uniq.map(n => `「${n}」`).join("、");
    return `「${uniq[0]}」等 ${uniq.length} 个`;
  }

  function summarizeAlbumPickerOps(ops, videoCount) {
    const addedAlbums = [];
    const removedAlbums = [];
    let addedVideos = 0;
    let removedVideos = 0;
    ops.forEach(op => {
      const name = albumDisplayName(op.albumId);
      if (op.add?.length) {
        addedVideos += op.add.length;
        addedAlbums.push(name);
      }
      if (op.remove?.length) {
        removedVideos += op.remove.length;
        removedAlbums.push(name);
      }
    });
    const parts = [];
    const nLabel = videoCount === 1 ? `「${itemDisplayTitle(ops[0]?.add?.[0] || ops[0]?.remove?.[0])}」` : `${videoCount} 个视频`;
    if (addedVideos) {
      if (videoCount === 1 && addedAlbums.length === 1 && !removedVideos) {
        return `已将${nLabel}加入专辑${formatNameList(addedAlbums, 1)}`;
      }
      parts.push(`已加入${formatNameList(addedAlbums)}（${addedVideos} 项）`);
    }
    if (removedVideos) {
      if (videoCount === 1 && removedAlbums.length === 1 && !addedVideos) {
        return `已将${nLabel}从专辑${formatNameList(removedAlbums, 1)}移出`;
      }
      parts.push(`已从${formatNameList(removedAlbums)}移出（${removedVideos} 项）`);
    }
    return parts.join(" · ");
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
    const pageSize = getEffectivePageSize();
    const showPager = pageSize !== 0 && total > 0;
    $("#pagination-bottom").classList.toggle("hidden", !showPager);

    const prevDisabled = page <= 1;
    const nextDisabled = page >= totalPages || pageSize === 0;

    $("#btn-prev").disabled = prevDisabled;
    $("#btn-next").disabled = nextDisabled;

    const pageText = pageSize === 0
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
    resetThumbProgressOverride();
    hidePathTip();
    loadVideos({ forceRebuild: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function getCategoryOrderFromDom(list) {
    return [...list.querySelectorAll(".tree-cat-wrapper[data-category]")]
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
      const siblings = [...list.querySelectorAll(".tree-cat-wrapper[data-category]")]
        .filter(el => el.dataset.category && el !== dragging);
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

    list.querySelectorAll(".tree-cat-wrapper").forEach(wrapper => {
      if (!wrapper?.dataset.category) return;
      wrapper.addEventListener("mousedown", (e) => {
        if (e.target.closest(".cat-toggle, .tree-folder-row, .tree-children")) return;
        e.preventDefault();
        dragging = wrapper;
        wrapper.classList.add("dragging");
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

  function selectCategory(category, folder = "") {
    if (isAlbumView()) {
      state.viewMode = "browse";
      state.albumId = "";
      state.currentAlbum = null;
      updateViewModeButtons();
      updateGalleryPanels();
    } else if (state.viewMode !== "browse") {
      state.viewMode = "browse";
      updateViewModeButtons();
    }
    state.category = category;
    state.folder = folder;
    state.page = 1;
    if (!category) state.folder = "";
    regenerateRandomSeedIfNeeded();
    saveState();
    loadCategories();
    loadVideos({ forceRebuild: true });
  }

  async function switchThumbCandidate(videoId, { forceManual = false, label = "" } = {}) {
    const dlg = document.getElementById("thumb-picker-dialog");
    const grid = $("#thumb-picker-grid");
    const hint = dlg?.querySelector(".hint");
    const subtitle = $("#thumb-picker-subtitle");

    // Auto-select mode: generate candidates, pick best, don't show dialog
    if (state.thumbAutoSelectBest && !forceManual) {
      let candidates = [];
      try {
        const result = await api(`/api/thumb/${encodeURIComponent(videoId)}/candidates`, {
          method: "POST",
        });
        candidates = result.candidates || [];
      } catch (_) { /* fall through */ }
      if (!candidates.length) {
        showToast("未能生成候选缩略图");
        return;
      }
      // candidates are sorted by Laplacian score descending, pick first
      try {
        const best = candidates[0];
        const pickResult = await api(`/api/thumb/${encodeURIComponent(videoId)}/pick`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ index: best.index }),
        });
        if (pickResult.version) {
          state.thumbBust[videoId] = pickResult.version;
        }
        lastThumbRefreshAt = 0;
        void refreshVisibleThumbs();
        scheduleThumbRefresh(videoId);
        showToast(`已自动选择最优缩略图（${Math.round(best.pos * 100)}% 位置）`);
      } catch (_) { /* ignore */ }
      return;
    }

    // Manual mode: show picker dialog
    if (!dlg || !grid || !hint) return;

    // Set subtitle (title + progress for batch mode)
    if (subtitle) {
      if (label) {
        subtitle.textContent = label;
        subtitle.classList.remove("hidden");
      } else {
        subtitle.classList.add("hidden");
      }
    }

    // Generate candidates in background first, only show dialog on success
    let candidates = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await api(`/api/thumb/${encodeURIComponent(videoId)}/candidates`, {
          method: "POST",
        });
        candidates = result.candidates || [];
        if (candidates.length) break;
      } catch (_) { /* retry */ }
      // Only show progress feedback for retries (not the first attempt)
      if (attempt > 1) showToast("重新生成候选缩略图…");
    }

    if (!candidates.length) {
      showToast("无法生成缩略图");
      return;
    }

    hint.textContent = "点击选择一张作为缩略图";
    renderPickerGrid(candidates);
    dlg.showModal();
    let picked = false;

    function renderPickerGrid(cands) {
      const t = Date.now();
      grid.innerHTML = cands.map((c) => `
        <div class="thumb-picker-item" data-index="${c.index}" data-pos="${Math.round(c.pos * 100)}">
          <img src="/api/thumb/${encodeURIComponent(videoId)}/candidate/${c.index}?v=${t}"
               alt="候选 ${Math.round(c.pos * 100)}%"
               loading="eager" decoding="async"
               onerror="this.style.display='none';this.nextElementSibling.textContent+=' ERR'">
          <div class="thumb-picker-label">${Math.round(c.pos * 100)}%</div>
        </div>
      `).join("");
      grid.querySelectorAll(".thumb-picker-item").forEach(el => {
        el.addEventListener("click", () => selectItem(el));
      });
    }

    const selectItem = async (el) => {
      if (picked) return;
      const index = parseInt(el.dataset.index, 10);
      el.classList.add("selected");
      hint.textContent = "正在应用…";

      try {
        const result = await api(`/api/thumb/${encodeURIComponent(videoId)}/pick`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ index }),
        });
        if (result.version) {
          state.thumbBust[videoId] = result.version;
        }
        picked = true;
        refreshThumbById(videoId);
        dlg.close();
      } catch (pickErr) {
        // Regenerate candidates and retry
        el.classList.remove("selected");
        hint.textContent = "重新生成中…";
        grid.innerHTML = "";

        let retryCands = [];
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const retry = await api(`/api/thumb/${encodeURIComponent(videoId)}/candidates`, {
              method: "POST",
            });
            retryCands = retry.candidates || [];
            if (retryCands.length) break;
          } catch {}
          if (attempt < 3 && !retryCands.length) {
            hint.textContent = "正在重试生成…";
          }
        }

        if (retryCands.length) {
          hint.textContent = "已重新生成，请重新选择";
          renderPickerGrid(retryCands);
        } else {
          dlg.close();
          showToast("无法生成缩略图");
        }
      }
    };

    // "换一组" button: regenerate with jittered positions
    let rerolling = false;
    const rerollBtn = $("#thumb-picker-reroll");
    rerollBtn.onclick = async () => {
      if (rerolling) return;
      rerolling = true;
      rerollBtn.disabled = true;
      hint.textContent = "重新生成中…";
      grid.innerHTML = "";

      let newCands = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await api(`/api/thumb/${encodeURIComponent(videoId)}/candidates?jitter=1`, {
            method: "POST",
          });
          newCands = res.candidates || [];
          if (newCands.length) break;
        } catch {}
        if (attempt < 3 && !newCands.length) {
          hint.textContent = "正在重试生成…";
        }
      }

      if (newCands.length) {
        hint.textContent = "点击选择一张作为缩略图";
        renderPickerGrid(newCands);
      } else {
        dlg.close();
        showToast("无法生成缩略图");
      }
      rerolling = false;
      rerollBtn.disabled = false;
    };

    dlg.querySelector("button[value='cancel']")?.addEventListener("click", () => {
      dlg.close();
    });

    await new Promise(r => dlg.addEventListener("close", r, { once: true }));
  }

  async function batchRegenerateThumbs(ids) {
    if (!ids.length) return;

    // Manual batch: sequential picking, one video at a time
    if (!state.thumbBatchAutoSelect) {
      for (let i = 0; i < ids.length; i++) {
        const title = itemDisplayTitle(ids[i]);
        const progress = `${i + 1}/${ids.length}`;
        await switchThumbCandidate(ids[i], {
          forceManual: true,
          label: `${progress}  ·  ${title}`,
        });
      }
      return;
    }

    // Auto batch: use Laplacian candidate scoring
    try {
      markThumbsRegenerating(ids, "batch");
      const result = await api("/api/thumb/batch-regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, auto_select: state.thumbBatchAutoSelect }),
      });
      if (result.versions) {
        Object.entries(result.versions).forEach(([id, ver]) => {
          state.thumbBust[id] = ver;
        });
      }
      lastThumbRefreshAt = 0;
      void refreshVisibleThumbs();
      scheduleLoadProgress(300);
    } catch (err) {
      alert("批量换缩略图失败: " + err.message);
    }
  }

  function updateViewModeButtons() {
    $$(".view-mode-btn").forEach(btn => {
      const v = btn.dataset.view;
      let active = v === state.viewMode;
      if (v === "albums" && isAlbumDetailView()) active = true;
      btn.classList.toggle("active", active);
    });
  }

  function isBrowseHome() {
    return state.viewMode === "browse"
      && !state.category
      && !state.folder
      && !state.query
      && state.page <= 1;
  }

  function goHome() {
    state.viewMode = "browse";
    state.albumId = "";
    state.currentAlbum = null;
    state.category = "";
    state.folder = "";
    state.query = "";
    state.page = 1;
    const search = $("#search");
    if (search) search.value = "";
    updateViewModeButtons();
    updateGalleryPanels();
    saveState();
    loadCategories();
    loadVideos({ forceRebuild: true });
  }

  function setViewMode(mode, opts = {}) {
    const prev = state.viewMode;
    if (mode === "browse") {
      state.viewMode = "browse";
      state.albumId = "";
      state.currentAlbum = null;
    } else if (mode === "albums") {
      state.viewMode = "albums";
      state.albumId = "";
      state.currentAlbum = null;
    } else {
      state.viewMode = mode;
      state.albumId = "";
      state.currentAlbum = null;
      if (prev !== mode) {
        state.category = "";
        state.folder = "";
      }
    }
    if (mode === "album-detail" && opts.albumId) {
      state.viewMode = "album-detail";
      state.albumId = opts.albumId;
    }
    if (prev === state.viewMode && mode !== "album-detail") return;
    state.page = 1;
    updateViewModeButtons();
    updateGalleryPanels();
    saveState();
    loadCategories();
    if (isAlbumListView()) {
      updateUrl(true);
      void loadAlbums();
    } else if (isAlbumDetailView() && opts.albumId) {
      void openAlbumDetail(opts.albumId);
    } else {
      loadVideos({ forceRebuild: true });
    }
  }

  function statusLabel(total, page, totalPages) {
    if (!total) {
      if (state.formatFilter) {
        return `0 个视频 · 筛选: ${formatFilterLabel(state.formatFilter)}`;
      }
      if (state.viewMode === "favorites") return "暂无收藏";
      if (state.viewMode === "history") return "暂无最近播放";
      if (isAlbumDetailView()) return "专辑内暂无视频";
      return "0 个视频";
    }
    let prefix = `${total} 个视频`;
    if (state.viewMode === "favorites") prefix = `${total} 个收藏`;
    else if (state.viewMode === "history") prefix = `${total} 条最近播放`;
    else if (isAlbumDetailView()) prefix = `${total} 个视频`;
    if (state.formatFilter) prefix += ` · 筛选: ${formatFilterLabel(state.formatFilter)}${formatIndexHint()}`;
    const fixedHere = state.pageItems.filter(v => v.remuxedOnPage).length;
    if (state.formatFilter === "remuxable" && fixedHere > 0) {
      prefix += ` · 本页已修复 ${fixedHere}`;
    }
    return `${prefix} · 第 ${page}/${totalPages} 页`;
  }

  function updateEmptyMessage(total) {
    let msg = "暂无视频";
    if (state.formatFilter) {
      msg = "没有符合该格式的视频（后台正在分析未检测项，可稍后再试）";
    } else if (state.viewMode === "favorites") msg = "暂无收藏";
    else if (state.viewMode === "history") msg = "暂无最近播放";
    else if (isAlbumDetailView()) msg = "专辑内暂无视频";
    $("#empty").textContent = msg;
    $("#empty").classList.toggle("hidden", total > 0);
    $("#grid").classList.toggle("hidden", total === 0);
  }

  function isAlbumListView() {
    return state.viewMode === "albums";
  }

  function isAlbumDetailView() {
    return state.viewMode === "album-detail";
  }

  function isAlbumView() {
    return isAlbumListView() || isAlbumDetailView();
  }

  function updateAlbumToolbar() {
    const bar = $("#album-toolbar-actions");
    if (!bar) return;
    const list = isAlbumListView();
    const detail = isAlbumDetailView();
    bar.classList.toggle("hidden", !isAlbumView());
    $("#btn-albums-back")?.classList.toggle("hidden", !detail);
    $("#btn-album-create")?.classList.toggle("hidden", !list);
    $("#btn-album-play-all")?.classList.toggle("hidden", !detail);
    $("#btn-album-edit")?.classList.toggle("hidden", !detail);
    const pageGen = !isAlbumView() && state.pageItems.length > 0;
    $("#btn-album-from-page")?.classList.toggle("hidden", !pageGen);
    $("#sort")?.classList.toggle("hidden", list);
    $("#format-filter")?.classList.toggle("hidden", list);
    document.querySelector(".page-size-controls")?.classList.toggle("hidden", list);
    document.querySelector(".toolbar-right .pagination")?.classList.toggle("hidden", list);
  }

  function updateGalleryPanels() {
    const list = isAlbumListView();
    $("#albums-view")?.classList.toggle("hidden", !list);
    // folder tree is now integrated into sidebar
    if (list) {
      $("#grid")?.classList.add("hidden");
      $("#empty")?.classList.add("hidden");
      $("#pagination-bottom")?.classList.add("hidden");
    } else {
      $("#grid")?.classList.remove("hidden");
    }
    updateAlbumToolbar();
  }

  function albumCoverHtml(album) {
    const coverId = album?.cover_video_id;
    if (coverId) {
      return `<img src="${libThumbUrl(coverId)}" alt="" loading="lazy" decoding="async">`;
    }
    return `<div class="album-cover-placeholder" aria-hidden="true">📁</div>`;
  }

  function albumApiErrorMessage(err) {
    const msg = err?.message || String(err);
    if (msg === "Not Found" || /not found/i.test(msg)) {
      return "专辑 API 不可用，请在设置中重启服务，或运行 restart.py 后再试";
    }
    return msg;
  }

  async function loadAlbums() {
    updateGalleryPanels();
    try {
      const data = await api("/api/albums");
      state.albums = data.items || [];
    } catch (err) {
      const text = `加载失败: ${albumApiErrorMessage(err)}`;
      $("#albums-empty").textContent = text;
      $("#albums-empty").classList.remove("hidden");
      $("#album-grid").innerHTML = "";
      if (!isAlbumListView()) alert(`加载专辑列表失败: ${albumApiErrorMessage(err)}`);
      return;
    }
    renderAlbumsGrid();
  }

  function albumDurationLabel(album) {
    const sec = album.total_duration_sec;
    if (sec != null && Number.isFinite(sec) && sec > 0) {
      return formatDuration(sec);
    }
    return "";
  }

  function renderAlbumsGrid() {
    const grid = $("#album-grid");
    const empty = $("#albums-empty");
    if (!grid || !empty) return;
    if (!state.albums.length) {
      grid.innerHTML = "";
      empty.textContent = "暂无专辑，点击「新建专辑」开始整理视频";
      empty.classList.remove("hidden");
      $("#status").textContent = "0 个专辑";
      return;
    }
    empty.classList.add("hidden");
    grid.innerHTML = state.albums.map(a => {
      const desc = (a.description || "").trim();
      const updatedAt = a.updated_at ? formatTs(a.updated_at) : "";
      return `<div class="album-card" data-id="${escAttr(a.id)}">
        <div class="album-cover">
          ${albumCoverHtml(a)}
          <div class="album-cover-gradient"></div>
          <div class="album-cover-overlay">
            <button type="button" class="album-play-btn" data-play-all="${escAttr(a.id)}" title="播放全部" aria-label="播放全部">▶</button>
          </div>
        </div>
        <div class="album-card-body">
          <div class="album-card-name" title="${escAttr(a.name)}">${esc(a.name)}</div>
          ${desc ? `<div class="album-card-desc">${esc(desc)}</div>` : ""}
          <div class="album-card-stats">
            <span><span class="stat-icon">📹</span>${a.video_count || 0} 个视频</span>
          </div>
          ${updatedAt ? `<div class="album-card-date">更新于 ${updatedAt}</div>` : ""}
        </div>
      </div>`;
    }).join("");
    // 卡片点击 → 进入详情
    grid.querySelectorAll(".album-card").forEach(card => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".album-play-btn")) return;
        openAlbumDetail(card.dataset.id);
      });
      card.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showAlbumCtxMenu(e.clientX, e.clientY, card.dataset.id);
      });
    });
    // 播放全部按钮 → 直接播放
    grid.querySelectorAll(".album-play-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        playAlbumById(btn.dataset.playAll);
      });
    });
    $("#status").textContent = `${state.albums.length} 个专辑`;
  }

  async function openAlbumDetail(albumId) {
    if (!albumId) return;
    state.viewMode = "album-detail";
    state.albumId = albumId;
    state.category = "";
    state.folder = "";
    state.page = 1;
    updateViewModeButtons();
    updateGalleryPanels();
    saveState();
    try {
      state.currentAlbum = await api(`/api/albums/${encodeURIComponent(albumId)}`);
    } catch (err) {
      alert("加载专辑失败: " + err.message);
      state.viewMode = "albums";
      state.albumId = "";
      state.currentAlbum = null;
      updateViewModeButtons();
      updateGalleryPanels();
      await loadAlbums();
      return;
    }
    updateBreadcrumb();
    updateUrl(true);
    await loadVideos({ forceRebuild: true });
  }

  function backToAlbumsList() {
    state.viewMode = "albums";
    state.albumId = "";
    state.currentAlbum = null;
    state.page = 1;
    updateViewModeButtons();
    updateGalleryPanels();
    updateBreadcrumb();
    saveState();
    updateUrl(true);
    void loadAlbums();
  }

  async function refreshCurrentAlbumMeta() {
    if (!state.albumId) return;
    try {
      state.currentAlbum = await api(`/api/albums/${encodeURIComponent(state.albumId)}`);
      updateBreadcrumb();
    } catch (_) { /* ignore */ }
  }

  function openAlbumFormDialog({ mode = "create", album = null, pendingIds = [] } = {}) {
    const dlg = $("#album-form-dialog");
    const title = $("#album-form-title");
    const hint = $("#album-form-hint");
    const nameInput = $("#album-form-name");
    const descInput = $("#album-form-desc");
    const delWrap = $("#album-form-delete-wrap");
    if (!dlg || !nameInput) return;
    dlg.dataset.mode = mode;
    dlg.dataset.albumId = album?.id || "";
    state.albumFormPendingIds = pendingIds || [];
    if (mode === "edit" && album) {
      title.textContent = "编辑专辑";
      hint.textContent = "修改名称或描述；删除专辑不会删除视频文件。";
      nameInput.value = album.name || "";
      descInput.value = album.description || "";
      delWrap?.classList.remove("hidden");
    } else {
      title.textContent = pendingIds.length ? "新建专辑并加入视频" : "新建专辑";
      hint.textContent = pendingIds.length
        ? `将 ${pendingIds.length} 个视频加入新专辑（仅当前视频库）。`
        : "专辑仅对当前视频库有效，视频可归属多个专辑。";
      nameInput.value = "";
      descInput.value = "";
      delWrap?.classList.add("hidden");
    }
    dlg.showModal();
    nameInput.focus();
  }

  async function submitAlbumForm(value) {
    const dlg = $("#album-form-dialog");
    if (!dlg || value !== "save") return;
    const mode = dlg.dataset.mode || "create";
    const albumId = dlg.dataset.albumId || "";
    const name = ($("#album-form-name")?.value || "").trim();
    const description = ($("#album-form-desc")?.value || "").trim();
    if (!name) {
      showToast("请输入专辑名称", { type: "info" });
      dlg.showModal();
      return;
    }
    let pending = [];
    try {
      if (mode === "edit" && albumId) {
        await api(`/api/albums/${encodeURIComponent(albumId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description }),
        });
        if (isAlbumDetailView() && state.albumId === albumId) {
          await refreshCurrentAlbumMeta();
        } else if (isAlbumListView()) {
          await loadAlbums();
        }
        showToast(`专辑已更新：「${name}」`, { type: "success" });
      } else {
        const r = await api("/api/albums", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description }),
        });
        const newId = r.album?.id;
        pending = [...(state.albumFormPendingIds || [])];
        state.albumFormPendingIds = [];
        if (newId && pending.length) {
          await api(`/api/albums/${encodeURIComponent(newId)}/videos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: pending }),
          });
          applyAlbumIdsToItems(pending, newId, true);
          syncCardAlbums();
          pending.forEach(id => {
            if (state.playerViewOpen && state.playingId === id) {
              updatePlayerAlbumButton(getItemById(id));
            }
          });
        }
        if (isAlbumListView()) {
          await loadAlbums();
        } else if (isAlbumDetailView()) {
          await refreshCurrentAlbumMeta();
          await loadVideos({ forceRebuild: true });
        } else if (pending.length) {
          await loadVideos();
        }
        if (pending.length) {
          showToast(`已创建专辑「${name}」并加入 ${pending.length} 个视频`, { type: "success" });
        } else {
          showToast(`已创建专辑「${name}」`, { type: "success" });
        }
      }
    } catch (err) {
      showToast("保存专辑失败: " + albumApiErrorMessage(err), { type: "error", duration: 4500 });
      dlg.showModal();
    }
  }

  async function deleteAlbumById(albumId) {
    const album = state.albums.find(a => a.id === albumId)
      || (state.currentAlbum?.id === albumId ? state.currentAlbum : null);
    const name = album?.name || "该专辑";
    if (!confirm(`确定删除专辑「${name}」？视频文件不会删除。`)) return;
    try {
      await api(`/api/albums/${encodeURIComponent(albumId)}`, { method: "DELETE" });
      if (isAlbumDetailView() && state.albumId === albumId) {
        backToAlbumsList();
      } else if (isAlbumListView()) {
        await loadAlbums();
      }
      showToast(`已删除专辑「${name}」`, { type: "success" });
    } catch (err) {
      showToast("删除失败: " + albumApiErrorMessage(err), { type: "error", duration: 4500 });
    }
  }

  async function deleteCurrentAlbum() {
    const albumId = state.albumId || $("#album-form-dialog")?.dataset.albumId;
    if (!albumId) return;
    $("#album-form-dialog")?.close();
    await deleteAlbumById(albumId);
  }

  async function editAlbumById(albumId) {
    try {
      const album = await api(`/api/albums/${encodeURIComponent(albumId)}`);
      openAlbumFormDialog({ mode: "edit", album });
    } catch (err) {
      alert("加载专辑失败: " + albumApiErrorMessage(err));
    }
  }

  async function playAlbumById(albumId) {
    try {
      const album = await api(`/api/albums/${encodeURIComponent(albumId)}`);
      const ids = album.video_ids || [];
      if (!ids.length) {
        showToast("专辑内暂无视频", { type: "info" });
        return;
      }
      await openAlbumDetail(albumId);
      await playVideo(ids[0]);
    } catch (err) {
      alert("播放失败: " + albumApiErrorMessage(err));
    }
  }

  function showAlbumCtxMenu(x, y, albumId) {
    hideCtxMenu();
    state.albumCtxTarget = albumId;
    const album = state.albums.find(a => a.id === albumId);
    const playBtn = $("#album-ctx-menu")?.querySelector('[data-action="album-play-all"]');
    if (playBtn) {
      const n = album?.video_count || 0;
      playBtn.classList.toggle("hidden", n <= 0);
      playBtn.disabled = n <= 0;
    }
    const menu = $("#album-ctx-menu");
    if (!menu) return;
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

  function hideAlbumCtxMenu() {
    $("#album-ctx-menu")?.classList.add("hidden");
    state.albumCtxTarget = null;
  }

  function applyAlbumIdsToItems(videoIds, albumId, add) {
    videoIds.forEach(id => {
      const item = getItemById(id);
      if (!item) return;
      const set = new Set(item.albumIds || []);
      if (add) set.add(albumId);
      else set.delete(albumId);
      item.albumIds = [...set];
    });
  }

  function videoInAnyAlbum(item) {
    return Array.isArray(item?.albumIds) && item.albumIds.length > 0;
  }

  function updateCardAlbum(card, item) {
    if (!card) return;
    card.classList.toggle("in-album", videoInAnyAlbum(item));
    const badge = card.querySelector(".card-album-badge");
    if (badge) {
      const n = item?.albumIds?.length || 0;
      badge.classList.toggle("on", n > 0);
      badge.title = n > 0 ? `已在 ${n} 个专辑` : "加入专辑";
      badge.setAttribute("aria-label", badge.title);
    }
  }

  function cardAlbumBadgeHtml(v) {
    const albumOn = (v.albumIds?.length || 0) > 0 ? "on" : "";
    const n = v.albumIds?.length || 0;
    const albumTitle = albumOn ? `已在 ${n} 个专辑` : "加入专辑";
    return `<button type="button" class="card-album-badge ${albumOn}" data-id="${escAttr(v.id)}" title="${escAttr(albumTitle)}" aria-label="${escAttr(albumTitle)}">
      <svg class="card-album-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
      </svg>
    </button>`;
  }

  function syncCardAlbums() {
    state.pageItems.forEach(v => {
      const card = document.querySelector(`.card[data-id="${CSS.escape(v.id)}"]`);
      if (card) updateCardAlbum(card, v);
    });
  }

  function updatePlayerAlbumButton(itemOrId) {
    const btn = $("#btn-player-album");
    if (!btn) return;
    const id = typeof itemOrId === "string" ? itemOrId : itemOrId?.id;
    const item = typeof itemOrId === "object" && itemOrId ? itemOrId : (id ? getItemById(id) : null);
    const n = item?.albumIds?.length || 0;
    const inAlbum = n > 0;
    btn.classList.toggle("on", inAlbum);
    btn.textContent = inAlbum ? `📁 ${n} 个专辑` : "📁 加入专辑";
    btn.title = inAlbum ? `已在 ${n} 个专辑，点击管理` : "加入专辑";
    btn.setAttribute("aria-label", btn.title);
    btn.setAttribute("aria-pressed", inAlbum ? "true" : "false");
  }

  async function openAlbumPicker(videoIds) {
    const ids = [...new Set((videoIds || []).filter(Boolean))];
    if (!ids.length) return;
    const dlg = $("#album-picker-dialog");
    const list = $("#album-picker-list");
    if (!dlg || !list) return;
    $("#album-picker-hint").textContent = ids.length === 1
      ? "勾选要加入的专辑，取消勾选将从专辑移除。"
      : `为 ${ids.length} 个视频选择专辑归属。`;
    let albums = [];
    try {
      const data = await api("/api/albums");
      albums = data.items || [];
      state.albums = albums;
    } catch (err) {
      alert("加载专辑列表失败: " + albumApiErrorMessage(err));
      return;
    }
    const membership = (albumId) => {
      const hits = ids.filter(id => {
        const item = getItemById(id);
        return (item?.albumIds || []).includes(albumId);
      });
      return { all: hits.length === ids.length, some: hits.length > 0 && hits.length < ids.length };
    };
    if (!albums.length) {
      list.innerHTML = `<p class="hint">还没有专辑，可先新建。</p>`;
    } else {
      list.innerHTML = albums.map(a => {
        const m = membership(a.id);
        const checked = m.all ? "checked" : "";
        const ind = m.some ? ' data-indeterminate="1"' : "";
        return `<label class="album-picker-item">
          <input type="checkbox" value="${escAttr(a.id)}" ${checked}${ind}>
          <span class="album-picker-name">${esc(a.name)}</span>
          <span class="album-picker-count">${a.video_count || 0} 个视频</span>
        </label>`;
      }).join("");
      list.querySelectorAll('input[data-indeterminate="1"]').forEach(inp => {
        inp.indeterminate = true;
      });
    }
    dlg.dataset.videoIds = ids.join(",");
    dlg.showModal();
  }

  async function submitAlbumPicker(value) {
    const dlg = $("#album-picker-dialog");
    if (!dlg || value !== "save") return;
    const ids = (dlg.dataset.videoIds || "").split(",").filter(Boolean);
    if (!ids.length) return;
    const boxes = [...dlg.querySelectorAll("#album-picker-list input[type=checkbox]")];
    const ops = [];
    boxes.forEach(box => {
      const albumId = box.value;
      const want = box.checked;
      const haveAll = ids.every(id => (getItemById(id)?.albumIds || []).includes(albumId));
      const haveSome = ids.some(id => (getItemById(id)?.albumIds || []).includes(albumId));
      if (want && !haveAll) {
        const missing = ids.filter(id => !(getItemById(id)?.albumIds || []).includes(albumId));
        if (missing.length) ops.push({ albumId, add: missing });
      } else if (!want && haveSome) {
        const present = ids.filter(id => (getItemById(id)?.albumIds || []).includes(albumId));
        if (present.length) ops.push({ albumId, remove: present });
      }
    });
    try {
      for (const op of ops) {
        if (op.add?.length) {
          await api(`/api/albums/${encodeURIComponent(op.albumId)}/videos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: op.add }),
          });
          op.add.forEach(id => applyAlbumIdsToItems([id], op.albumId, true));
        }
        if (op.remove?.length) {
          await api(`/api/albums/${encodeURIComponent(op.albumId)}/videos/remove`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: op.remove }),
          });
          op.remove.forEach(id => applyAlbumIdsToItems([id], op.albumId, false));
        }
      }
      syncCardAlbums();
      ids.forEach(id => {
        if (state.playerViewOpen && state.playingId === id) {
          updatePlayerAlbumButton(getItemById(id));
        }
      });
      if (isAlbumDetailView()) {
        await refreshCurrentAlbumMeta();
        await loadVideos({ forceRebuild: true });
      } else if (isAlbumListView()) {
        await loadAlbums();
      }
      if (ops.length) {
        const msg = summarizeAlbumPickerOps(ops, ids.length);
        showToast(msg, { type: "success" });
      } else {
        showToast("专辑归属未变更", { type: "info" });
      }
    } catch (err) {
      showToast("更新专辑归属失败: " + albumApiErrorMessage(err), { type: "error", duration: 4500 });
    }
  }

  async function setAlbumCover(videoId) {
    if (!state.albumId) return;
    try {
      await api(`/api/albums/${encodeURIComponent(state.albumId)}/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_id: videoId }),
      });
      await refreshCurrentAlbumMeta();
      if (isAlbumListView()) await loadAlbums();
      const albumName = state.currentAlbum?.name || albumDisplayName(state.albumId);
      showToast(`已将「${itemDisplayTitle(videoId)}」设为专辑「${albumName}」封面`, { type: "success" });
    } catch (err) {
      showToast("设置封面失败: " + err.message, { type: "error", duration: 4500 });
    }
  }

  async function playAlbumAll() {
    if (!isAlbumDetailView() || !state.pageItems.length) return;
    await playVideo(state.pageItems[0].id);
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
    if (isAlbumListView()) {
      el.textContent = "我的专辑";
      el.classList.remove("hidden");
      return;
    }
    if (isAlbumDetailView()) {
      const name = state.currentAlbum?.name || "专辑";
      const count = state.currentAlbum?.video_count ?? state.total;
      const dur = formatDuration(state.currentAlbum?.total_duration_sec);
      let meta = `${count || 0} 个视频`;
      if (dur) meta += ` · ${dur}`;
      el.innerHTML = `<button type="button" class="breadcrumb-link" id="breadcrumb-albums">我的专辑</button><span class="sep">/</span>${esc(name)} <span class="breadcrumb-meta">${esc(meta)}</span>`;
      el.classList.remove("hidden");
      $("#breadcrumb-albums")?.addEventListener("click", backToAlbumsList);
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
    // (grip hidden via CSS, only used as drag handle in custom sort mode)

    // (folder trees are fetched per-category inside the loop)

    // Recursively render folder tree nodes
    function renderFolderTree(nodes, depth = 0) {
      return nodes.map(n => {
        const hasChildren = n.children && n.children.length > 0;
        const isActive = state.folder === n.path;
        const indent = 28 + depth * 14;
        const isExpanded = state.expandedCategories?.has(n.path);
        return `<div class="tree-folder-node">
          <div class="tree-folder-row ${isActive ? "active" : ""}"
               data-folder="${escAttr(n.path)}" style="padding-left:${indent}px"
               role="button" tabindex="0">
            ${hasChildren
              ? `<span class="folder-toggle ${isExpanded ? "expanded" : ""}">▶</span>`
              : '<span class="folder-toggle" style="visibility:hidden">▶</span>'}
            <span class="tree-folder-name" title="${escAttr(n.path)}">${esc(n.name)}</span>
            <span class="tree-folder-count">${n.total}</span>
          </div>
          ${hasChildren
            ? `<div class="tree-children ${isExpanded ? "" : "collapsed"}">${renderFolderTree(n.children, depth + 1)}</div>`
            : ""}
        </div>`;
      }).join("");
    }

    // Build HTML: "All" item + each category in a wrapper
    let html = `
      <div class="cat-item cat-all ${state.category === "" ? "active" : ""}" data-category="" role="button" tabindex="0">
        <span class="cat-left"><span class="cat-name">全部</span></span>
        <span class="cat-count">${total}</span>
      </div>`;

    for (const c of cats) {
      const isActiveCat = state.category === c.name;
      const hasSubfolders = c.has_subfolders === true;
      const catExpanded = state.expandedCategories?.has(c.name);
      
      // Read cached tree data (always), fetch only for active/expanded categories
      let folderTree = state.folderTrees[c.name] || null;
      if (!folderTree && (isActiveCat || catExpanded)) {
        try {
          folderTree = await fetchFolderTree(c.name);
        } catch (_) {}
      }

      const hasTree = folderTree && folderTree.folders && folderTree.folders.length > 0;
      const showTree = hasTree && catExpanded !== false;

      html += `<div class="tree-cat-wrapper" data-category="${escAttr(c.name)}">
        <div class="cat-item ${isActiveCat && !state.folder ? "active" : ""}"
             data-category="${escAttr(c.name)}" role="button" tabindex="0">
          <span class="cat-left">
            ${hasSubfolders ? `<span class="cat-toggle ${showTree ? "expanded" : ""}">▶</span>` : ""}
            ${grip}
            <span class="cat-name" title="${escAttr(c.name)}">${esc(c.name)}</span>
          </span>
          <span class="cat-count">${c.count}</span>
        </div>
        ${showTree ? `
        <div class="tree-children">
          ${renderFolderTree(folderTree.folders || [], 0)}
        </div>` : ""}
      </div>`;
    }

    list.innerHTML = html;

    // Single delegated handlers (bound once)
    if (!_catTreeDelegateBound) {
      _catTreeDelegateBound = true;

    // Single delegated handler: click
    list.addEventListener("click", async (e) => {
      // 1. Category toggle arrow
      const catToggle = e.target.closest(".cat-toggle");
      if (catToggle) {
        const wrapper = catToggle.closest(".tree-cat-wrapper");
        const name = wrapper?.dataset.category;
        if (!name) return;
        const children = wrapper.querySelector(".tree-children");
        if (!children) {
          try {
            const tree = await fetchFolderTree(name);
            if (tree && tree.folders?.length) {
              state.folderTrees[name] = tree;
              if (!state.expandedCategories) state.expandedCategories = new Set();
              state.expandedCategories.add(name);
              await renderCategoryList(state._lastCats, state.categorySortMode);
            }
          } catch (_) {}
          return;
        }
        const collapsed = children.classList.toggle("collapsed");
        catToggle.classList.toggle("expanded");
        if (collapsed) state.expandedCategories.delete(name);
        else state.expandedCategories.add(name);
        return;
      }

      // 2. Folder toggle
      const folderToggle = e.target.closest(".folder-toggle");
      if (folderToggle) {
        const row = folderToggle.closest(".tree-folder-row");
        const children = row?.nextElementSibling;
        if (!children || !children.classList.contains("tree-children")) return;
        const collapsed = children.classList.toggle("collapsed");
        folderToggle.classList.toggle("expanded");
        const path = row?.dataset.folder;
        if (path) {
          if (collapsed) state.expandedCategories.delete(path);
          else state.expandedCategories.add(path);
        }
        return;
      }

      // 3. Folder row
      const folderRow = e.target.closest(".tree-folder-row");
      if (folderRow) {
        selectCategory(state.category, folderRow.dataset.folder);
        return;
      }

      // 5. Category item (包括 .cat-all) — toggle expand + select
      const catItem = e.target.closest(".cat-item");
      if (catItem) {
        const name = catItem.dataset.category;
        if (name !== undefined) {
          state.folder = "";
          if (name) {
            if (!state.expandedCategories) state.expandedCategories = new Set();
            if (state.expandedCategories.has(name)) {
              state.expandedCategories.delete(name);
            } else {
              state.expandedCategories.add(name);
            }
          }
          selectCategory(name, "");
        }
      }
    });

    // Single delegated handler: keyboard
    list.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest(".cat-toggle")) return;
      const catItem = e.target.closest(".cat-item");
      if (!catItem) return;
      e.preventDefault();
      const name = catItem.dataset.category;
      state.folder = "";
      if (name) {
        if (!state.expandedCategories) state.expandedCategories = new Set();
        if (state.expandedCategories.has(name)) state.expandedCategories.delete(name);
        else state.expandedCategories.add(name);
      }
      selectCategory(name ?? "", "");
    });

    // Single delegated handler: context menu
    list.addEventListener("contextmenu", (e) => {
      const folderRow = e.target.closest(".tree-folder-row");
      if (folderRow) {
        e.preventDefault();
        e.stopPropagation();
        showFolderCtxMenu(e.clientX, e.clientY, folderRow.dataset.folder || "");
        return;
      }
      const catItem = e.target.closest(".cat-item");
      if (catItem?.dataset.category) {
        e.preventDefault();
        e.stopPropagation();
        showFolderCtxMenu(e.clientX, e.clientY, catItem.dataset.category, "cat");
      }
    });

    } // end one-time delegate setup

    bindCategoryDrag(list);
  }

  async function loadCategories() {
    const data = await api("/api/categories");
    await renderCategoryList(data.items, data.sort_mode);
  }

  function getItemById(id) {
    return state.pageItems.find(v => v.id === id)
      || state.playlistItems.find(v => v.id === id);
  }

  function naturalCompare(a, b) {
    const ax = String(a ?? "").toLowerCase();
    const bx = String(b ?? "").toLowerCase();
    const tokenize = (s) => s.match(/(\d+|\D+)/g) || [];
    const ap = tokenize(ax);
    const bp = tokenize(bx);
    const len = Math.max(ap.length, bp.length);
    for (let i = 0; i < len; i++) {
      const ac = ap[i] || "";
      const bc = bp[i] || "";
      if (ac === bc) continue;
      const an = /^\d+$/.test(ac);
      const bn = /^\d+$/.test(bc);
      if (an && bn) return parseInt(ac, 10) - parseInt(bc, 10);
      return ac < bc ? -1 : 1;
    }
    return 0;
  }

  function sortPlaylistItems(items, sortKey) {
    const list = [...items];
    const key = sortKey || state.playlistSort || "page";
    if (key === "page" || key === "random") return list;
    const cmpStr = (a, b) => naturalCompare(a, b);
    const sorters = {
      filename_asc: (a, b) => cmpStr(a.filename, b.filename) || cmpStr(a.title, b.title),
      filename_desc: (a, b) => cmpStr(b.filename, a.filename) || cmpStr(b.title, a.title),
      title_asc: (a, b) => cmpStr(a.title || a.filename, b.title || b.filename),
      title_desc: (a, b) => cmpStr(b.title || b.filename, a.title || a.filename),
      mtime_desc: (a, b) => (b.mtime || 0) - (a.mtime || 0),
      mtime_asc: (a, b) => (a.mtime || 0) - (b.mtime || 0),
      size_desc: (a, b) => (b.size || 0) - (a.size || 0),
      size_asc: (a, b) => (a.size || 0) - (b.size || 0),
    };
    const sorter = sorters[key];
    if (sorter) list.sort(sorter);
    return list;
  }

  function playlistApiSort() {
    return state.playlistSort === "page" ? state.sort : state.playlistSort;
  }

  function buildPlaylistScopeKey() {
    return [
      state.libraryId,
      state.viewMode,
      state.albumId,
      state.category,
      state.folder,
      state.query,
      state.playlistSort,
      playlistApiSort(),
    ].join("\0");
  }

  function playlistScopeMatches() {
    return state.playlistScopeKey === buildPlaylistScopeKey();
  }

  function buildPlaylistFetchParams(pageNum) {
    const params = new URLSearchParams();
    if (state.viewMode === "favorites") params.set("favorites", "1");
    else if (state.viewMode === "history") params.set("history", "1");
    else if (isAlbumDetailView() && state.albumId) params.set("album_id", state.albumId);
    else {
      if (state.category) params.set("category", state.category);
      if (state.category && !state.query) params.set("folder", state.folder || "");
    }
    if (state.query) params.set("q", state.query);
    const sort = playlistApiSort();
    params.set("sort", sort);
    if (sort === "random") {
      const seed = state.playlistSort === "random" ? state.playlistRandomSeed : state.randomSeed;
      if (seed != null) params.set("seed", String(seed));
    }
    params.set("page", String(pageNum));
    params.set("page_size", String(getEffectivePageSize()));
    return params;
  }

  function updatePlaylistPagingMeta(pageNum, totalPages) {
    state.playlistLoadedThrough = pageNum;
    state.playlistTotalPages = totalPages;
    const pageSize = getEffectivePageSize();
    state.playlistCanLoadMore = pageSize !== 0 && pageNum < totalPages;
  }

  async function ensurePlaylistCoversId(id) {
    if (!id) return;
    if (state.playlistItems.some(v => v.id === id)) return;
    const pageSize = getEffectivePageSize();
    if (pageSize === 0) {
      await ensurePlayingItemInPlaylist(id);
      return;
    }
    const maxPages = Math.max(state.playlistTotalPages || 1, 1);
    let guard = 0;
    while (
      state.playlistCanLoadMore
      && !state.playlistItems.some(v => v.id === id)
      && guard < maxPages
    ) {
      guard += 1;
      const nextPage = state.playlistLoadedThrough + 1;
      await loadPlaylistPage(nextPage, { replace: false });
    }
    if (!state.playlistItems.some(v => v.id === id)) {
      await ensurePlayingItemInPlaylist(id);
    }
  }

  function initPlayerPlaylistIfNeeded() {
    if (state.playlistSort === "random") {
      state.playlistItems = [];
      state.playlistScopeKey = "";
      state.playlistTotalPages = 1;
      state.playlistCanLoadMore = true;
      state.playlistLoadedThrough = 0;
      return;
    }
    if (!state.playlistItems.length || !playlistScopeMatches()) {
      resetPlayerPlaylistFromGrid();
      return;
    }
    state.playlistTotalPages = state.totalPages;
    const pageSize = getEffectivePageSize();
    state.playlistCanLoadMore = pageSize !== 0 && state.playlistLoadedThrough < state.playlistTotalPages;
  }

  function resetPlayerPlaylistFromGrid() {
    state.playlistItems = [...state.pageItems];
    state.playlistScopeKey = buildPlaylistScopeKey();
    updatePlaylistPagingMeta(state.page, state.totalPages);
  }

  function syncPlaylistItemFieldsFromPageItems() {
    const map = new Map(state.pageItems.map(v => [v.id, v]));
    state.playlistItems = state.playlistItems.map(v => (map.has(v.id) ? { ...v, ...map.get(v.id) } : v));
  }

  function syncPlayerPlaylistAfterGridReload() {
    if (!state.playerViewOpen) return;
    if (!playlistScopeMatches()) {
      resetPlayerPlaylistFromGrid();
      return;
    }
    syncPlaylistItemFieldsFromPageItems();
    state.playlistTotalPages = state.totalPages;
    const pageSize = getEffectivePageSize();
    state.playlistCanLoadMore = pageSize !== 0 && state.playlistLoadedThrough < state.playlistTotalPages;
  }

  function mergePlaylistItems(existing, incoming) {
    const seen = new Set(existing.map(v => v.id));
    const added = [];
    incoming.forEach(v => {
      if (seen.has(v.id)) return;
      seen.add(v.id);
      added.push(v);
    });
    return { merged: [...existing, ...added], added };
  }

  async function fetchPlaylistPage(pageNum) {
    const data = await api(`/api/videos?${buildPlaylistFetchParams(pageNum)}`);
    return data;
  }

  async function ensurePlayingItemInPlaylist(id) {
    if (!id || state.playlistItems.some(v => v.id === id)) return;
    let item = getItemById(id);
    if (!item) {
      try {
        item = await api(`/api/videos/${id}`);
      } catch (_) { /* ignore */ }
    }
    if (item) {
      state.playlistItems = [item, ...state.playlistItems.filter(v => v.id !== id)];
    }
  }

  async function loadPlaylistPage(pageNum, { replace = false } = {}) {
    const data = await fetchPlaylistPage(pageNum);
    if (replace) {
      state.playlistItems = data.items || [];
    } else {
      const { merged } = mergePlaylistItems(state.playlistItems, data.items || []);
      state.playlistItems = merged;
    }
    updatePlaylistPagingMeta(pageNum, data.totalPages || 1);
    state.playlistScopeKey = buildPlaylistScopeKey();
    return data;
  }

  async function loadMorePlaylist() {
    if (state.playlistLoading || !state.playlistCanLoadMore) return false;
    const pageSize = getEffectivePageSize();
    if (pageSize === 0) return false;
    state.playlistLoading = true;
    updatePlaylistFooterUi();
    try {
      const nextPage = state.playlistLoadedThrough + 1;
      await loadPlaylistPage(nextPage, { replace: false });
      renderPlayerPlaylist(true, { scrollToActive: false });
      bindPlaylistInfiniteScroll();
      return true;
    } catch (err) {
      console.warn("播放列表加载失败", err);
      return false;
    } finally {
      state.playlistLoading = false;
      updatePlaylistFooterUi();
    }
  }

  async function resetPlaylistForSortChange() {
    const keepId = state.playingId;
    state.playlistLoading = true;
    try {
      if (state.playlistSort === "page") {
        state.playlistItems = [...state.pageItems];
        updatePlaylistPagingMeta(state.page, state.totalPages);
        state.playlistScopeKey = buildPlaylistScopeKey();
        await ensurePlayingItemInPlaylist(keepId);
      } else {
        await loadPlaylistPage(1, { replace: true });
        await ensurePlayingItemInPlaylist(keepId);
      }
    } finally {
      state.playlistLoading = false;
    }
    renderPlayerPlaylist(true);
    bindPlaylistInfiniteScroll();
    prefetchPlaylistIfNeeded();
  }

  function prefetchPlaylistIfNeeded() {
    if (!state.playerViewOpen || !state.playlistCanLoadMore || state.playlistLoading) return;
    const now = Date.now();
    if (prefetchPlaylistIfNeeded._at && now - prefetchPlaylistIfNeeded._at < 5000) return;
    const list = getPlaylistItems();
    const idx = state.playingId ? list.findIndex(v => v.id === state.playingId) : -1;
    if (idx < 0) return;
    if (list.length - idx <= 3) {
      prefetchPlaylistIfNeeded._at = now;
      void loadMorePlaylist();
    }
  }

  function getPlaylistItems() {
    return state.playlistItems;
  }

  function syncPlaylistSortSelect() {
    const sel = $("#player-playlist-sort");
    if (sel && sel.value !== state.playlistSort) sel.value = state.playlistSort;
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
    return null;
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
    else if (isAlbumDetailView() && state.albumId) params.set("album_id", state.albumId);
    else {
      if (state.category) params.set("category", state.category);
      if (state.category && !state.query) params.set("folder", state.folder || "");
    }
    if (state.query) params.set("q", state.query);
    params.set("sort", state.sort);
    if (state.sort === "random" && state.randomSeed != null) {
      params.set("seed", String(state.randomSeed));
    }
    if (state.formatFilter) params.set("format", state.formatFilter);
    params.set("page", String(state.page));
    params.set("page_size", String(getEffectivePageSize()));
    return params;
  }

  function thumbsNeedRefresh(items) {
    if (pageThumbsNeedPolling(items)) return true;
    return items.some(v => {
      const wrap = document.getElementById(`thumb-${v.id}`);
      return wrap && wrap.dataset.thumbSig !== thumbSig(v);
    });
  }

  function findPlayerPlaylistThumbWrap(id) {
    if (!state.playerViewOpen) return null;
    return $("#player-playlist")?.querySelector(`.player-pl-item[data-id="${id}"] .player-pl-thumb`) || null;
  }

  function markThumbsRegenerating(ids, position) {
    const bust = `${Date.now()}_${position}`;
    ids.forEach(id => {
      state.thumbBust[id] = bust;
      const item = getItemById(id);
      const stub = {
        id,
        title: item?.title || "",
        thumbReady: false,
        thumbStatus: "queued",
      };
      if (item) {
        item.thumbReady = false;
        item.thumbStatus = "queued";
        item.thumbVersion = "";
      }
      const gridWrap = document.getElementById(`thumb-${id}`);
      if (gridWrap) applyThumbToWrap(gridWrap, stub);
      const plWrap = findPlayerPlaylistThumbWrap(id);
      if (plWrap) applyThumbToWrap(plWrap, stub);
    });
  }

  const FORMAT_FILTER_LABELS = {
    remuxable: "多段交错·可修复",
    transcode: "需转码",
    hls: "HLS 边切",
    interleaved: "多段交错",
    disguised: "伪装格式",
    moov_end: "索引在末尾",
    large: "大文件",
    fragmented: "碎片化",
    unsupported: "无法播放",
    non_standard: "任意非标准",
  };

  function formatFilterLabel(key) {
    return FORMAT_FILTER_LABELS[key] || key || "";
  }

  let formatScanTimer = null;
  let lastFormatIndexed = 0;

  async function requestFormatScan() {
    try {
      const st = await api("/api/format/scan", { method: "POST" });
      state.formatIndexStatus = st;
      lastFormatIndexed = st.indexed ?? 0;
    } catch (_) { /* ignore */ }
  }

  function stopFormatScanPoll() {
    clearInterval(formatScanTimer);
    formatScanTimer = null;
  }

  function startFormatScanPoll() {
    stopFormatScanPoll();
    if (!state.formatFilter) return;
    const tick = async () => {
      try {
        const st = await api("/api/format/status");
        state.formatIndexStatus = st;
        if (st.indexed !== lastFormatIndexed) {
          lastFormatIndexed = st.indexed;
          refreshGalleryStatus();
        }
        if (st.ready) {
          stopFormatScanPoll();
        }
      } catch (_) { /* ignore */ }
    };
    void tick();
    formatScanTimer = setInterval(tick, 5000);
  }

  function formatIndexHint() {
    if (!state.formatFilter || !state.formatIndexStatus) return "";
    const st = state.formatIndexStatus;
    if (st.ready) return "";
    if (st.pending > 0) {
      return ` · 格式索引 ${st.indexed}/${st.total}`;
    }
    return "";
  }

  const FORMAT_BADGE_META = {
    remuxable: {
      label: "多段交错·可修复",
      title: "多段 mdat 交错，可流复制修复为标准格式（不重新编码）",
      cls: "thumb-format-badge--remuxable",
    },
    transcode: {
      label: "需转码",
      title: "浏览器不支持的编码，播放时将转码",
      cls: "thumb-format-badge--transcode",
    },
    hls: {
      label: "HLS",
      title: "边切边播（HLS copy）",
      cls: "thumb-format-badge--hls",
    },
    interleaved: {
      label: "多段交错",
      title: "多段 mdat 交错（AV1/HEVC/VP9 等）；播放方式随设置自动选择直连或转码",
      cls: "thumb-format-badge--interleaved",
    },
    disguised: {
      label: "伪装",
      title: "站点伪装格式（如 PNG 头 + MPEG-TS）",
      cls: "thumb-format-badge--disguised",
    },
    moov_end: {
      label: "索引末尾",
      title: "moov 索引在文件末尾，起播可能较慢",
      cls: "thumb-format-badge--moov-end",
    },
    large: {
      label: "大文件",
      title: "大体积文件，边切边播以加快起播",
      cls: "thumb-format-badge--large",
    },
    fragmented: {
      label: "碎片化",
      title: "碎片化 MP4，浏览器无法直连",
      cls: "thumb-format-badge--fragmented",
    },
    unsupported: {
      label: "无法播放",
      title: "浏览器无法播放此格式",
      cls: "thumb-format-badge--unsupported",
    },
  };

  const VIDEO_FILE_EXT_RE = /\.(mp4|m4v|mov|wmv|avi|mkv|webm|ts|m2ts|flv|mpg|mpeg)$/i;

  function formatDuration(sec) {
    if (sec == null || !Number.isFinite(sec) || sec <= 0) return "";
    const total = Math.round(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function videoDurationSec(v) {
    const d = v?.durationSec ?? v?.playDuration;
    return d != null && Number.isFinite(d) && d > 0 ? d : null;
  }

  function thumbDurationHtml(v) {
    const label = formatDuration(videoDurationSec(v));
    if (!label) return "";
    return `<span class="thumb-duration">${esc(label)}</span>`;
  }

  function thumbOverlaysHtml(v) {
    return `${thumbFormatBadgeHtml(v)}${thumbDurationHtml(v)}`;
  }

  function thumbOverlaysEnabled(wrap, opts = null) {
    if (opts && opts.showOverlays === false) return false;
    return !wrap?.classList?.contains("player-pl-thumb");
  }

  function patchThumbOverlays(wrap, v) {
    if (!wrap || !v || !thumbOverlaysEnabled(wrap)) return;
    const badgeHtml = thumbFormatBadgeHtml(v);
    let badge = wrap.querySelector(".thumb-format-badge");
    if (badgeHtml) {
      if (badge) badge.outerHTML = badgeHtml;
      else wrap.insertAdjacentHTML("beforeend", badgeHtml);
    } else if (badge) {
      badge.remove();
    }
    const durHtml = thumbDurationHtml(v);
    let dur = wrap.querySelector(".thumb-duration");
    if (durHtml) {
      if (dur) dur.outerHTML = durHtml;
      else wrap.insertAdjacentHTML("beforeend", durHtml);
    } else if (dur) {
      dur.remove();
    }
  }

  function refreshGalleryStatus() {
    const { totalPages, page, total } = getPaged();
    $("#status").textContent = statusLabel(total, page, totalPages);
  }

  function thumbFormatBadgeHtml(v) {
    if (v.remuxedOnPage) {
      return '<span class="thumb-format-badge thumb-format-badge--fixed" title="已修复为标准 MP4，翻页或刷新后从列表移除">已修复</span>';
    }
    const meta = FORMAT_BADGE_META[v.formatBadge];
    if (!meta) return "";
    return `<span class="thumb-format-badge ${meta.cls}" title="${esc(meta.title)}">${esc(meta.label)}</span>`;
  }

  function renderThumbHtml(v, index = 99, opts = null) {
    const wrap = opts?.wrap || null;
    const overlays = thumbOverlaysEnabled(wrap, opts) ? thumbOverlaysHtml(v) : "";
    if (v.thumbStatus === "failed") {
      const hint = v.thumbError || "缩略图失败";
      let label = "缩略图失败";
      if (hint.includes("图片")) label = "非视频文件";
      else if (hint.includes("分辨率")) label = "占位文件";
      return `<div class="thumb-placeholder failed" title="${esc(hint)}">${esc(label)}</div>${overlays}`;
    }
    const bust = thumbCacheKey(v);
    return `<img src="${libThumbUrl(v.id, bust)}" alt="${esc(v.title)}">${overlays}`;
  }

  let formatBadgePollTimer = null;
  let durationPollTimer = null;

  function pageItemsMissingDuration(items = state.pageItems) {
    return items.filter(v =>
      !videoDurationSec(v) && VIDEO_FILE_EXT_RE.test(v.filename || v.title || "")
    );
  }

  function patchGridDurations() {
    state.pageItems.forEach(v => {
      const wrap = document.getElementById(`thumb-${v.id}`);
      if (wrap) patchThumbOverlays(wrap, v);
    });
    patchPlaylistMeta();
  }

  function playlistMetaSubline(v) {
    const dur = formatDuration(videoDurationSec(v));
    const name = v.filename || "";
    if (dur) {
      return `<span class="player-pl-dur">${esc(dur)}</span><span class="player-pl-sep"> · </span><span class="player-pl-file">${esc(name)}</span>`;
    }
    return `<span class="player-pl-file">${esc(name)}</span>`;
  }

  function patchPlaylistMeta() {
    state.playlistItems?.forEach(v => {
      const row = document.querySelector(`.player-pl-item[data-id="${CSS.escape(v.id)}"]`);
      const sub = row?.querySelector(".player-pl-sub");
      if (sub) sub.innerHTML = playlistMetaSubline(v);
    });
  }

  function scheduleDurationPoll() {
    clearTimeout(durationPollTimer);
    void refreshDurationStatus();
    const tick = async () => {
      const need = pageItemsMissingDuration();
      if (need.length) {
        const ids = need.map(v => v.id).slice(0, 64);
        try {
          const data = await api(`/api/durations?ids=${ids.join(",")}`);
          let changed = false;
          const applyDur = (item, sec) => {
            if (!item || item.durationSec === sec) return;
            item.durationSec = sec;
            changed = true;
          };
          Object.entries(data.durations || {}).forEach(([id, sec]) => {
            const n = Number(sec);
            if (!Number.isFinite(n) || n <= 0) return;
            applyDur(state.pageItems.find(v => v.id === id), n);
            applyDur(state.playlistItems?.find(v => v.id === id), n);
          });
          if (changed) {
            patchGridDurations();
            await refreshDurationStatus();
            if (pathTipAnchor) {
              const tipId = pathTipAnchorItemId(pathTipAnchor);
              const tipItem = tipId ? getItemById(tipId) : null;
              if (tipItem && videoDurationSec(tipItem)) {
                showPathTip(pathTipAnchor, tipItem);
              }
            }
          }
        } catch (_) { /* ignore */ }
      }

      if (need.length || isDurationWorkActive(lastDurationStatus)) {
        durationPollTimer = setTimeout(tick, 2000);
      }
    };
    durationPollTimer = setTimeout(tick, 600);
  }

  function patchCardFormatBadge(id) {
    const item = getItemById(id);
    const wrap = document.getElementById(`thumb-${id}`);
    if (!item || !wrap) return;
    patchThumbOverlays(wrap, item);
  }

  function markCardRemuxed(id) {
    const item = getItemById(id);
    if (item) {
      item.formatBadge = null;
      item.remuxedOnPage = true;
    }
    const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    card?.classList.add("card-remuxed");
    patchCardFormatBadge(id);
    refreshGalleryStatus();
  }

  function patchGridFormatBadges() {
    state.pageItems.forEach(v => {
      const wrap = document.getElementById(`thumb-${v.id}`);
      if (!wrap) return;
      patchThumbOverlays(wrap, v);
    });
  }

  function scheduleFormatBadgePoll() {
    clearTimeout(formatBadgePollTimer);
    if (pageThumbsPending(state.pageItems)) return;
    let left = 8;
    const tick = async () => {
      const need = state.pageItems
        .filter(v => !v.formatBadge && VIDEO_FILE_EXT_RE.test(v.filename || v.title || ""))
        .map(v => v.id);
      if (!need.length || left <= 0) return;
      left -= 1;
      try {
        const data = await api(`/api/play/badges?ids=${need.join(",")}`);
        let changed = false;
        Object.entries(data.badges || {}).forEach(([id, badge]) => {
          const item = state.pageItems.find(v => v.id === id);
          if (item && item.formatBadge !== badge) {
            item.formatBadge = badge;
            changed = true;
          }
        });
        if (changed) patchGridFormatBadges();
        if (need.some(id => !(data.badges || {})[id]) && left > 0) {
          formatBadgePollTimer = setTimeout(tick, 2500);
        }
      } catch (_) {
        if (left > 0) formatBadgePollTimer = setTimeout(tick, 2500);
      }
    };
    formatBadgePollTimer = setTimeout(tick, 3000);
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
      const src = libThumbUrl(v.id, key);
      const img = wrap.querySelector("img");
      if (img) {
        if (img.dataset.thumbV !== key) {
          img.dataset.thumbV = key;
          img.src = src;
        }
        if (v.title) img.alt = v.title;
        bindThumbImgError(img, v);
        patchThumbOverlays(wrap, v);
        wrap.dataset.thumbSig = sig;
        wrap.closest(".card")?.classList.toggle("card-failed", false);
        return;
      }
    }

    wrap.innerHTML = renderThumbHtml(v, 99, { wrap });
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

  function updatePlayerFavoriteButton(itemOrId) {
    const btn = $("#btn-player-favorite");
    if (!btn) return;
    const id = typeof itemOrId === "string" ? itemOrId : itemOrId?.id;
    const item = typeof itemOrId === "object" && itemOrId ? itemOrId : (id ? getItemById(id) : null);
    const favorited = !!item?.favorited;
    btn.classList.toggle("on", favorited);
    btn.textContent = favorited ? "♥ 已收藏" : "♡ 收藏";
    btn.title = favorited ? "取消收藏" : "加入收藏";
    btn.setAttribute("aria-label", favorited ? "取消收藏" : "加入收藏");
    btn.setAttribute("aria-pressed", favorited ? "true" : "false");
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
      if (state.playerViewOpen && state.playingId === id) {
        updatePlayerFavoriteButton(item || { id, favorited: r.favorited });
      }
      if (state.viewMode === "favorites" && !r.favorited) {
        await loadVideos({ forceRebuild: true });
      }
      const title = itemDisplayTitle(id);
      showToast(
        r.favorited ? `已收藏「${title}」` : `已取消收藏「${title}」`,
        { type: r.favorited ? "success" : "info" }
      );
    } catch (err) {
      showToast("收藏操作失败: " + err.message, { type: "error", duration: 4500 });
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
      const n = ids.length;
      showToast(
        action === "add" ? `已收藏 ${n} 个视频` : `已取消收藏 ${n} 个视频`,
        { type: action === "add" ? "success" : "info" }
      );
    } catch (err) {
      showToast("批量收藏失败: " + err.message, { type: "error", duration: 4500 });
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
      if (e.target.closest(".card-check") || e.target.closest(".card-fav") || e.target.closest(".card-album-badge")) return;
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
    const albumBtn = card.querySelector(".card-album-badge");
    albumBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      openAlbumPicker([id]);
    });
    updateCardAlbum(card, item);
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
      updateCardAlbum(card, v);
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

  let videosLoadSeq = 0;

  async function loadVideos({ forceRebuild = false, keepPlayerOpen = false } = {}) {
    if (isAlbumListView()) {
      await loadAlbums();
      return;
    }
    updateGalleryPanels();
    if (!forceRebuild && !keepPlayerOpen && playbackInProgress()) return;
    if (state.playerViewOpen && !keepPlayerOpen) await hideHtml5Player();
    const params = buildVideosParams();
    const reqId = ++videosLoadSeq;
    stopThumbPagePoll();
    clearTimeout(pageThumbWorkTimer);
    clearThumbRetryTimers();
    thumbRefreshSeq += 1;
    lastThumbRefreshAt = 0;
    hidePathTip();

    let data;
    try {
      data = await api(`/api/videos?${params}`);
    } catch (err) {
      if (reqId !== videosLoadSeq) return;
      $("#status").textContent = `加载失败: ${err.message}`;
      return;
    }
    if (reqId !== videosLoadSeq) return;
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
      schedulePageThumbWork(reqId);
      updateUrl();
      saveState();
      updateSelectionBar();
      updatePageSelectAll();
      syncPlayerPlaylistAfterGridReload();
      renderPlayerPlaylist();
      highlightPlayingCard();
      scheduleFormatBadgePoll();
      scheduleDurationPoll();
      markGridJustLoaded();
      if (state.pageSize === "auto") {
        lastAutoPageSize = getEffectivePageSize();
        reconcileAutoPageSizeAfterRender();
      }
      return;
    }

    grid.innerHTML = items.map((v, idx) => {
      const checked = state.selected.has(v.id) ? "checked" : "";
      const selected = state.selected.has(v.id) ? "selected" : "";
      const failed = v.thumbStatus === "failed" ? "card-failed" : "";
      const favOn = v.favorited ? "on" : "";
      const inAlbum = (v.albumIds?.length || 0) > 0 ? "in-album" : "";
      return `
        <div class="card ${selected} ${failed} ${inAlbum}" data-id="${v.id}">
          <div class="thumb-wrap" id="thumb-${v.id}">${renderThumbHtml(v, idx)}${cardAlbumBadgeHtml(v)}</div>
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

    schedulePageThumbWork(reqId);

    updateUrl(true);
    saveState();
    updateSelectionBar();
    updatePageSelectAll();
    syncPlayerPlaylistAfterGridReload();
    renderPlayerPlaylist();
    highlightPlayingCard();
    scheduleFormatBadgePoll();
    scheduleDurationPoll();
    markGridJustLoaded();
    if (state.pageSize === "auto") {
      lastAutoPageSize = getEffectivePageSize();
      reconcileAutoPageSizeAfterRender();
    }
    updateAlbumToolbar();
  }

  let _urlPushEnabled = false;
  let _popstateDepth = 0;
  function updateUrl(push) {
    const applyPlay = (params) => {
      if (state.playerViewOpen && state.playingId) {
        params.set("play", state.playingId);
      }
      const qs = params.toString();
      const url = qs ? `/?${qs}` : "/";
      if (push && _urlPushEnabled && _popstateDepth === 0) {
        history.pushState(null, "", url);
      } else {
        history.replaceState(null, "", url);
      }
    };

    if (state.viewMode === "favorites") {
      const params = new URLSearchParams();
      params.set("view", "favorites");
      applyPlay(params);
      return;
    }
    if (state.viewMode === "history") {
      const params = new URLSearchParams();
      params.set("view", "history");
      applyPlay(params);
      return;
    }
    if (isAlbumListView()) {
      const params = new URLSearchParams();
      params.set("view", "albums");
      applyPlay(params);
      return;
    }
    if (isAlbumDetailView() && state.albumId) {
      const params = new URLSearchParams();
      params.set("view", "album");
      params.set("album_id", state.albumId);
      if (state.page > 1) params.set("page", state.page);
      applyPlay(params);
      return;
    }
    if (isBrowseHome()) {
      const params = new URLSearchParams();
      if (state.pageSize !== 0 && state.pageSize !== 40) {
        params.set("size", String(state.pageSize));
      }
      applyPlay(params);
      return;
    }
    const params = new URLSearchParams();
    if (state.libraryId) params.set("lib", state.libraryId);
    if (state.category) params.set("category", state.category);
    if (state.folder && !state.query) params.set("folder", state.folder);
    if (state.query) params.set("q", state.query);
    if (state.page > 1) params.set("page", state.page);
    if (state.pageSize === "auto") state.pageSize = 40;
    if (state.pageSize !== 0 && state.pageSize !== 40) params.set("size", String(state.pageSize));
    applyPlay(params);
  }

  function parseUrl() {
    const params = new URLSearchParams(location.search);
    const view = params.get("view");
    if (view === "favorites") {
      state.viewMode = "favorites";
      state.category = "";
      state.folder = "";
      state.albumId = "";
      state.currentAlbum = null;
    } else if (view === "history") {
      state.viewMode = "history";
      state.category = "";
      state.folder = "";
      state.albumId = "";
      state.currentAlbum = null;
    } else if (view === "albums") {
      state.viewMode = "albums";
      state.category = "";
      state.folder = "";
      state.albumId = "";
      state.currentAlbum = null;
    } else if (view === "album") {
      state.viewMode = "album-detail";
      state.category = "";
      state.folder = "";
      state.albumId = params.get("album_id") || "";
    } else {
      state.viewMode = "browse";
      state.albumId = "";
      state.currentAlbum = null;
    }
    if (params.has("lib")) state.libraryId = params.get("lib");
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
    if (params.has("size")) {
      const s = params.get("size");
      state.pageSize = s === "auto" ? 40 : (parseInt(s, 10) || 40);
    }
    if (params.has("play")) {
      state.pendingRestorePlayId = params.get("play");
    }
  }

  async function tryRestorePlayback() {
    const id = state.pendingRestorePlayId;
    if (!id) return;
    state.pendingRestorePlayId = null;
    try {
      await playVideo(id);
    } catch (_) { /* 留在列表 */ }
  }

  function scheduleThumbRefresh(id) {
    if (thumbRetryTimers[id]) return;
    thumbRetryTimers[id] = setTimeout(async () => {
      delete thumbRetryTimers[id];
      const pending = await refreshThumbById(id);
      if (pending) scheduleThumbRefresh(id);
    }, 3000);
  }

  async function refreshThumbById(id) {
    const gridWrap = document.getElementById(`thumb-${id}`);
    const plWrap = findPlayerPlaylistThumbWrap(id);
    if (!gridWrap && !plWrap) return false;
    try {
      const v = await api(`/api/videos/${encodeURIComponent(id)}`);
      const pageIdx = state.pageItems.findIndex(x => x.id === id);
      if (pageIdx >= 0) state.pageItems[pageIdx] = { ...state.pageItems[pageIdx], ...v };
      const plIdx = state.playlistItems.findIndex(x => x.id === id);
      if (plIdx >= 0) state.playlistItems[plIdx] = { ...state.playlistItems[plIdx], ...v };
      if (gridWrap) {
        applyThumbToWrap(gridWrap, v);
        const card = gridWrap.closest(".card");
        if (card) card.classList.toggle("card-failed", v.thumbStatus === "failed");
      }
      if (plWrap) applyThumbToWrap(plWrap, v);
      if (v.thumbReady) delete state.thumbBust[id];
      syncThumbProgressUi();
      return !v.thumbReady && v.thumbStatus !== "failed";
    } catch (_) {
      return true;
    }
  }

  async function refreshVisibleThumbs() {
    const now = Date.now();
    if (now - lastThumbRefreshAt < 3000) return;
    const reqId = thumbRefreshSeq;
    const { items } = getPaged();
    if (!items.length) return;

    const targets = items.filter(v => {
      if (v.thumbStatus === "generating" || v.thumbStatus === "queued") return true;
      if (!v.thumbReady && v.thumbStatus !== "failed") return true;
      const wrap = document.getElementById(`thumb-${v.id}`);
      return wrap && wrap.dataset.thumbSig !== thumbSig(v);
    }).slice(0, 6);
    if (!targets.length) return;

    lastThumbRefreshAt = now;
    const results = await Promise.all(targets.map(v => refreshThumbById(v.id)));
    if (reqId !== thumbRefreshSeq) return;
    targets.forEach((v, i) => {
      if (results[i] && !thumbRetryTimers[v.id]) scheduleThumbRefresh(v.id);
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
      el.innerHTML = '<p class="text-sm text-muted">暂无失败项</p>';
      return;
    }
    el.innerHTML = state.failedItems.map(item => `
      <div class="failed-item" data-id="${escAttr(item.id)}">
        <div class="failed-item-main min-w-0">
          <p class="text-sm font-medium text-primary">${esc(item.filename || item.title)}</p>
          <p class="failed-item-path" title="点击选中路径">${esc(item.path || "(无路径)")}</p>
          <p class="failed-item-meta text-xs text-muted">${esc(item.category || "")}${item.subfolder ? " / " + esc(item.subfolder) : ""}</p>
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
    await hideHtml5Player();
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

  function markGridJustLoaded() {
    gridJustLoaded = true;
    setTimeout(() => { gridJustLoaded = false; }, 1500);
  }

  function scheduleLoadProgress(delay = 1200) {
    clearTimeout(progressDebounceTimer);
    progressDebounceTimer = setTimeout(() => void loadProgress(), Math.max(delay, 200));
  }

  function startProgressPolling(ms) {
    if (progressTimer) clearInterval(progressTimer);
    progressPollMs = Math.max(ms, 8000);
    progressTimer = setInterval(() => scheduleLoadProgress(1200), progressPollMs);
  }

  async function loadProgress() {
    if (loadProgressInFlight) {
      loadProgressPending = true;
      return;
    }
    loadProgressInFlight = true;
    try {
      const global = await api("/api/thumb/status");
      await refreshDurationStatus();
      const page = state.pageItems.length ? computePageThumbStats(state.pageItems) : null;

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
      const pageThumbWork = page
        ? ((page.generating ?? 0) > 0 || (page.queued ?? 0) > 0)
        : false;
      const pageNeedsThumbs = thumbsNeedRefresh(state.pageItems);
      if (progressSig !== lastProgressSig) {
        lastProgressSig = progressSig;
        if (!gridJustLoaded && (pageThumbWork || pageNeedsThumbs)) {
          void refreshVisibleThumbs();
        }
      }

      const thumbWorkActive = ((global.generating ?? 0) > 0 || (global.queue_size ?? 0) > 0);
      const pagePending = pageThumbsPending(state.pageItems);
      const durationBusy = !isDurationProgressIdle(lastDurationStatus);
      const allIdle = !thumbWorkActive && !pageThumbWork && !pagePending && !pageNeedsThumbs && failCount === 0 && !durationBusy;
      const nextPoll = allIdle ? 30000 : (idleOn ? 8000 : 12000);
      if (nextPoll !== progressPollMs) {
        startProgressPolling(nextPoll);
      }

      lastThumbProgressGlobal = global;
      updateProgressBarVisibility(global, lastDurationStatus);
    } catch (e) {
      $("#progress-text").textContent = "缩略图: 状态获取失败";
      updateProgressBarVisibility(lastThumbProgressGlobal, lastDurationStatus);
    } finally {
      loadProgressInFlight = false;
      if (loadProgressPending) {
        loadProgressPending = false;
        scheduleLoadProgress(1500);
      }
    }
  }

  async function loadPlayerSettings() {
    try {
      const s = await api("/api/settings");
      state.playerMode = normalizePlayerMode(s.player_mode);
      state.playlistAutoplay = s.html5_playlist_autoplay !== false;
      state.resumePlayback = s.html5_resume_playback !== false;
      state.wheelSeekSec = normalizeWheelSeekSec(s.html5_wheel_seek_sec ?? SETTINGS_DEFAULTS.html5_wheel_seek_sec);
      state.thumbProgressBar = normalizeThumbProgressBar(s.thumb_progress_bar);
      state.thumbAutoSelectBest = s.thumb_auto_select_best !== false;
      state.thumbBatchAutoSelect = s.thumb_batch_auto_select !== false;
      applyPlayerHotkeySettings(s);
      const theme = resolveTheme(s);
      applyTheme(theme, { persistLocal: true });
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
  let playlistScrollObserver = null;

  function playlistItemRowHtml(v) {
    return `
      <button type="button" class="player-pl-item w-full ${v.id === state.playingId ? "active" : ""}" data-id="${escAttr(v.id)}">
        <div class="player-pl-thumb">${renderThumbHtml(v, 99, { showOverlays: false })}</div>
        <div class="player-pl-meta min-w-0">
          <p class="player-pl-title truncate text-sm font-medium">${esc(v.title || v.filename)}</p>
          <p class="player-pl-sub truncate text-xs text-muted">${playlistMetaSubline(v)}</p>
        </div>
      </button>`;
  }

  function playlistFooterHtml() {
    const pageSize = getEffectivePageSize();
    const items = getPlaylistItems();
    if (!items.length) return "";
    if (pageSize === 0) {
      return `<p class="player-pl-footer-hint">共 ${items.length} 个（已全部加载）</p>`;
    }
    if (!state.playlistCanLoadMore) {
      const tp = state.playlistTotalPages || 1;
      const through = state.playlistLoadedThrough || 1;
      return `<p class="player-pl-footer-hint">已加载 ${through} / ${tp} 页</p>`;
    }
    const nextPage = (state.playlistLoadedThrough || 1) + 1;
    const tp = state.playlistTotalPages || 1;
    const label = state.playlistLoading
      ? "加载中…"
      : `加载下一页（${nextPage} / ${tp}）`;
    return `
      <div class="player-pl-footer">
        <button type="button" class="player-pl-load-more ui-btn sm w-full" ${state.playlistLoading ? "disabled" : ""}>
          ${esc(label)}
        </button>
        <div id="player-playlist-sentinel" class="player-pl-sentinel" aria-hidden="true"></div>
      </div>`;
  }

  function updatePlaylistFooterUi() {
    const footer = $("#player-playlist")?.querySelector(".player-pl-footer, .player-pl-footer-hint");
    const wrap = $("#player-playlist");
    if (!wrap) return;
    const oldFooter = wrap.querySelector(".player-pl-footer, .player-pl-footer-hint");
    const html = playlistFooterHtml();
    if (oldFooter) oldFooter.outerHTML = html || "";
    else if (html) wrap.insertAdjacentHTML("beforeend", html);
    bindPlaylistInfiniteScroll();
  }

  function bindPlaylistInfiniteScroll() {
    playlistScrollObserver?.disconnect();
    playlistScrollObserver = null;
    const root = $("#player-playlist");
    const sentinel = $("#player-playlist-sentinel");
    if (!root || !sentinel || !state.playlistCanLoadMore) return;
    playlistScrollObserver = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) void loadMorePlaylist();
    }, { root, rootMargin: "64px", threshold: 0 });
    playlistScrollObserver.observe(sentinel);
  }

  function playlistRenderKey() {
    const items = getPlaylistItems();
    return `${state.playlistSort}\0${items.map(v => v.id).join("\0")}`;
  }

  function playlistItemIds() {
    return getPlaylistItems().map(v => v.id).join("\0");
  }

  function scrollPlaylistToActive() {
    const btn = $("#player-playlist")?.querySelector(`.player-pl-item[data-id="${state.playingId}"]`);
    btn?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function updatePlayerPlaylistActive() {
    $("#player-playlist")?.querySelectorAll(".player-pl-item").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.id === state.playingId);
    });
  }

  function syncPlayerPlaylistThumbs(items) {
    if (!state.playerViewOpen) return;
    const list = items || getPlaylistItems();
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

  function renderPlayerPlaylist(force = false, { scrollToActive = true } = {}) {
    const el = $("#player-playlist");
    if (!el) return;
    const savedScrollTop = scrollToActive ? 0 : el.scrollTop;
    syncPlaylistSortSelect();
    const items = getPlaylistItems();
    if (!items.length) {
      el.innerHTML = '<p class="px-2 py-4 text-center text-xs text-muted">当前列表无视频</p>';
      _playlistRenderedIds = "";
      playlistScrollObserver?.disconnect();
      return;
    }
    const ids = playlistRenderKey();
    if (!force && ids === _playlistRenderedIds && el.querySelector(".player-pl-item")) {
      updatePlayerPlaylistActive();
      if (scrollToActive) scrollPlaylistToActive();
      else el.scrollTop = savedScrollTop;
      updatePlaylistFooterUi();
      return;
    }
    _playlistRenderedIds = ids;
    el.innerHTML = items.map(v => playlistItemRowHtml(v)).join("") + playlistFooterHtml();
    el.querySelectorAll(".player-pl-thumb").forEach((wrap, i) => {
      const v = items[i];
      if (v) applyThumbToWrap(wrap, v);
    });
    if (scrollToActive) scrollPlaylistToActive();
    else el.scrollTop = savedScrollTop;
    bindPlaylistPathTips();
    bindPlaylistInfiniteScroll();
  }

  function destroyHlsPlayer() {
    if (hlsInstance) {
      try {
        hlsInstance.stopLoad();
        hlsInstance.detachMedia();
        hlsInstance.destroy();
      } catch (_) { /* ignore */ }
      hlsInstance = null;
    }
  }

  /** 会话已失效时停止切片并返回 true */
  async function abortIfStale(session) {
    if (session === state.playSession) return false;
    state.activeSliceVideoId = null;
    detachVideoStream(getPlaybackVideo(), { hard: true });
    await stopActiveSlice();
    return true;
  }

  /** 立即停止服务端 HLS 切片/转码进程（保留磁盘缓存） */
  async function stopActiveSlice() {
    clearHlsSliceThrottle();
    destroyHlsPlayer();
    state.activeSliceVideoId = null;
    detachVideoStream(getPlaybackVideo(), { hard: false });
    try {
      await api("/api/play/stop", { method: "POST" });
    } catch (_) { /* ignore */ }
  }

  function mediaBufferedAheadSec(video) {
    if (!video || !Number.isFinite(video.currentTime)) return 0;
    const t = video.currentTime;
    const buf = video.buffered;
    if (!buf?.length) return 0;
    for (let i = 0; i < buf.length; i += 1) {
      if (buf.start(i) <= t && t <= buf.end(i)) {
        return Math.max(0, buf.end(i) - t);
      }
    }
    if (t < buf.start(0)) {
      return Math.max(0, buf.end(0) - t);
    }
    return Math.max(0, buf.end(buf.length - 1) - t);
  }

  function clearHlsSliceThrottle() {
    if (sliceCatchupTimer) {
      clearTimeout(sliceCatchupTimer);
      sliceCatchupTimer = null;
    }
    if (!hlsSliceThrottle) return;
    const { timer, video, onTick, onSeeked, onStall } = hlsSliceThrottle;
    clearInterval(timer);
    if (video && onTick) {
      video.removeEventListener("timeupdate", onTick);
      video.removeEventListener("seeking", onTick);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("waiting", onStall);
    }
    hlsSliceThrottle = null;
  }

  function nudgeHlsPlaylist() {
    if (!hlsInstance) return;
    try {
      hlsInstance.startLoad(-1);
    } catch (_) { /* ignore */ }
  }

  async function postSliceCatchup(videoId, positionSec) {
    if (!videoId || !Number.isFinite(positionSec)) return;
    try {
      await api(`/api/play/catchup/${encodeURIComponent(videoId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position_sec: positionSec }),
      });
      nudgeHlsPlaylist();
    } catch (_) { /* ignore */ }
  }

  function scheduleSliceCatchup(videoId, positionSec, delayMs = 180) {
    clearTimeout(sliceCatchupTimer);
    sliceCatchupTimer = setTimeout(() => {
      sliceCatchupTimer = null;
      void postSliceCatchup(videoId, positionSec);
    }, delayMs);
  }

  async function tickHlsSliceThrottle({ afterSeek = false, forceResume = false } = {}) {
    const ctx = hlsSliceThrottle;
    if (!ctx) return;
    if (ctx.session !== state.playSession || state.activeSliceVideoId !== ctx.videoId) {
      clearHlsSliceThrottle();
      return;
    }
    if (ctx.inFlight) return;
    const video = getPlaybackVideo();
    if (!video) return;
    ctx.inFlight = true;
    try {
      const st = await api(`/api/play/status/${ctx.videoId}`);
      const segSec = st.segment_seconds || HLS_SLICE_SEGMENT_SEC_DEFAULT;
      const processing = !!st.processing && !st.cached;
      if (!processing) {
        clearHlsSliceThrottle();
        return;
      }
      const t = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const producedEnd = st.produced_end_sec ?? (st.segments || 0) * segSec;
      const producedAhead = Math.max(0, producedEnd - t);
      const paused = !!st.slice_paused;
      const nearEdge = producedAhead <= SLICE_EDGE_RESERVE_SEC;
      const runningLow = producedAhead <= SLICE_AHEAD_MIN_SEC;

      if (afterSeek || forceResume || nearEdge) {
        if (afterSeek || forceResume) {
          await postSliceCatchup(ctx.videoId, t);
        } else {
          scheduleSliceCatchup(ctx.videoId, t);
        }
      }

      if (!paused && producedAhead >= SLICE_AHEAD_MAX_SEC) {
        await api("/api/play/pause", { method: "POST" });
      } else if (paused && (runningLow || nearEdge || afterSeek || forceResume)) {
        await api("/api/play/resume", { method: "POST" });
      }
    } catch (_) { /* ignore */ }
    finally {
      ctx.inFlight = false;
    }
  }

  function bindHlsSliceThrottle(video, videoId, session) {
    clearHlsSliceThrottle();
    const onTick = () => { void tickHlsSliceThrottle(); };
    const onSeeked = () => {
      void tickHlsSliceThrottle({ afterSeek: true });
    };
    const onStall = () => {
      void tickHlsSliceThrottle({ forceResume: true });
    };
    hlsSliceThrottle = {
      videoId,
      session,
      video,
      onTick,
      onSeeked,
      onStall,
      inFlight: false,
      timer: setInterval(onTick, 1200),
    };
    video.addEventListener("timeupdate", onTick);
    video.addEventListener("seeking", onTick);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("waiting", onStall);
    onTick();
  }

  async function maybePauseSliceDuringPrep(st) {
    const segSec = st.segment_seconds || HLS_SLICE_SEGMENT_SEC_DEFAULT;
    if (!st.processing || st.cached) return;
    const produced = (st.segments || 0) * segSec;
    if (produced >= SLICE_AHEAD_MAX_SEC && !st.slice_paused) {
      await api("/api/play/pause", { method: "POST" });
    }
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

  async function cancelPlayback() {
    state.playSession += 1;
    pendingPlayId = null;
    hidePlayOverlay();
    const video = getPlaybackVideo();
    detachVideoStream(video, { hard: true });
    resetVideoDisplay(video);
    state.activeSliceVideoId = null;
    await stopActiveSlice();
    if (state.playerViewOpen) {
      state.playerViewOpen = false;
      syncGalleryLayout();
      state.playingId = null;
      state.playlistItems = [];
      state.playlistCanLoadMore = false;
      state.playlistLoadedThrough = 0;
      playlistScrollObserver?.disconnect();
      playlistScrollObserver = null;
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

  const RESUME_MIN_SEC = 15;
  const RESUME_END_MARGIN_SEC = 45;
  let playbackSaveTimer = null;

  function formatPlaybackTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  function getSavedPlaybackPosition(item) {
    if (!resumePlaybackEnabled()) return null;
    if (!item) return null;
    const pos = Number(item.playPosition);
    const dur = Number(item.playDuration);
    return normalizeResumePosition(pos, dur > 0 ? dur : null);
  }

  function normalizeResumePosition(pos, durationSec) {
    if (!Number.isFinite(pos) || pos < RESUME_MIN_SEC) return null;
    if (durationSec != null && durationSec > 0 && pos >= durationSec - RESUME_END_MARGIN_SEC) {
      return null;
    }
    return pos;
  }

  function applyLocalPlaybackPosition(item, positionSec, durationSec) {
    if (!item) return;
    if (positionSec != null && positionSec > 0) item.playPosition = positionSec;
    else item.playPosition = null;
    if (durationSec != null && durationSec > 0) item.playDuration = durationSec;
  }

  async function savePlaybackPosition(id, positionSec, durationSec) {
    if (!resumePlaybackEnabled()) return;
    const pos = Number(positionSec);
    if (!id || !Number.isFinite(pos) || pos < 1) return;
    const dur = durationSec != null && Number.isFinite(durationSec) ? durationSec : null;
    const keep = normalizeResumePosition(pos, dur);
    const savePos = keep != null ? pos : 0;
    applyLocalPlaybackPosition(getItemById(id), savePos > 0 ? savePos : null, dur);
    try {
      await api("/api/history/position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          position_sec: savePos,
          duration_sec: dur,
        }),
      });
    } catch (_) { /* ignore */ }
  }

  function scheduleSavePlaybackPosition(id, video) {
    if (!id || !video || !Number.isFinite(video.currentTime)) return;
    clearTimeout(playbackSaveTimer);
    playbackSaveTimer = setTimeout(() => {
      const dur = Number.isFinite(video.duration) ? video.duration : null;
      void savePlaybackPosition(id, video.currentTime, dur);
    }, 2500);
  }

  function unbindPlaybackProgressSaver() {
    clearTimeout(playbackSaveTimer);
    playbackSaveTimer = null;
    const video = getPlaybackVideo();
    if (!video?._playbackHandlers) return;
    const { onTimeupdate, onPause, onEnded } = video._playbackHandlers;
    video.removeEventListener("timeupdate", onTimeupdate);
    video.removeEventListener("pause", onPause);
    video.removeEventListener("ended", onEnded);
    delete video._playbackHandlers;
  }

  function bindPlaybackProgressSaver(video, id) {
    unbindPlaybackProgressSaver();
    if (!video || !id) return;
    const onTimeupdate = () => {
      scheduleSavePlaybackPosition(id, video);
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      const left = dur > 0 ? dur - video.currentTime : 0;
      if (left > 0 && left < 180) prefetchAdjacentPlayInfo(1);
    };
    const onPause = () => {
      if (Number.isFinite(video.currentTime) && video.currentTime >= 1) {
        const dur = Number.isFinite(video.duration) ? video.duration : null;
        void savePlaybackPosition(id, video.currentTime, dur);
      }
    };
    const onEnded = () => {
      const dur = Number.isFinite(video.duration) ? video.duration : null;
      void savePlaybackPosition(id, dur || video.currentTime, dur);
      void (async () => {
        detachVideoStream(getPlaybackVideo(), { hard: false });
        await stopActiveSlice();
        if (
          playlistAutoplayEnabled()
          && state.playerViewOpen
          && normalizePlayerMode(state.playerMode) === "html5"
        ) {
          await playAdjacentVideo(1);
        }
      })();
    };
    video.addEventListener("timeupdate", onTimeupdate);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video._playbackHandlers = { onTimeupdate, onPause, onEnded };
  }

  function resolveResumeStart(item, video) {
    const saved = getSavedPlaybackPosition(item);
    if (saved == null) return 0;
    const vd = Number.isFinite(video?.duration) ? video.duration : 0;
    if (vd > 0 && saved >= vd - 1) return 0;
    return saved;
  }

  function applyPlaybackResume(video, item) {
    if (!resumePlaybackEnabled()) return null;
    if (!video) return null;
    const target = resolveResumeStart(item, video);
    if (target <= 0) return null;
    try {
      video.currentTime = target;
    } catch (_) { /* ignore */ }
    return target;
  }

  async function seekToSavedPosition(video, item) {
    if (!resumePlaybackEnabled() || !video) return null;
    const target = resolveResumeStart(item, video);
    if (target <= 0) return null;
    try {
      video.currentTime = target;
    } catch (_) {
      return null;
    }
    await new Promise((resolve) => {
      if (Math.abs(video.currentTime - target) < 0.35) {
        resolve();
        return;
      }
      let timer;
      const onSeeked = () => {
        clearTimeout(timer);
        video.removeEventListener("seeked", onSeeked);
        resolve();
      };
      timer = setTimeout(() => {
        video.removeEventListener("seeked", onSeeked);
        resolve();
      }, 2500);
      video.addEventListener("seeked", onSeeked, { once: true });
    });
    return target;
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

  let playerWheelSeekLastAt = 0;

  function bindPlayerStageWheelSeek() {
    const stage = $("#player-stage");
    if (!stage || stage.dataset.wheelSeekBound) return;
    stage.dataset.wheelSeekBound = "1";
    stage.addEventListener("wheel", (e) => {
      if (!state.playerViewOpen) return;
      const stepSec = wheelSeekStepSec();
      if (!stepSec) return;
      const video = getPlaybackVideo();
      if (!video || video.parentElement !== stage) return;
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;

      e.preventDefault();
      const now = Date.now();
      if (now - playerWheelSeekLastAt < 120) return;
      if (!e.deltaY) return;

      playerWheelSeekLastAt = now;
      const step = e.deltaY > 0 ? stepSec : -stepSec;
      const dur = video.duration;
      let t = video.currentTime + step;
      if (!Number.isFinite(t)) return;
      t = Math.max(0, Math.min(dur, t));
      try {
        video.currentTime = t;
      } catch (_) { /* ignore */ }
    }, { passive: false });
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
      return { text: `伪装格式${mins}`, cls: "fmt-disguised" };
    }
    if (info.mode === "external") {
      return { text: `非标准 MP4${codec ? ` · ${codec}` : ""}`, cls: "fmt-fragmented" };
    }
    if (info.mode === "hls" && info.transcode) {
      return { text: `转码播放${codec ? ` · ${codec}` : ""}`, cls: "fmt-transcode" };
    }
    if (kind === "fragmented") {
      const interleaved = (info.structure?.mdat_count || 0) > 3;
      return {
        text: interleaved
          ? `多段交错 MP4${codec ? ` · ${codec}` : ""}`
          : `碎片化 MP4${codec ? ` · ${codec}` : ""}`,
        cls: "fmt-fragmented",
      };
    }
    if (kind === "moov_end") {
      return { text: `索引在末尾${codec ? ` · ${codec}` : ""}`, cls: "fmt-moov-end" };
    }
    if (info.mode === "hls") {
      if (info.transcode) {
        return { text: `转码播放${codec ? ` · ${codec}` : ""}`, cls: "fmt-large" };
      }
      return { text: `边切边播${codec ? ` · ${codec}` : ""}`, cls: "fmt-large" };
    }
    if (info.mode === "direct") {
      if (info.experimental_direct) {
        return { text: `实验直连${codec ? ` · ${codec}` : ""}`, cls: "fmt-experimental" };
      }
      const std =
        info.structure?.kind === "standard" ||
        (info.reason && /H\.264 MP4|直接播放/.test(info.reason));
      return {
        text: std ? `标准格式${codec ? ` · ${codec}` : ""}` : `尝试直连${codec ? ` · ${codec}` : ""}`,
        cls: std ? "fmt-standard" : "",
      };
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
    if (info.experimental_direct) return "实验直连";
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

  function syncGalleryLayout() {
    const inPlayer = !!state.playerViewOpen;
    $("#gallery-toolbar")?.classList.toggle("hidden", inPlayer);
    $("#gallery-view")?.classList.toggle("hidden", inPlayer);
    const view = $("#player-view");
    if (view) {
      view.classList.toggle("hidden", !inPlayer);
      view.classList.toggle("flex", inPlayer);
    }
  }

  function openPlayerView(item, { scrollToActive = true } = {}) {
    if (!item?.id) return;
    const entering = !state.playerViewOpen;
    state.playingId = item.id;
    state.playerViewOpen = true;
    syncGalleryLayout();
    mountVideoToPlayer();
    const title = item.title || item.filename || item.id;
    setPlayerHeaderTitle(title);
    const pathEl = $("#player-path");
    if (pathEl) {
      pathEl.textContent = item.path || "";
      pathEl.title = item.path || "";
    }

    const finishOpen = () => {
      renderPlayerPlaylist(true, { scrollToActive });
      highlightPlayingCard();
      updatePlayerFavoriteButton(item);
      updatePlayerAlbumButton(item);
      updateUrl(true);
      bindPlaylistInfiniteScroll();
    };

    initPlayerPlaylistIfNeeded();

    if (!entering && state.playlistItems.some(v => v.id === item.id)) {
      renderPlayerPlaylist(false);
      updatePlayerPlaylistActive();
      if (scrollToActive) scrollPlaylistToActive();
      highlightPlayingCard();
      updatePlayerFavoriteButton(item);
      updatePlayerAlbumButton(item);
      updateUrl();
      bindPlaylistInfiniteScroll();
      return;
    }

    void ensurePlaylistCoversId(item.id).then(finishOpen);
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
    if (video) bindPlaybackProgressSaver(video, item.id);
    updateMediaSession(item);
    prefetchPlaylistIfNeeded();
    prefetchAdjacentPlayInfo(1);
  }

  function updateMediaSession(item) {
    if (!navigator.mediaSession || !item) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.title || item.filename || "视频",
        artist: item.category || "Loc Gallery",
        album: "Loc Gallery",
      });
      navigator.mediaSession.setActionHandler("previoustrack", () => {
        void playAdjacentVideo(-1);
      });
      navigator.mediaSession.setActionHandler("nexttrack", () => {
        void playAdjacentVideo(1);
      });
    } catch (_) { /* ignore */ }
  }

  function clearMediaSession() {
    if (!navigator.mediaSession) return;
    try {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
    } catch (_) { /* ignore */ }
  }

  function handlePlayerNavKey(e) {
    if (!state.playerViewOpen || e.target.matches("input, select, textarea")) return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (keyEventMatchesHotkey(e, state.playerPrevKey)) {
      e.preventDefault();
      void playAdjacentVideo(-1);
      return true;
    }
    if (keyEventMatchesHotkey(e, state.playerNextKey)) {
      e.preventDefault();
      void playAdjacentVideo(1);
      return true;
    }
    return false;
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
      tickTimer = setInterval(() => {
        if (session !== state.playSession) {
          cleanup();
          reject(new Error("已取消"));
          return;
        }
        onProgressEvt();
      }, 500);
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
    let video = getPlaybackVideo();
    if (!video) return;
    resetVideoDisplay(video);
    mountVideoToPlayer();
    detachVideoStream(video);
    video = getPlaybackVideo();
    if (!video) return;
    video.preload = "metadata";
    const libQ = state.libraryId ? `?library_id=${encodeURIComponent(state.libraryId)}` : "";
    video.src = `/api/stream/${id}${libQ}`;
    const moovEnd = info?.structure?.kind === "moov_end";
    const sizeBytes = info?.structure?.size_bytes || 0;
    const sizeHint = sizeBytes ? formatSize(sizeBytes) : "";
    const largeHint = sizeBytes >= 300 * 1024 * 1024 ? " · 大文件可用 PotPlayer 更流畅" : "";
    updatePlayOverlay(
      "加载视频",
      moovEnd
        ? `索引在文件末尾${sizeHint ? ` · 约 ${sizeHint}` : ""}，正在拉取…${largeHint}`
        : `正在缓冲${sizeHint ? ` · 文件约 ${sizeHint}` : ""}…${largeHint}`,
      { indeterminate: true },
    );
    await waitCanPlay(video, session, moovEnd ? 180000 : 90000, (ratio) => {
      updatePlayOverlay(null, `已缓冲 ${Math.round(ratio * 100)}%`, { progress: ratio * 100 });
    });
    if (await abortIfStale(session)) return;
    updatePlayOverlay("即将播放", "正在启动播放器…", { progress: 95 });
    const resumed = await seekToSavedPosition(video, item);
    if (resumed != null) setPlayerStatus(`从 ${formatPlaybackTime(resumed)} 继续播放`);
    await video.play().catch(() => {});
    await seekToSavedPosition(video, item);
    await waitPlaying(video, session);
    if (await abortIfStale(session)) return;
    hidePlayOverlay();
    revealPlayerView(item, video);
  }

  async function startHlsStream(id, item, session, transcode = false) {
    destroyHlsPlayer();
    parkVideoEngine();
    const video = getPlaybackVideo();
    if (!video) return;
    const libQ = state.libraryId ? `?library_id=${encodeURIComponent(state.libraryId)}` : "";
    const url = `/api/hls/${id}/playlist.m3u8${libQ}`;
    const resumeAt = getSavedPlaybackPosition(item) || 0;
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
        hlsInstance = new Hls({ enableWorker: true, startPosition: resumeAt });
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
      if (await abortIfStale(session)) return;
      updatePlayOverlay("即将播放", "正在启动播放器…", { progress: 95 });
      const resumed = await seekToSavedPosition(video, item);
      if (resumed != null) setPlayerStatus(`从 ${formatPlaybackTime(resumed)} 继续播放`);
      await video.play().catch(() => {});
      await seekToSavedPosition(video, item);
      await waitPlaying(video, session);
      if (await abortIfStale(session)) return;
      hidePlayOverlay();
      revealPlayerView(item, video);
      bindHlsSliceThrottle(video, id, session);
      return;
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      await waitCanPlay(video, session, transcode ? 180000 : 120000);
      if (await abortIfStale(session)) return;
      const resumed = await seekToSavedPosition(video, item);
      if (resumed != null) setPlayerStatus(`从 ${formatPlaybackTime(resumed)} 继续播放`);
      await video.play().catch(() => {});
      await seekToSavedPosition(video, item);
      await waitPlaying(video, session);
      if (await abortIfStale(session)) return;
      hidePlayOverlay();
      revealPlayerView(item, video);
      bindHlsSliceThrottle(video, id, session);
      return;
    }
    throw new Error("浏览器不支持 HLS，请改用 PotPlayer");
  }

  async function waitHlsReady(id, session, maxSec = 180, transcode = false) {
    const limitSec = transcode ? Math.max(maxSec, 300) : maxSec;
    const start = Date.now();
    let lastSeg = 0;
    while (Date.now() - start < limitSec * 1000) {
      if (await abortIfStale(session)) throw new Error("已切换视频");
      const st = await api(`/api/play/status/${id}`);
      if (st.ready) {
        await maybePauseSliceDuringPrep(st);
        updatePlayOverlay(transcode ? "转码完成" : "切片就绪", "即将加载播放器…", { progress: 100 });
        return st;
      }
      if (st.state === "error") throw new Error(st.error || "HLS 准备失败");
      const segs = st.segments || 0;
      const elapsed = st.elapsed_sec || 0;
      const detail = segs <= 0
        ? (transcode
          ? `正在编码首段（转码较慢，首段常需 20～40 秒）· 已等待 ${Math.round(elapsed)}s`
          : `正在生成首段切片 · 已等待 ${Math.round(elapsed)}s`)
        : (transcode
          ? `已生成 ${segs} 个片段 · 耗时 ${elapsed}s`
          : `已切片 ${segs} 个片段 · 耗时 ${elapsed}s`);
      const pct = segs > 0 ? Math.min(92, 12 + segs * 8) : null;
      updatePlayOverlay(transcode ? "正在转码" : "正在切片", detail, {
        progress: pct,
        indeterminate: segs <= 0,
      });
      if (segs > lastSeg) lastSeg = segs;
      await maybePauseSliceDuringPrep(st);
      await new Promise(r => setTimeout(r, 600));
    }
    throw new Error(transcode ? "转码准备超时，请使用 PotPlayer" : "准备超时，请使用 PotPlayer");
  }

  async function startWebHlsPlayback(id, base, session, info) {
    const transcode = !!info.transcode;
    state.activeSliceVideoId = id;
    updatePlayOverlay(
      prepTitle(transcode, null),
      "正在准备切片任务…",
      { indeterminate: true, item: base, info },
    );
    const prep = await api(`/api/play/prepare/${id}`, { method: "POST" });
    if (await abortIfStale(session)) return;
    if (prep.error && prep.state === "error") throw new Error(prep.error);
    if (prep.cached) {
      updatePlayOverlay("使用缓存", "跳过转码，直接加载…", { progress: 80, item: base, info });
    } else if (!prep.ready) {
      updatePlayOverlay(
        prepTitle(transcode, prep),
        transcode ? "首次转码可能较慢，请稍候" : "边切边播，首段就绪即可播放",
        { indeterminate: true, item: base, info },
      );
      await waitHlsReady(id, session, 180, transcode);
    }
    if (await abortIfStale(session)) return;
    await startHlsStream(id, base, session, transcode);
  }

  async function playVideoHtml5(id, item, opts = {}) {
    const { batchLabel = "", prefetchedInfo = null } = opts;
    const prevId = state.playingId;
    const prevVideo = getPlaybackVideo();
    const session = ++state.playSession;
    pendingPlayId = id;
    state.playingId = id;

    if (prevId && prevId !== id && prevVideo && Number.isFinite(prevVideo.currentTime) && prevVideo.currentTime >= 1) {
      void savePlaybackPosition(
        prevId,
        prevVideo.currentTime,
        Number.isFinite(prevVideo.duration) ? prevVideo.duration : null,
      );
    }
    unbindPlaybackProgressSaver();

    clearHlsSliceThrottle();
    detachVideoStream(getPlaybackVideo(), { hard: true });
    await stopActiveSlice();

    if (!state.playerViewOpen) {
      const navItem = getItemById(id) || item || { id, title: id, filename: "", path: "" };
      openPlayerView(navItem, { scrollToActive: false });
    } else if (state.playerViewOpen) {
      const navItem = getItemById(id) || item || { id, title: id, filename: "" };
      setPlayerHeaderTitle(navItem.title || navItem.filename || id);
      const pathEl = $("#player-path");
      if (pathEl && navItem.path) {
        pathEl.textContent = navItem.path;
        pathEl.title = navItem.path;
      }
      updatePlayerPlaylistActive();
      scrollPlaylistToActive();
      highlightPlayingCard();
      updateUrl();
      prefetchPlaylistIfNeeded();
    }
    const base = item || { id, title: id, filename: "", path: "" };
    parkVideoEngine();
    hidePlayerPreparing();
    setPlayOverlayContext(base, null);
    const cachedInfo = prefetchedInfo || takeCachedPlayInfo(id);
    showPlayOverlay(
      cachedInfo ? "准备播放" : "检测兼容性",
      cachedInfo ? (cachedInfo.reason || "") : "正在分析视频格式…",
      { indeterminate: !cachedInfo, progress: cachedInfo ? 15 : null, item: base },
    );

    try {
      if (await abortIfStale(session)) return;
      const info = cachedInfo || await api(`/api/play/info/${id}`);
      if (!cachedInfo) stashPlayInfo(id, info);
      if (await abortIfStale(session)) return;
      if (info.title) base.title = info.title;
      if (info.path) base.path = info.path;
      if (info.filename) base.filename = info.filename;
      if (info.playPosition != null && Number(info.playPosition) > 0) {
        applyLocalPlaybackPosition(
          base,
          Number(info.playPosition),
          info.playDuration != null ? Number(info.playDuration) : null,
        );
        const cached = getItemById(id);
        if (cached) applyLocalPlaybackPosition(cached, Number(info.playPosition), info.playDuration);
      }

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
        } else {
          void hideHtml5Player();
        }
        return;
      }

      if (info.mode === "external") {
        await handleNonStandardPlayback(id, base, info);
        return;
      }

      if (info.mode === "hls") {
        await startWebHlsPlayback(id, base, session, info);
        return;
      }

      try {
        await startDirectStream(id, base, session, info);
      } catch (directErr) {
        if (!info.experimental_direct) throw directErr;
        updatePlayOverlay("直连失败", "改用服务端转码…", { indeterminate: true, item: base, info });
        await startWebHlsPlayback(id, base, session, { ...info, mode: "hls", transcode: true });
      }
    } catch (err) {
      if (await abortIfStale(session)) return;
      pendingPlayId = null;
      hidePlayOverlay();
      parkVideoEngine();
      resetVideoDisplay(getPlaybackVideo());
      const msg = err.message || "未知错误";
      if (confirm(`播放失败: ${msg}\n\n是否用 PotPlayer 打开？`)) {
        await playVideoExternal(id);
      } else {
        void hideHtml5Player();
      }
    }
  }

  let nonStandardResolve = null;
  let nonStandardDialogCtx = null;

  function showNonStandardDialog({ reason, remuxable = false, remuxReason = "" } = {}) {
    return new Promise((resolve) => {
      const dlg = $("#nonstandard-dialog");
      nonStandardDialogCtx = { remuxable, remuxReason };
      if (!dlg) {
        resolve(remuxable ? "remux" : "potplayer");
        return;
      }
      nonStandardResolve = resolve;
      const msg = $("#nonstandard-dialog-msg");
      if (msg) msg.textContent = reason || "该视频为碎片化 MP4，浏览器无法直连。";
      const remuxBtn = $("#nonstandard-btn-remux");
      if (remuxBtn) {
        remuxBtn.classList.toggle("hidden", !remuxable);
        remuxBtn.disabled = false;
        remuxBtn.title = remuxable
          ? "流复制重封装为标准 MP4（不重新编码）"
          : (remuxReason || "当前视频不支持流复制修复");
      }
      $("#nonstandard-btn-web")?.classList.add("hidden");
      dlg.showModal();
    });
  }

  function resolveNonStandardDialog(choice) {
    const dlg = $("#nonstandard-dialog");
    dlg?.close();
    if (nonStandardResolve) {
      nonStandardResolve(choice);
      nonStandardResolve = null;
    }
  }

  async function finishRemuxRefreshInPlace(id, { keepOverlay = false } = {}) {
    state.playSession += 1;
    pendingPlayId = null;
    if (!keepOverlay) hidePlayOverlay();

    markCardRemuxed(id);

    const item = getItemById(id) || { id, title: id, filename: "", path: "" };
    if (state.playerViewOpen && state.playingId === id) {
      void playVideoHtml5(id, item);
      return;
    }
    if (state.playerViewOpen) {
      highlightPlayingCard();
    }
  }

  function remuxOverlayTitle(batchLabel) {
    return batchLabel ? `正在修复 ${batchLabel}` : "正在修复";
  }

  async function runVideoRemux(id, item, { batchLabel = "" } = {}) {
    const session = ++state.playSession;
    pendingPlayId = null;
    detachVideoStream(getPlaybackVideo(), { hard: true });
    await stopActiveSlice();
    const base = item || { id, title: id, filename: "", path: "" };
    const overlayTitle = remuxOverlayTitle(batchLabel);
    const detailPrefix = base.title ? `${base.title}\n` : "";
    showPlayOverlay(overlayTitle, `${detailPrefix}正在启动重封装…`, { indeterminate: true, item: base });
    try {
      const start = await api(`/api/videos/${id}/remux`, { method: "POST" });
      if (!start.ok) throw new Error(start.error || "无法开始修复");
      while (true) {
        if (session !== state.playSession) return;
        const st = await api(`/api/videos/${id}/remux`);
        if (st.state === "queued" || st.state === "running") {
          updatePlayOverlay(
            overlayTitle,
            `${detailPrefix}${st.message || "重封装中（流复制，不重新编码）…"}`,
            {
              progress: st.progress_pct > 0 ? st.progress_pct : null,
              indeterminate: !st.progress_pct || st.progress_pct <= 0,
              item: base,
            },
          );
        }
        if (st.state === "done") {
          await finishRemuxRefreshInPlace(id, { keepOverlay: !!batchLabel });
          return;
        }
        if (st.state === "error") {
          hidePlayOverlay();
          alert(`修复失败：${st.error || "未知错误"}`);
          return;
        }
        if (st.state === "idle") {
          hidePlayOverlay();
          return;
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (err) {
      if (session !== state.playSession) return;
      hidePlayOverlay();
      alert(`修复失败：${err.message || "未知错误"}`);
    }
  }

  async function handleNonStandardPlayback(id, base, info) {
    hidePlayOverlay();
    const choice = await showNonStandardDialog({
      reason: info.reason,
      remuxable: !!info.remuxable,
      remuxReason: info.remux_reason || "",
    });
    if (choice === "potplayer") await playVideoExternal(id);
    else if (choice === "remux") {
      if (!info.remuxable) {
        alert(info.remux_reason || "当前视频不支持修复为标准 MP4。\n\n仅碎片化/多段交错的 MP4 可流复制修复。");
        return;
      }
      await runVideoRemux(id, base);
    }
  }

  async function batchRemuxSelected() {
    const ids = [...state.selected];
    if (!ids.length) return;
    enableBatchMode();
    const remuxable = [];
    for (const id of ids) {
      try {
        const info = await api(`/api/play/info/${id}`);
        if (info.remuxable) {
          remuxable.push({
            id,
            title: info.title || getItemById(id)?.title || id,
          });
        }
      } catch (_) { /* skip */ }
    }
    if (!remuxable.length) {
      alert("所选视频中没有可修复的碎片化/多段交错 MP4。\n\n仅碎片化 MP4 支持「流复制」修复。");
      return;
    }
    const skipped = ids.length - remuxable.length;
    const skipHint = skipped > 0 ? `\n（已跳过 ${skipped} 个不可修复项）` : "";
    if (!confirm(`将依次修复 ${remuxable.length} 个视频为标准 MP4（流复制，不重新编码）。${skipHint}\n\n修复期间请勿播放同一文件。继续？`)) {
      return;
    }
    try {
      await api("/api/remux/batch/begin", { method: "POST" });
      const total = remuxable.length;
      showPlayOverlay(`正在修复 0/${total}`, "准备批量修复…", { indeterminate: true });
      for (let i = 0; i < remuxable.length; i++) {
        const { id, title } = remuxable[i];
        const label = `${i + 1}/${total}`;
        await runVideoRemux(id, { id, title, filename: "", path: "" }, { batchLabel: label });
      }
      showPlayOverlay(`修复完成 ${total}/${total}`, "全部完成", { progress: 100 });
      setTimeout(() => hidePlayOverlay(), 1200);
    } catch (_) {
      hidePlayOverlay();
    } finally {
      await api("/api/remux/batch/end", { method: "POST" }).catch(() => {});
    }
    if (!state.formatFilter) {
      void loadVideos({ forceRebuild: true });
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

  async function hideHtml5Player() {
    state.playSession += 1;
    pendingPlayId = null;
    hidePlayOverlay();
    const video = getPlaybackVideo();
    const saveId = state.playingId;
    const saveTime = video && Number.isFinite(video.currentTime) ? video.currentTime : null;
    const saveDur = video && Number.isFinite(video.duration) ? video.duration : null;
    unbindPlaybackProgressSaver();
    detachVideoStream(video, { hard: true });
    state.activeSliceVideoId = null;
    await stopActiveSlice();
    if (saveId && saveTime != null && saveTime >= 1 && resumePlaybackEnabled()) {
      void savePlaybackPosition(saveId, saveTime, saveDur);
    }
    state.playerViewOpen = false;
    hidePlayerPreparing();
    resetVideoDisplay(video);
    clearMediaSession();
    parkVideoEngine();
    syncGalleryLayout();
    state.playingId = null;
    state.playlistItems = [];
    state.playlistCanLoadMore = false;
    playlistScrollObserver?.disconnect();
    playlistScrollObserver = null;
    highlightPlayingCard();
    updateUrl(true);
    if (state.pageSize === "auto") scheduleAutoPageSizeCheck();
  }

  async function playAdjacentVideo(delta) {
    const list = getPlaylistItems();
    if (!state.playingId || !list.length) return;
    const idx = list.findIndex(v => v.id === state.playingId);
    if (idx < 0) return;
    let next = list[idx + delta];
    if (!next && delta > 0 && state.playlistCanLoadMore) {
      const loaded = await loadMorePlaylist();
      if (loaded) {
        const list2 = getPlaylistItems();
        next = list2[idx + delta];
      }
    }
    if (next) {
      const prefetched = takeCachedPlayInfo(next.id);
      await playVideo(next.id, { prefetchedInfo: prefetched });
      updateMediaSession(next);
    }
  }

  async function playVideoExternal(id) {
    try {
      await api(`/api/play-external/${id}`, { method: "POST" });
      bumpLocalPlayMeta(id);
    } catch (e) {
      alert("PotPlayer 打开失败: " + e.message);
    }
  }

  async function playVideo(id, opts = {}) {
    const item = getItemById(id);
    const mode = normalizePlayerMode(state.playerMode);

    if (mode === "html5") {
      await playVideoHtml5(id, item || { id, title: id, filename: "", path: "" }, opts);
      return;
    }

    await playVideoExternal(id);
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
    $("#btn-sel-remux").disabled = n === 0;
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

  async function stopPlaybackForSwitch() {
    state.playSession += 1;
    pendingPlayId = null;
    unbindPlaybackProgressSaver();
    detachVideoStream(getPlaybackVideo(), { hard: false });
    state.activeSliceVideoId = null;
    await stopActiveSlice();
    hidePlayOverlay();
    parkVideoEngine();
    resetVideoDisplay(getPlaybackVideo());
  }

  async function deleteVideos(ids) {
    if (!ids.length) return;
    if (!await confirmDelete(ids)) return;

    const inPlayer = state.playerViewOpen;
    const idSet = new Set(ids);
    const deletedCurrent = inPlayer && state.playingId && idSet.has(state.playingId);
    const playlistBefore = inPlayer ? getPlaylistItems() : [];
    const curIdx = deletedCurrent
      ? playlistBefore.findIndex(v => v.id === state.playingId)
      : -1;
    const preferNextId = curIdx >= 0 ? playlistBefore[curIdx + 1]?.id : null;

    if (deletedCurrent) {
      await stopPlaybackForSwitch();
      state.playingId = null;
    }

    const result = await api("/api/videos/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (result.errors?.length) {
      alert(result.errors.map(e => `${e.id}: ${e.error}`).join("\n"));
    }
    state.playlistItems = state.playlistItems.filter(v => !idSet.has(v.id));
    state.selected.clear();
    await loadCategories();
    await loadVideos({ forceRebuild: true, keepPlayerOpen: inPlayer });
    if (isAlbumDetailView()) await refreshCurrentAlbumMeta();
    loadProgress();

    if (!inPlayer) return;

    renderPlayerPlaylist(true);
    if (!deletedCurrent) {
      highlightPlayingCard();
      updateUrl();
      return;
    }

    const list = getPlaylistItems();
    let targetId = preferNextId && list.some(v => v.id === preferNextId) ? preferNextId : null;
    if (!targetId && list.length) {
      targetId = list[Math.min(curIdx, list.length - 1)]?.id || null;
    }
    if (targetId) {
      await playVideo(targetId);
    } else {
      state.playingId = null;
      await hideHtml5Player();
    }
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
    hideAlbumCtxMenu();
    state.ctxTarget = id;
    const item = getItemById(id);
    const favBtn = $("#ctx-menu")?.querySelector('[data-action="fav-toggle"]');
    if (favBtn) favBtn.textContent = item?.favorited ? "取消收藏" : "加入收藏";
    const albumBtn = $("#ctx-menu")?.querySelector('[data-action="album-add"]');
    if (albumBtn) {
      const n = item?.albumIds?.length || 0;
      albumBtn.textContent = n > 0 ? `管理专辑归属（${n}）…` : "加入专辑…";
    }
    const coverBtn = $("#ctx-menu")?.querySelector('[data-action="album-cover"]');
    if (coverBtn) {
      const show = isAlbumDetailView() && state.albumId && (item?.albumIds || []).includes(state.albumId);
      coverBtn.classList.toggle("hidden", !show);
      const isCover = state.currentAlbum?.cover_video_id === id;
      coverBtn.textContent = isCover ? "已是专辑封面" : "设为专辑封面";
      coverBtn.disabled = isCover;
    }
    const remuxBtn = $("#ctx-menu")?.querySelector('[data-action="remux"]');
    if (remuxBtn) {
      const show = (item?.formatBadge === "remuxable" || item?.formatBadge === "interleaved") && !item?.remuxedOnPage;
      remuxBtn.classList.toggle("hidden", !show);
    }
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
    hideAlbumCtxMenu();
    hideFolderCtxMenu();
  }

  let folderCtxTarget = "";
  let folderCtxType = "subdir"; // subdir | cat

  function showFolderCtxMenu(x, y, folderPath, type = "subdir") {
    hideCtxMenu();
    folderCtxTarget = folderPath;
    folderCtxType = type;
    const menu = $("#folder-ctx-menu");
    if (!menu) return;
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

  function hideFolderCtxMenu() {
    $("#folder-ctx-menu")?.classList.add("hidden");
    folderCtxTarget = "";
  }

  async function showMoveFolderDialog() {
    const dlg = $("#move-folder-dialog");
    const tree = $("#move-folder-tree");
    const confirmBtn = $("#move-folder-confirm");
    const cancelBtn = $("#move-folder-cancel");
    if (!dlg || !tree) return null;
    let cats = [];
    try {
      const res = await api("/api/categories");
      cats = (res.items || []).filter(c => c.name && c.name !== state.category);
    } catch (_) {}
    tree.innerHTML = `
      <div class="move-folder-item" data-path=""><span class="move-folder-icon">📁</span><span>根目录</span></div>
      ${cats.map(c => `
        <div class="move-folder-item" data-path="${escAttr(c.name)}"><span class="move-folder-icon">📁</span><span>${esc(c.name)}</span></div>`).join("")}`;
    let selPath = "";
    tree.querySelectorAll(".move-folder-item").forEach(el => {
      el.addEventListener("click", () => {
        tree.querySelector(".move-folder-item.selected")?.classList.remove("selected");
        el.classList.add("selected");
        selPath = el.dataset.path;
        if (confirmBtn) confirmBtn.disabled = false;
      });
    });
    if (confirmBtn) confirmBtn.disabled = true;
    dlg.showModal();
    return new Promise((resolve) => {
      if (confirmBtn) {
        confirmBtn.addEventListener("click", () => { dlg.close(); resolve(selPath); }, { once: true });
      }
      if (cancelBtn) {
        cancelBtn.addEventListener("click", () => { dlg.close(); resolve(null); }, { once: true });
      }
      dlg.addEventListener("close", () => resolve(null), { once: true });
    });
  }

  function patchCategoryDOM(oldName, newName) {
    const wrapper = document.querySelector(`.tree-cat-wrapper[data-category="${CSS.escape(oldName)}"]`);
    if (!wrapper) return;
    wrapper.dataset.category = newName;
    const catItem = wrapper.querySelector(".cat-item");
    if (catItem) catItem.dataset.category = newName;
    const nameSpan = wrapper.querySelector(".cat-name");
    if (nameSpan) { nameSpan.textContent = newName; nameSpan.title = newName; }
  }

  function removeCategoryDOM(name) {
    const wrapper = document.querySelector(`.tree-cat-wrapper[data-category="${CSS.escape(name)}"]`);
    if (wrapper) wrapper.remove();
  }

  function patchFolderTreeDOM(path, newName) {
    const list = $("#category-list");
    if (!list) return;
    const row = list.querySelector(`.tree-folder-row[data-folder="${CSS.escape(path)}"]`);
    if (!row) return;
    const newPath = path.includes("/") ? path.split("/").slice(0, -1).join("/") + "/" + newName : newName;
    row.dataset.folder = newPath;
    const nameSpan = row.querySelector(".tree-folder-name");
    if (nameSpan) { nameSpan.textContent = newName; nameSpan.title = newPath; }
  }

  function removeFolderTreeDOM(path) {
    const list = $("#category-list");
    if (!list) return;
    const row = list.querySelector(`.tree-folder-row[data-folder="${CSS.escape(path)}"]`);
    if (row) row.remove();
  }

  $("#folder-ctx-menu")?.addEventListener("click", async (e) => {
    const action = e.target.dataset.action;
    if (!action) return;
    const savedPath = folderCtxTarget;
    const savedType = folderCtxType;
    hideFolderCtxMenu();
    if (!savedPath && savedType === "subdir") return;
    const target = savedType === "cat" ? savedPath : `${state.category}/${savedPath}`;

    if (action === "folder-rename") {
      const oldName = target.split("/").pop();
      const newName = prompt("输入新目录名", oldName);
      if (!newName || !newName.trim()) return;
      try {
        const result = await api(`/api/folders/rename?${new URLSearchParams({
          category: state.category,
          old_path: savedType === "cat" ? target : savedPath,
          new_name: newName.trim(),
          type: savedType,
        })}`, { method: "POST" });
        if (result.renamed) {
          state.folder = "";
          delete state.folderTrees[state.category];
          lastCatCounts = {};
          await loadCategories();
        }
      } catch (err) {
        alert("重命名失败: " + err.message);
      }
    } else if (action === "folder-move") {
      const srcInfo = savedType === "cat" ? `分类「${savedPath}」` : `「${savedPath}」`;
      $("#move-folder-src").textContent = `将 ${srcInfo} 移动到：`;
      const selected = await showMoveFolderDialog();
      if (!selected && selected !== "") return;
      try {
        const result = await api(`/api/folders/move?${new URLSearchParams({
          category: state.category,
          src_path: savedType === "cat" ? target : savedPath,
          dest_path: selected,
          type: savedType,
        })}`, { method: "POST" });
        if (result.moved) {
          state.folder = "";
          delete state.folderTrees[state.category];
          lastCatCounts = {};
          await loadCategories();
        }
      } catch (err) {
        alert("移动失败: " + err.message);
      }
    } else if (action === "folder-delete") {
      const confirmMsg = `确定删除目录 "${target}" 及其所有子目录和文件？\n\n将被移动到系统回收站。`;
      if (!confirm(confirmMsg)) return;
      try {
        const result = await api(`/api/folders/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: state.category,
            folder: savedType === "cat" ? target : savedPath,
            type: savedType,
          }),
        });
        if (result.deleted > 0) {
          state.folder = "";
          delete state.folderTrees[state.category];
          lastCatCounts = {};
          await loadCategories();
        } else {
          alert("未找到匹配文件");
        }
      } catch (err) {
        alert("删除失败: " + err.message);
      }
    }

  });
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
    const n = Number(size);
    if (!Number.isFinite(n) || n < 0) return;
    state.pageSize = n === 0 ? 0 : Math.min(999, Math.max(1, Math.floor(n)));
    state.page = 1;
    syncPageSizeControls();
    saveState();
    loadVideos();
  }

  function applyCustomPageSize() {
    const input = $("#page-size-custom");
    if (!input) return;
    const n = parseInt(input.value, 10);
    if (!Number.isFinite(n) || n < 1) return;
    setPageSize(n);
  }

  let sseHandle = null;

  function connectSSE(reconnect = false) {
    if (reconnect && sseHandle) {
      sseHandle.close();
      sseHandle = null;
    }
    const libQ = state.libraryId ? `?library_id=${encodeURIComponent(state.libraryId)}` : "";
    const es = new EventSource(`/api/events${libQ}`);
    sseHandle = es;
    es.onmessage = (e) => {
      const colon = e.data.indexOf(":");
      const type = colon >= 0 ? e.data.slice(0, colon) : e.data;
      const payload = colon >= 0 ? e.data.slice(colon + 1) : "";
      if (type === "version") {
        const parts = payload.split(":");
        const lid = parts.length > 1 ? parts[0] : "";
        const ver = parts.length > 1 ? parts.slice(1).join(":") : payload;
        if (lid && lid !== state.libraryId) return;
        clearTimeout(versionDebounceTimer);
        versionDebounceTimer = setTimeout(async () => {
          const versionChanged = ver && ver !== lastLibraryVersion;
          lastLibraryVersion = ver;
          state.folderTrees = {};
          await loadCategories();
          if (versionChanged && !state.formatFilter) {
            await loadVideos({ forceRebuild: false });
          } else if (pageThumbsNeedPolling(state.pageItems)) {
            refreshVisibleThumbs();
          }
        }, 500);
      } else if (type === "progress") {
        scheduleLoadProgress();
      }
    };
    es.onerror = () => {
      es.close();
      if (sseHandle === es) sseHandle = null;
      setTimeout(() => connectSSE(), 5000);
    };
  }

  async function openSettings() {
    await loadLibraries();
    renderLibrarySettings();
    try {
      const s = await api("/api/settings");
      fillSettingsForm(s);
    } catch (_) {
      fillSettingsForm(null);
    }
    $("#settings-dialog")?.showModal();
  }

  async function saveSettings() {
    const pos = parseFloat($("#set-position")?.value);
    if (Number.isNaN(pos) || pos < 0.05 || pos > 0.95) {
      alert("截图位置需在 0.05 ~ 0.95 之间");
      return;
    }
    const historyDays = parseInt($("#set-history-days")?.value, 10);
    if (Number.isNaN(historyDays) || historyDays < 1 || historyDays > 3650) {
      alert("最近播放保留天数需在 1 ~ 3650 之间");
      return;
    }
    const workers = parseInt($("#set-workers")?.value, 10);
    if (Number.isNaN(workers) || workers < 1 || workers > 8) {
      alert("并发线程数需在 1 ~ 8 之间");
      return;
    }
    const candidateCount = parseInt($("#set-candidate-count")?.value, 10);
    if (candidateCount != null && (isNaN(candidateCount) || candidateCount < 3 || candidateCount > 12)) {
      alert("候选图数量需在 3 ~ 12 之间");
      return;
    }
    const wheelParsed = parseInt($("#set-html5-wheel-seek-sec")?.value, 10);
    if (Number.isNaN(wheelParsed) || wheelParsed < 0 || wheelParsed > 120) {
      alert("滚轮快进秒数需在 0 ~ 120 之间（0 表示关闭）");
      return;
    }
    try {
      await api("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thumb_position: pos,
          thumb_workers: workers,
          thumb_idle_scan: $("#set-idle-scan")?.value === "true",
          thumb_progress_bar: normalizeThumbProgressBar($("#set-thumb-progress-bar")?.value),
          thumb_candidate_count: candidateCount || 6,
          thumb_auto_select_best: $("#set-auto-select-best")?.value === "true",
          thumb_batch_auto_select: $("#set-batch-auto-select")?.value === "true",
          thumb_jitter_pct: parseInt($("#set-jitter-pct")?.value, 10) || 10,
          thumb_jitter_min: parseInt($("#set-jitter-min")?.value, 10) || 6,
          thumb_jitter_max: parseInt($("#set-jitter-max")?.value, 10) || 94,
          default_page_size: readSettingsPageSize(),
          potplayer_path: $("#set-potplayer")?.value || "",
          player_mode: document.querySelector('input[name="player-mode"]:checked')?.value || SETTINGS_DEFAULTS.player_mode,
          hls_large_h264: $("#set-hls-large-h264")?.value === "true",
          hls_moov_end_h264: $("#set-hls-moov-end-h264")?.value === "true",
          html5_fragmented_mp4: $("#set-html5-fragmented-mp4")?.value || "external",
          html5_modern_codecs_direct: $("#set-html5-modern-codecs-direct")?.value === "true",
          html5_playlist_autoplay: $("#set-html5-playlist-autoplay")?.value === "true",
          html5_resume_playback: $("#set-html5-resume-playback")?.value === "true",
          html5_wheel_seek_sec: normalizeWheelSeekSec($("#set-html5-wheel-seek-sec")?.value),
          html5_player_prev_key: normalizePlayerHotkey(
            $("#set-html5-player-prev-key")?.value,
            SETTINGS_DEFAULTS.html5_player_prev_key,
          ),
          html5_player_next_key: normalizePlayerHotkey(
            $("#set-html5-player-next-key")?.value,
            SETTINGS_DEFAULTS.html5_player_next_key,
          ),
          history_retention_days: historyDays,
          ui_theme: normalizeTheme($("#set-ui-theme")?.value),
          scope: "global",
        }),
      });
      state.playerMode = document.querySelector('input[name="player-mode"]:checked')?.value || SETTINGS_DEFAULTS.player_mode;
      state.playlistAutoplay = $("#set-html5-playlist-autoplay")?.value === "true";
      state.resumePlayback = $("#set-html5-resume-playback")?.value === "true";
      state.wheelSeekSec = normalizeWheelSeekSec($("#set-html5-wheel-seek-sec")?.value);
      state.thumbProgressBar = normalizeThumbProgressBar($("#set-thumb-progress-bar")?.value);
      state.thumbAutoSelectBest = $("#set-auto-select-best")?.value === "true";
      state.thumbBatchAutoSelect = $("#set-batch-auto-select")?.value === "true";
      applyPlayerHotkeySettings({
        html5_player_prev_key: $("#set-html5-player-prev-key")?.value,
        html5_player_next_key: $("#set-html5-player-next-key")?.value,
      });
      applyTheme($("#set-ui-theme")?.value || state.theme, { persistLocal: true });
      $("#settings-dialog")?.close();
      loadProgress();
    } catch (err) {
      alert("保存失败: " + err.message);
    }
  }

  async function submitAddLibrary() {
    const alias = $("#library-add-alias")?.value.trim();
    const path = $("#library-add-path")?.value.trim();
    if (!alias) {
      alert("请输入视频库别名");
      $("#library-add-alias")?.focus();
      return;
    }
    if (!path) {
      alert("请输入或选择视频文件夹路径");
      $("#library-add-path")?.focus();
      return;
    }
    try {
      const data = await api("/api/libraries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias, path }),
      });
      if ($("#library-add-alias")) $("#library-add-alias").value = "";
      if ($("#library-add-path")) $("#library-add-path").value = "";
      await loadLibraries();
      renderLibrarySettings();
      const newId = data.library?.id;
      if (newId) await switchLibrary(newId, { resetBrowse: true });
      else await switchLibrary(state.libraryId, { resetBrowse: false });
      alert(`已添加视频库「${alias}」`);
    } catch (err) {
      alert("添加失败: " + err.message);
    }
  }

  // --- Event bindings ---

  $("#search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = e.target.value.trim();
      state.page = 1;
      regenerateRandomSeedIfNeeded();
      loadVideos();
    }, 300);
  });

  $("#search").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.target.value = "";
      state.query = "";
      state.page = 1;
      regenerateRandomSeedIfNeeded();
      loadVideos();
    }
  });

  $("#sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    state.page = 1;
    if (state.sort === "random") {
      state.randomSeed = Date.now();
    } else {
      state.randomSeed = null;
    }
    saveState();
    loadVideos();
  });

  $("#format-filter")?.addEventListener("change", (e) => {
    state.formatFilter = e.target.value;
    state.page = 1;
    regenerateRandomSeedIfNeeded();
    saveState();
    if (state.formatFilter) {
      void requestFormatScan();
      startFormatScanPoll();
    } else {
      stopFormatScanPoll();
      state.formatIndexStatus = null;
    }
    loadVideos({ forceRebuild: true });
  });

  $("#btn-page-size-40")?.addEventListener("click", () => setPageSize(40));
  $("#btn-page-size-80")?.addEventListener("click", () => setPageSize(80));
  $("#btn-page-size-all")?.addEventListener("click", () => setPageSize(0));
  $("#btn-random-play")?.addEventListener("click", async () => {
    if (state.playerViewOpen) {
      showToast("请先关闭播放器再使用随机播放", { type: "info" });
      return;
    }
    const seed = Date.now();
    state.playlistSort = "random";
    state.playlistRandomSeed = seed;
    saveState();
    const params = new URLSearchParams();
    if (state.viewMode === "favorites") params.set("favorites", "1");
    else if (state.viewMode === "history") params.set("history", "1");
    else if (isAlbumDetailView() && state.albumId) params.set("album_id", state.albumId);
    else {
      if (state.category) params.set("category", state.category);
      if (state.folder) params.set("folder", state.folder);
    }
    if (state.query) params.set("q", state.query);
    if (state.formatFilter) params.set("format", state.formatFilter);
    params.set("sort", "random");
    params.set("seed", String(seed));
    params.set("page", "1");
    params.set("page_size", "1");
    try {
      const data = await api(`/api/videos?${params}`);
      const items = data.items || [];
      if (!items.length) {
        showToast("没有可播放的视频", { type: "info" });
        return;
      }
      await playVideo(items[0].id);
    } catch (err) {
      showToast("随机播放失败: " + (err.message || String(err)), { type: "error" });
    }
  });
  $("#page-size-custom")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyCustomPageSize();
    }
  });
  $("#page-size-custom")?.addEventListener("change", () => applyCustomPageSize());

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
    await loadVideos({ forceRebuild: true });
    await loadProgress();
    scheduleFormatBadgePoll();
    scheduleDurationPoll();
  });

  $("#btn-pause").addEventListener("click", async () => {
    await api("/api/thumb/pause", { method: "POST" });
    loadProgress();
  });

  $("#btn-resume").addEventListener("click", async () => {
    await api("/api/thumb/resume", { method: "POST" });
    loadProgress();
  });

  $("#btn-view-browse")?.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
    e.preventDefault();
    goHome();
  });
  $("#btn-view-favorites")?.addEventListener("click", () => setViewMode("favorites"));
  $("#btn-view-history")?.addEventListener("click", () => setViewMode("history"));
  $("#btn-view-albums")?.addEventListener("click", () => setViewMode("albums"));

  $("#btn-album-create")?.addEventListener("click", () => openAlbumFormDialog());
  $("#btn-albums-back")?.addEventListener("click", backToAlbumsList);
  $("#btn-album-play-all")?.addEventListener("click", () => { void playAlbumAll(); });
  $("#btn-album-edit")?.addEventListener("click", () => {
    if (state.currentAlbum) openAlbumFormDialog({ mode: "edit", album: state.currentAlbum });
  });
  $("#btn-album-from-page")?.addEventListener("click", () => {
    const ids = state.pageItems.map(v => v.id);
    if (!ids.length) {
      showToast("当前页没有可加入专辑的视频", { type: "info" });
      return;
    }
    openAlbumFormDialog({ pendingIds: ids });
  });

  $("#album-form-dialog")?.addEventListener("close", (e) => {
    void submitAlbumForm(e.target.returnValue);
  });
  $("#album-form-delete")?.addEventListener("click", () => { void deleteCurrentAlbum(); });

  $("#album-picker-dialog")?.addEventListener("close", (e) => {
    void submitAlbumPicker(e.target.returnValue);
  });
  $("#album-picker-new")?.addEventListener("click", () => {
    const dlg = $("#album-picker-dialog");
    const ids = (dlg?.dataset.videoIds || "").split(",").filter(Boolean);
    dlg?.close("cancel");
    requestAnimationFrame(() => openAlbumFormDialog({ pendingIds: ids }));
  });

  $("#album-ctx-menu")?.addEventListener("click", async (e) => {
    const action = e.target.dataset.action;
    const albumId = state.albumCtxTarget;
    if (!action || !albumId) return;
    hideAlbumCtxMenu();
    if (action === "album-open") await openAlbumDetail(albumId);
    else if (action === "album-play-all") await playAlbumById(albumId);
    else if (action === "album-edit") await editAlbumById(albumId);
    else if (action === "album-delete") await deleteAlbumById(albumId);
  });

  $("#btn-sel-album")?.addEventListener("click", () => {
    const ids = [...state.selected];
    if (!ids.length) {
      showToast("请先选择要加入专辑的视频", { type: "info" });
      return;
    }
    openAlbumPicker(ids);
  });

  $("#btn-sel-fav-add").addEventListener("click", () => {
    if (!state.selected.size) {
      showToast("请先选择要收藏的视频", { type: "info" });
      return;
    }
    batchFavoritesAction("add");
  });
  $("#btn-sel-fav-remove").addEventListener("click", () => {
    if (!state.selected.size) {
      showToast("请先选择要取消收藏的视频", { type: "info" });
      return;
    }
    batchFavoritesAction("remove");
  });

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
    if (ids.length) batchRegenerateThumbs(ids);
  });

  $("#btn-sel-remux").addEventListener("click", () => { void batchRemuxSelected(); });

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
  $("#btn-theme-toggle")?.addEventListener("click", toggleTheme);
  $("#set-ui-theme")?.addEventListener("change", () => {
    void persistTheme($("#set-ui-theme")?.value);
  });

  $("#library-select")?.addEventListener("change", (e) => {
    switchLibrary(e.target.value, { resetBrowse: true });
  });

  $("#library-add-browse")?.addEventListener("click", async () => {
    try {
      const picked = await api("/api/libraries/pick-folder", { method: "POST" });
      if (picked.cancelled) return;
      const pathInput = $("#library-add-path");
      if (pathInput) pathInput.value = picked.path;
    } catch (err) {
      alert("选择文件夹失败: " + err.message);
    }
  });

  $("#library-add-submit")?.addEventListener("click", () => submitAddLibrary());

  $("#library-add-path")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitAddLibrary();
    }
  });

  $("#library-add-alias")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("#library-add-path")?.focus();
    }
  });

  document.querySelectorAll('input[name="player-mode"]').forEach(r => {
    r.addEventListener("change", updatePotplayerPathVisibility);
  });

  $("#btn-player-back").addEventListener("click", () => { void hideHtml5Player(); });
  $("#btn-player-favorite")?.addEventListener("click", () => {
    if (state.playingId) toggleFavorite(state.playingId);
  });
  $("#btn-player-album")?.addEventListener("click", () => {
    if (state.playingId) openAlbumPicker([state.playingId]);
  });
  $("#nonstandard-btn-potplayer")?.addEventListener("click", () => resolveNonStandardDialog("potplayer"));
  $("#nonstandard-btn-remux")?.addEventListener("click", () => {
    const ctx = nonStandardDialogCtx;
    if (ctx && !ctx.remuxable) {
      alert(ctx.remuxReason || "当前视频不支持修复为标准 MP4。\n\n仅碎片化 H.264 MP4 可流复制修复；AV1/HEVC 等请用 PotPlayer。");
      return;
    }
    resolveNonStandardDialog("remux");
  });
  $("#nonstandard-btn-web")?.addEventListener("click", () => resolveNonStandardDialog("web"));
  $("#nonstandard-dialog")?.addEventListener("close", () => {
    if (nonStandardResolve) resolveNonStandardDialog("cancel");
  });
  $("#play-overlay-close")?.addEventListener("click", () => { void cancelPlayback(); });
  $("#play-overlay-potplayer")?.addEventListener("click", async () => {
    const id = pendingPlayId;
    await cancelPlayback();
    if (id) await playVideoExternal(id);
  });
  $("#progress-text")?.addEventListener("click", () => {
    if (state.failedItems.length) showFailedDialog();
  });
  $("#thumb-status-chip")?.addEventListener("click", toggleThumbProgressBar);
  $("#duration-status-chip")?.addEventListener("click", toggleThumbProgressBar);
  $("#btn-show-failed-list").addEventListener("click", showFailedDialog);
  $("#btn-retry-all-failed").addEventListener("click", retryAllFailed);
  $("#failed-dialog-close").addEventListener("click", () => $("#failed-dialog")?.close());
  $("#failed-dialog-retry-all").addEventListener("click", retryAllFailed);

  $("#btn-player-prev").addEventListener("click", () => playAdjacentVideo(-1));
  $("#btn-player-next").addEventListener("click", () => playAdjacentVideo(1));
  $("#player-playlist-sort")?.addEventListener("change", async (e) => {
    state.playlistSort = e.target.value;
    if (state.playlistSort === "random") {
      state.playlistRandomSeed = Date.now();
    }
    saveState();
    await resetPlaylistForSortChange();
  });
  $("#player-playlist")?.addEventListener("click", (e) => {
    if (e.target.closest(".player-pl-load-more")) {
      e.preventDefault();
      void loadMorePlaylist();
      return;
    }
    const btn = e.target.closest(".player-pl-item");
    const vid = btn?.dataset?.id;
    if (!vid) return;
    e.preventDefault();
    void playVideo(vid);
  });
  $("#player-playlist")?.addEventListener("contextmenu", (e) => {
    const btn = e.target.closest(".player-pl-item");
    const vid = btn?.dataset?.id;
    if (!vid) return;
    e.preventDefault();
    showCtxMenu(e.clientX, e.clientY, vid);
  });
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

  $("#settings-form")?.addEventListener("submit", (e) => e.preventDefault());

  $("#settings-dialog")?.addEventListener("click", (e) => {
    if (e.target.closest("#settings-cancel")) {
      e.preventDefault();
      $("#settings-dialog")?.close();
      return;
    }
    if (e.target.closest("#settings-save")) {
      e.preventDefault();
      saveSettings();
    }
  });

  // Settings tabs
  (function initSettingsTabs() {
    const saved = localStorage.getItem("settings-active-tab") || "library";
    const tabs = document.querySelectorAll(".settings-tab");
    const panes = document.querySelectorAll(".settings-tab-pane");
    tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === saved));
    panes.forEach(p => p.classList.toggle("settings-tab-pane--hidden", p.dataset.tabPane !== saved));
    tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        tabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        panes.forEach(p => p.classList.toggle("settings-tab-pane--hidden", p.dataset.tabPane !== target));
        localStorage.setItem("settings-active-tab", target);
      });
    });
  })();

  $("#set-page-size-mode")?.addEventListener("change", syncSettingsPageSizeUi);
  $("#btn-restart-service")?.addEventListener("click", () => { void restartServiceFromSettings(); });

  $("#rename-dialog").addEventListener("close", async (e) => {
    if (e.target.returnValue !== "save" || !renameTargetId) return;
    const oldId = renameTargetId;
    try {
      const result = await api("/api/videos/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: renameTargetId, new_name: $("#rename-input").value.trim() }),
      });
      state.selected.clear();
      // 就地更新卡片，避免重载页面导致格式筛选丢失视频
      const oldCard = document.querySelector(`.card[data-id="${CSS.escape(oldId)}"]`);
      const oldItem = getItemById(oldId);
      if (oldCard && oldItem) {
        oldItem.id = result.id;
        oldItem.title = result.title;
        oldItem.filename = result.filename;
        oldCard.dataset.id = result.id;
        const tw = oldCard.querySelector(".thumb-wrap");
        if (tw) tw.id = `thumb-${result.id}`;
        const fav = oldCard.querySelector(".card-fav");
        if (fav) fav.dataset.id = result.id;
        const cb = oldCard.querySelector(".card-check");
        if (cb) cb.dataset.id = result.id;
        const te = oldCard.querySelector(".card-title");
        if (te) te.innerHTML = highlight(result.title, state.query);
        const img = oldCard.querySelector(".thumb-wrap img");
        if (img) { img.src = libThumbUrl(result.id, Date.now()); img.alt = result.title; }
      } else {
        // 卡片不在当前页面，回退到全量重载
        await loadCategories();
        await loadVideos();
      }
      loadProgress();
    } catch (err) {
      showToast("重命名失败: " + err.message, { type: "error" });
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
    else if (action === "folder") {
      try {
        await api(`/api/open-folder/${id}`, { method: "POST" });
      } catch (err) {
        showToast("打开文件夹失败: " + err.message, { type: "error" });
      }
    }
    else if (action === "regen-random") await switchThumbCandidate(id);
    else if (action === "remux") {
      const v = getItemById(id);
      await runVideoRemux(id, v || { id, title: id, filename: "", path: "" });
    }
    else if (action === "copy") {
      const v = getItemById(id);
      if (v?.path) navigator.clipboard.writeText(v.path);
    } else if (action === "fav-toggle") {
      await toggleFavorite(id);
    } else if (action === "album-add") {
      await openAlbumPicker([id]);
    } else if (action === "album-cover") {
      await setAlbumCover(id);
    } else if (action === "rename") {
      openRenameDialog(id);
    } else if (action === "move") {
      openMoveDialog([id]);
    } else if (action === "delete") {
      deleteVideos([id]);
    }
  });

  document.addEventListener("click", hideCtxMenu);
  document.addEventListener("click", (e) => {
    const wrap = $("#progress-bar-wrap");
    const chip = $("#thumb-status-chip");
    if (wrap?.contains(e.target) || chip?.contains(e.target)) return;
    if (!thumbProgressManualExpand) return;
    thumbProgressManualExpand = false;
    updateProgressBarVisibility(lastThumbProgressGlobal);
  });

  window.addEventListener("pagehide", () => {
    const video = getPlaybackVideo();
    const id = state.playingId;
    if (resumePlaybackEnabled() && id && video && Number.isFinite(video.currentTime) && video.currentTime >= 1) {
      const dur = Number.isFinite(video.duration) ? video.duration : null;
      let url = "/api/history/position";
      if (state.libraryId) url += `?library_id=${encodeURIComponent(state.libraryId)}`;
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, position_sec: video.currentTime, duration_sec: dur }),
        keepalive: true,
      }).catch(() => {});
    }
    detachVideoStream(getPlaybackVideo(), { hard: true });
    fetch("/api/play/stop", { method: "POST", keepalive: true }).catch(() => {});
  });

  document.querySelector("main")?.addEventListener("scroll", hidePathTip, { passive: true });
  window.addEventListener("resize", hidePathTip, { passive: true });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#play-overlay")?.classList.contains("hidden")) {
      e.preventDefault();
      void cancelPlayback();
      return;
    }
    if (handlePlayerNavKey(e)) return;
    const nextHotkey = normalizePlayerHotkey(state.playerNextKey, SETTINGS_DEFAULTS.html5_player_next_key);
    if (e.key === "/" && document.activeElement !== $("#search")) {
      if (state.playerViewOpen && nextHotkey === "/") return;
      e.preventDefault();
      $("#search").focus();
    }
    if (state.playerViewOpen) return;
    if (e.key === "ArrowLeft" && !e.target.matches("input, select, textarea")) {
      goToPage(state.page - 1);
    }
    if (e.key === "ArrowRight" && !e.target.matches("input, select, textarea")) {
      goToPage(state.page + 1);
    }
  });

  // --- Init ---
  applyTheme(readStoredTheme() || document.documentElement.dataset.theme || "dark", { persistLocal: false });
  syncGalleryLayout();
  parkVideoEngine();
  bindPlayerStageWheelSeek();
  applyPlayerHotkeySettings(SETTINGS_DEFAULTS);
  loadState();
  syncPlaylistSortSelect();
  parseUrl();
  $("#sort").value = state.sort;
  const formatFilterEl = $("#format-filter");
  if (formatFilterEl) formatFilterEl.value = state.formatFilter || "";
  if (state.pageSize === "auto") state.pageSize = 40;
  syncPageSizeControls();

  const galleryViewEl = $("#gallery-view");
  if (galleryViewEl && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => scheduleAutoPageSizeCheck());
    ro.observe(galleryViewEl);
  }
  window.addEventListener("resize", () => scheduleAutoPageSizeCheck());

  loadLibraries().then(() => loadPlayerSettings()).then(() => updatePotplayerPathVisibility());
  updateViewModeButtons();
  updateGalleryPanels();
  loadProgress();
  startProgressPolling(12000);
  startDurationStatusPolling();
  loadCategories().then(() => {
    if (state.formatFilter) {
      void requestFormatScan();
      startFormatScanPoll();
    }
    const boot = () => {
      refreshPageThumbProgressUi();
      void tryRestorePlayback();
    };
    if (isAlbumListView()) {
      loadAlbums().then(boot);
    } else if (isAlbumDetailView() && state.albumId) {
      refreshCurrentAlbumMeta()
        .then(() => loadVideos({ forceRebuild: true }))
        .then(boot);
    } else {
      loadVideos({ forceRebuild: true }).then(boot);
    }
  });
  // 浏览器前进/后退支持
  _urlPushEnabled = true;
  window.addEventListener("popstate", () => {
    _popstateDepth++;
    parseUrl();
    updateViewModeButtons();
    updateGalleryPanels();
    updateBreadcrumb();
    let promise;
    if (isAlbumListView()) {
      promise = loadAlbums();
    } else if (isAlbumDetailView() && state.albumId) {
      promise = openAlbumDetail(state.albumId);
    } else if (state.viewMode === "favorites" || state.viewMode === "history") {
      promise = loadVideos({ forceRebuild: true });
    } else {
      promise = loadCategories().then(() => loadVideos({ forceRebuild: true }));
    }
    promise.finally(() => {
      _popstateDepth--;
    });
  });
  connectSSE();
})();
