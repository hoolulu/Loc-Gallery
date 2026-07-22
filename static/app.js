(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  /** 与 style.css `.grid` 的 CSS 变量一致；列数优先从 DOM 实测 */
  const GRID_LAYOUT = { titleH: 34, hPad: 40, maxCols: 10 };

  let lastAutoPageSize = 0;
  let autoPageSizeTimer = null;
  let autoReconcileLock = false;

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
    if (state.pageSize !== "auto") return state.pageSize;
    const measured = measureRenderedGridColumns();
    return computeAutoPageSize(measured || undefined);
  }

  function syncPageSizeControls() {
    const isAuto = state.pageSize === "auto";
    const isAll = state.pageSize === 0;
    $("#btn-page-size-auto")?.classList.toggle("active", isAuto);
    $("#btn-page-size-all")?.classList.toggle("active", isAll);
    const input = $("#page-size-custom");
    if (!input) return;
    const custom = !isAuto && !isAll && Number(state.pageSize) > 0;
    input.classList.toggle("page-size-input-active", custom);
    if (isAuto || isAll) input.value = "";
    else if (custom) input.value = String(state.pageSize);
  }

  function scheduleAutoPageSizeCheck() {
    if (state.pageSize !== "auto") return;
    if (playbackInProgress()) return;
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

  const state = {
    category: "",
    folder: "",
    query: "",
    sort: "mtime_desc",
    page: 1,
    pageSize: "auto",
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
    libraryId: "",
    libraries: [],
    playlistSort: "page",
    playlistAutoplay: true,
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
  };

  let thumbProgressManualExpand = false;
  let lastThumbProgressGlobal = null;
  let searchTimer = null;
  let thumbRetryTimers = {};
  let progressTimer = null;
  let progressPollMs = 8000;
  let lastProgressSig = "";
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
      if (saved.pageSize !== undefined) {
        const ps = saved.pageSize;
        if (ps === "auto") state.pageSize = "auto";
        else state.pageSize = ps === 28 ? 32 : ps === 56 ? 64 : ps;
      }
      if (saved.libraryId !== undefined) state.libraryId = saved.libraryId;
      if (saved.playlistSort) state.playlistSort = saved.playlistSort;
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
      libraryId: state.libraryId,
      playlistSort: state.playlistSort,
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
      $("#search").value = "";
    }
    renderLibrarySwitcher();
    updateViewModeButtons();
    await loadPlayerSettings();
    updatePotplayerPathVisibility();
    await loadCategories();
    await loadVideos({ forceRebuild: true });
    loadProgress();
    updateUrl();
    saveState();
    connectSSE(true);
  }

  function currentLibraryAlias() {
    const lib = state.libraries.find(l => l.id === state.libraryId);
    return lib?.alias || state.libraryId || "";
  }

  const SETTINGS_DEFAULTS = {
    player_mode: "html5",
    thumb_position: 0.6,
    thumb_random_min: 0.5,
    thumb_random_max: 0.8,
    thumb_workers: 3,
    thumb_idle_scan: false,
    default_page_size: -1,
    potplayer_path: "",
    history_retention_days: 180,
    hls_large_h264: false,
    hls_moov_end_h264: false,
    html5_fragmented_mp4: "external",
    html5_playlist_autoplay: true,
    html5_resume_playback: true,
    html5_wheel_seek_sec: 5,
    thumb_progress_bar: "auto",
  };

  function normalizeWheelSeekSec(raw) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(120, Math.max(1, n));
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

  function normalizePlayerMode(mode) {
    const m = (mode || SETTINGS_DEFAULTS.player_mode).trim().toLowerCase();
    return m === "smart" ? "html5" : m;
  }

  function normalizeThumbProgressBar(mode) {
    const m = (mode || SETTINGS_DEFAULTS.thumb_progress_bar || "auto").trim().toLowerCase();
    if (m === "always" || m === "never") return m;
    return "auto";
  }

  function isThumbProgressIdle(global) {
    if (!global) return true;
    const failCount = global.failed ?? 0;
    const thumbWorkActive = (global.generating ?? 0) > 0
      || (global.queue_size ?? 0) > 0
      || (global.missing ?? 0) > 0;
    const notReady = Math.max(0, (global.total ?? 0) - (global.ready ?? 0));
    return !thumbWorkActive && failCount === 0 && notReady === 0;
  }

  function updateProgressBarVisibility(global) {
    const mode = normalizeThumbProgressBar(state.thumbProgressBar);
    const idle = isThumbProgressIdle(global);
    if (!idle) thumbProgressManualExpand = false;

    let showBar;
    if (mode === "always") showBar = true;
    else if (mode === "never") showBar = false;
    else showBar = !idle || thumbProgressManualExpand;

    $("#progress-bar-wrap")?.classList.toggle("progress-bar-collapsed", !showBar);

    const chip = $("#thumb-status-chip");
    const dot = chip?.querySelector(".thumb-status-dot");
    if (!chip || !dot) return;
    const showChip = mode === "auto" && idle;
    chip.classList.toggle("hidden", !showChip);
    chip.classList.toggle("thumb-status-chip--expanded", showChip && thumbProgressManualExpand);
    chip.setAttribute("aria-expanded", showChip && thumbProgressManualExpand ? "true" : "false");
    chip.title = thumbProgressManualExpand ? "点击收起缩略图进度" : "缩略图状态，点击展开详情";
    dot.classList.remove("thumb-status-dot--ok", "thumb-status-dot--busy", "thumb-status-dot--fail");
    if (!showChip || !global) return;
    const failCount = global.failed ?? 0;
    const busy = (global.generating ?? 0) > 0
      || (global.queue_size ?? 0) > 0
      || (global.missing ?? 0) > 0;
    if (failCount > 0) dot.classList.add("thumb-status-dot--fail");
    else if (busy) dot.classList.add("thumb-status-dot--busy");
    else dot.classList.add("thumb-status-dot--ok");
  }

  function toggleThumbProgressBar() {
    const mode = normalizeThumbProgressBar(state.thumbProgressBar);
    if (mode !== "auto" || !isThumbProgressIdle(lastThumbProgressGlobal)) return;
    thumbProgressManualExpand = !thumbProgressManualExpand;
    updateProgressBarVisibility(lastThumbProgressGlobal);
  }

  function fillSettingsForm(raw) {
    const s = { ...SETTINGS_DEFAULTS, ...(raw || {}) };
    state.playerMode = normalizePlayerMode(s.player_mode);
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val ?? "";
    };
    setVal("set-position", s.thumb_position);
    setVal("set-random-min", s.thumb_random_min);
    setVal("set-random-max", s.thumb_random_max);
    setVal("set-workers", s.thumb_workers);
    setVal("set-idle-scan", String(!!s.thumb_idle_scan));
    setVal("set-thumb-progress-bar", normalizeThumbProgressBar(s.thumb_progress_bar));
    state.thumbProgressBar = normalizeThumbProgressBar(s.thumb_progress_bar);
    setVal("set-page-size", String(s.default_page_size === -1 ? -1 : (s.default_page_size ?? -1)));
    setVal("set-potplayer", s.potplayer_path || "");
    setVal("set-history-days", s.history_retention_days ?? 180);
    setVal("set-hls-large-h264", String(!!s.hls_large_h264));
    setVal("set-hls-moov-end-h264", String(!!s.hls_moov_end_h264));
    setVal("set-html5-fragmented-mp4", s.html5_fragmented_mp4 || "external");
    setVal("set-html5-playlist-autoplay", String(s.html5_playlist_autoplay !== false));
    setVal("set-html5-resume-playback", String(s.html5_resume_playback !== false));
    setVal("set-html5-wheel-seek-sec", String(normalizeWheelSeekSec(s.html5_wheel_seek_sec ?? SETTINGS_DEFAULTS.html5_wheel_seek_sec)));
    state.playlistAutoplay = s.html5_playlist_autoplay !== false;
    state.resumePlayback = s.html5_resume_playback !== false;
    state.wheelSeekSec = normalizeWheelSeekSec(s.html5_wheel_seek_sec ?? SETTINGS_DEFAULTS.html5_wheel_seek_sec);
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
      : state.pageSize === "auto"
        ? `第 ${page} / ${totalPages} 页 · 本页 ${pageSize}`
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

  function isBrowseHome() {
    return state.viewMode === "browse"
      && !state.category
      && !state.folder
      && !state.query
      && state.page <= 1;
  }

  function goHome() {
    state.viewMode = "browse";
    state.category = "";
    state.folder = "";
    state.query = "";
    state.page = 1;
    const search = $("#search");
    if (search) search.value = "";
    updateViewModeButtons();
    saveState();
    loadCategories();
    loadVideos({ forceRebuild: true });
  }

  function setViewMode(mode) {
    const prev = state.viewMode;
    if (mode === "browse") {
      state.viewMode = "browse";
    } else {
      state.viewMode = mode;
      if (prev !== mode) {
        state.category = "";
        state.folder = "";
      }
    }
    if (prev === state.viewMode) return;
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
    if (key === "page") return list;
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
    else {
      if (state.category) params.set("category", state.category);
      if (state.category && !state.query) params.set("folder", state.folder || "");
    }
    if (state.query) params.set("q", state.query);
    params.set("sort", playlistApiSort());
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

  function thumbFormatBadgeHtml(v) {
    if (v.formatBadge === "remuxable") {
      return '<span class="thumb-format-badge thumb-format-badge--remuxable" title="碎片化 H.264 MP4，可流复制修复为标准格式">可修复</span>';
    }
    if (v.formatBadge !== "non_standard") return "";
    return '<span class="thumb-format-badge" title="非标准格式（碎片化/转码/伪装等），建议 PotPlayer 或修复">非标准</span>';
  }

  function renderThumbHtml(v) {
    const badge = thumbFormatBadgeHtml(v);
    if (v.thumbReady) {
      const bust = thumbCacheKey(v);
      return `<img src="${libThumbUrl(v.id, bust)}" alt="${esc(v.title)}" loading="lazy">${badge}`;
    }
    if (v.thumbStatus === "failed") {
      const hint = v.thumbError || "缩略图失败";
      let label = "缩略图失败";
      if (hint.includes("图片")) label = "非视频文件";
      else if (hint.includes("分辨率")) label = "占位文件";
      return `<div class="thumb-placeholder failed" title="${esc(hint)}">${esc(label)}</div>${badge}`;
    }
    if (v.thumbStatus === "generating") {
      return `<div class="thumb-placeholder">生成中...</div>${badge}`;
    }
    if (v.thumbStatus === "queued") {
      return `<div class="thumb-placeholder">排队中...</div>${badge}`;
    }
    return `<div class="thumb-placeholder">等待中...</div>${badge}`;
  }

  let formatBadgePollTimer = null;

  function patchGridFormatBadges() {
    state.pageItems.forEach(v => {
      const wrap = document.getElementById(`thumb-${v.id}`);
      if (!wrap) return;
      let badge = wrap.querySelector(".thumb-format-badge");
      const html = thumbFormatBadgeHtml(v);
      if (html) {
        if (badge) badge.outerHTML = html;
        else wrap.insertAdjacentHTML("beforeend", html);
      } else if (badge) {
        badge.remove();
      }
    });
  }

  function scheduleFormatBadgePoll() {
    clearTimeout(formatBadgePollTimer);
    let left = 8;
    const tick = async () => {
      const need = state.pageItems
        .filter(v => !v.formatBadge && /\.(mp4|m4v|mov)$/i.test(v.filename || v.title || ""))
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
    formatBadgePollTimer = setTimeout(tick, 1500);
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

  async function loadVideos({ forceRebuild = false, keepPlayerOpen = false } = {}) {
    if (!forceRebuild && !keepPlayerOpen && playbackInProgress()) return;
    if (state.playerViewOpen && !keepPlayerOpen) await hideHtml5Player();
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
      syncPlayerPlaylistAfterGridReload();
      renderPlayerPlaylist();
      highlightPlayingCard();
      scheduleFormatBadgePoll();
      if (state.pageSize === "auto") {
        lastAutoPageSize = getEffectivePageSize();
        reconcileAutoPageSizeAfterRender();
      }
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
    syncPlayerPlaylistAfterGridReload();
    renderPlayerPlaylist();
    highlightPlayingCard();
    scheduleFormatBadgePoll();
    if (state.pageSize === "auto") {
      lastAutoPageSize = getEffectivePageSize();
      reconcileAutoPageSizeAfterRender();
    }
  }

  function updateUrl() {
    const applyPlay = (params) => {
      if (state.playerViewOpen && state.playingId) {
        params.set("play", state.playingId);
      }
      const qs = params.toString();
      history.replaceState(null, "", qs ? `/?${qs}` : "/");
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
    if (isBrowseHome()) {
      const params = new URLSearchParams();
      if (state.pageSize !== "auto" && state.pageSize !== 32 && state.pageSize !== 0) {
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
    if (state.pageSize === "auto") params.set("size", "auto");
    else if (state.pageSize !== 0) params.set("size", String(state.pageSize));
    applyPlay(params);
  }

  function parseUrl() {
    const params = new URLSearchParams(location.search);
    const view = params.get("view");
    if (view === "favorites") {
      state.viewMode = "favorites";
      state.category = "";
      state.folder = "";
    } else if (view === "history") {
      state.viewMode = "history";
      state.category = "";
      state.folder = "";
    } else {
      state.viewMode = "browse";
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
      state.pageSize = s === "auto" ? "auto" : (parseInt(s, 10) || 32);
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
    }, 1500);
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

      lastThumbProgressGlobal = global;
      updateProgressBarVisibility(global);
    } catch (e) {
      $("#progress-text").textContent = "缩略图: 状态获取失败";
      updateProgressBarVisibility(lastThumbProgressGlobal);
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
        <div class="player-pl-thumb">${renderThumbHtml(v)}</div>
        <div class="player-pl-meta min-w-0">
          <p class="truncate text-xs font-medium">${esc(v.title || v.filename)}</p>
          <p class="truncate text-[10px] text-zinc-600">${esc(v.filename)}</p>
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
      el.innerHTML = '<p class="px-2 py-4 text-center text-xs text-zinc-600">当前列表无视频</p>';
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
      $("#player-view")?.classList.add("hidden");
      $("#player-view")?.classList.remove("flex");
      $("#gallery-view")?.classList.remove("hidden");
      $("#gallery-toolbar")?.classList.remove("hidden");
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

  function openPlayerView(item, { scrollToActive = true } = {}) {
    if (!item?.id) return;
    const entering = !state.playerViewOpen;
    state.playingId = item.id;
    state.playerViewOpen = true;
    $("#gallery-view")?.classList.add("hidden");
    $("#gallery-toolbar")?.classList.add("hidden");
    const view = $("#player-view");
    view?.classList.remove("hidden");
    view?.classList.add("flex");
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
      updateUrl();
      bindPlaylistInfiniteScroll();
    };

    initPlayerPlaylistIfNeeded();

    if (!entering && state.playlistItems.some(v => v.id === item.id)) {
      renderPlayerPlaylist(false);
      updatePlayerPlaylistActive();
      if (scrollToActive) scrollPlaylistToActive();
      highlightPlayingCard();
      updatePlayerFavoriteButton(item);
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
    prefetchPlaylistIfNeeded();
    prefetchAdjacentPlayInfo(1);
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

      await startDirectStream(id, base, session, info);
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
          ? "流复制重封装为标准 MP4（不重新编码，仅碎片化 H.264）"
          : (remuxReason || "仅碎片化 H.264 MP4 支持修复");
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

  async function finishRemuxRefreshInPlace(id) {
    state.playSession += 1;
    pendingPlayId = null;
    hidePlayOverlay();

    const clearBadge = (item) => {
      if (item && item.id === id) item.formatBadge = null;
    };
    clearBadge(getItemById(id));
    state.pageItems.forEach(clearBadge);
    patchGridFormatBadges();

    const item = getItemById(id) || { id, title: id, filename: "", path: "" };
    if (state.playerViewOpen && state.playingId === id) {
      void playVideoHtml5(id, item);
      return;
    }
    if (state.playerViewOpen) {
      highlightPlayingCard();
    }
  }

  async function runVideoRemux(id, item, { batchLabel = "" } = {}) {
    const session = ++state.playSession;
    pendingPlayId = null;
    detachVideoStream(getPlaybackVideo(), { hard: true });
    await stopActiveSlice();
    const base = item || { id, title: id, filename: "", path: "" };
    const overlayTitle = batchLabel ? `修复视频（${batchLabel}）` : "修复视频";
    showPlayOverlay(overlayTitle, "正在启动重封装…", { indeterminate: true, item: base });
    try {
      const start = await api(`/api/videos/${id}/remux`, { method: "POST" });
      if (!start.ok) throw new Error(start.error || "无法开始修复");
      while (true) {
        if (session !== state.playSession) return;
        const st = await api(`/api/videos/${id}/remux`);
        if (st.state === "queued" || st.state === "running") {
          updatePlayOverlay(
            "正在修复",
            st.message || "重封装中（流复制，不重新编码）…",
            {
              progress: st.progress_pct > 0 ? st.progress_pct : null,
              indeterminate: !st.progress_pct || st.progress_pct <= 0,
              item: base,
            },
          );
        }
        if (st.state === "done") {
          await finishRemuxRefreshInPlace(id);
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
        alert(info.remux_reason || "当前视频不支持修复为标准 MP4。\n\n仅碎片化 H.264 MP4 可流复制修复。");
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
      alert("所选视频中没有可修复的碎片化 H.264 MP4。\n\n仅碎片化 MP4 支持「流复制」修复；AV1/HEVC 等请用 PotPlayer。");
      return;
    }
    const skipped = ids.length - remuxable.length;
    const skipHint = skipped > 0 ? `\n（已跳过 ${skipped} 个不可修复项）` : "";
    if (!confirm(`将依次修复 ${remuxable.length} 个视频为标准 MP4（流复制，不重新编码）。${skipHint}\n\n修复期间请勿播放同一文件。继续？`)) {
      return;
    }
    try {
      await api("/api/remux/batch/begin", { method: "POST" });
      for (let i = 0; i < remuxable.length; i++) {
        const { id, title } = remuxable[i];
        const label = `${i + 1}/${remuxable.length}`;
        await runVideoRemux(id, { id, title, filename: "", path: "" }, { batchLabel: label });
      }
    } finally {
      await api("/api/remux/batch/end", { method: "POST" }).catch(() => {});
    }
    patchGridFormatBadges();
    scheduleFormatBadgePoll();
    void loadVideos({ forceRebuild: true });
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
    parkVideoEngine();
    $("#player-view")?.classList.add("hidden");
    $("#player-view")?.classList.remove("flex");
    $("#gallery-view")?.classList.remove("hidden");
    $("#gallery-toolbar")?.classList.remove("hidden");
    state.playingId = null;
    state.playlistItems = [];
    state.playlistCanLoadMore = false;
    playlistScrollObserver?.disconnect();
    playlistScrollObserver = null;
    highlightPlayingCard();
    updateUrl();
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
    state.ctxTarget = id;
    const item = getItemById(id);
    const favBtn = $("#ctx-menu")?.querySelector('[data-action="fav-toggle"]');
    if (favBtn) favBtn.textContent = item?.favorited ? "取消收藏" : "加入收藏";
    const remuxBtn = $("#ctx-menu")?.querySelector('[data-action="remux"]');
    if (remuxBtn) {
      const show = item?.formatBadge === "remuxable";
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
    if (size === "auto") {
      state.pageSize = "auto";
    } else {
      const n = Number(size);
      if (!Number.isFinite(n) || n < 0) return;
      state.pageSize = n === 0 ? 0 : Math.min(999, Math.max(1, Math.floor(n)));
    }
    state.page = 1;
    if (state.pageSize === "auto") {
      lastAutoPageSize = computeAutoPageSize(measureRenderedGridColumns() || undefined);
    }
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
    const rMin = parseFloat($("#set-random-min")?.value);
    const rMax = parseFloat($("#set-random-max")?.value);
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
          thumb_random_min: rMin,
          thumb_random_max: rMax,
          thumb_workers: workers,
          thumb_idle_scan: $("#set-idle-scan")?.value === "true",
          thumb_progress_bar: normalizeThumbProgressBar($("#set-thumb-progress-bar")?.value),
          default_page_size: (() => {
            const raw = $("#set-page-size")?.value;
            if (raw === "-1") return -1;
            return parseInt(raw, 10);
          })(),
          potplayer_path: $("#set-potplayer")?.value || "",
          player_mode: document.querySelector('input[name="player-mode"]:checked')?.value || SETTINGS_DEFAULTS.player_mode,
          hls_large_h264: $("#set-hls-large-h264")?.value === "true",
          hls_moov_end_h264: $("#set-hls-moov-end-h264")?.value === "true",
          html5_fragmented_mp4: $("#set-html5-fragmented-mp4")?.value || "external",
          html5_playlist_autoplay: $("#set-html5-playlist-autoplay")?.value === "true",
          html5_resume_playback: $("#set-html5-resume-playback")?.value === "true",
          html5_wheel_seek_sec: normalizeWheelSeekSec($("#set-html5-wheel-seek-sec")?.value),
          history_retention_days: historyDays,
          scope: "global",
        }),
      });
      state.playerMode = document.querySelector('input[name="player-mode"]:checked')?.value || SETTINGS_DEFAULTS.player_mode;
      state.playlistAutoplay = $("#set-html5-playlist-autoplay")?.value === "true";
      state.resumePlayback = $("#set-html5-resume-playback")?.value === "true";
      state.wheelSeekSec = normalizeWheelSeekSec($("#set-html5-wheel-seek-sec")?.value);
      state.thumbProgressBar = normalizeThumbProgressBar($("#set-thumb-progress-bar")?.value);
      $("#settings-dialog")?.close();
      loadProgress();
      if ($("#set-idle-scan")?.value === "true") {
        alert("已开启全库后台补全，顶部进度条将显示详细进度。");
      }
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

  $("#btn-page-size-auto")?.addEventListener("click", () => setPageSize("auto"));
  $("#btn-page-size-all")?.addEventListener("click", () => setPageSize(0));
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
  $("#btn-show-failed-list").addEventListener("click", showFailedDialog);
  $("#btn-retry-all-failed").addEventListener("click", retryAllFailed);
  $("#failed-dialog-close").addEventListener("click", () => $("#failed-dialog")?.close());
  $("#failed-dialog-retry-all").addEventListener("click", retryAllFailed);

  $("#btn-player-prev").addEventListener("click", () => playAdjacentVideo(-1));
  $("#btn-player-next").addEventListener("click", () => playAdjacentVideo(1));
  $("#player-playlist-sort")?.addEventListener("change", async (e) => {
    state.playlistSort = e.target.value;
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
    else if (action === "remux") {
      const v = getItemById(id);
      await runVideoRemux(id, v || { id, title: id, filename: "", path: "" });
    }
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
  document.addEventListener("click", (e) => {
    if (!thumbProgressManualExpand) return;
    const wrap = $("#progress-bar-wrap");
    const chip = $("#thumb-status-chip");
    if (wrap?.contains(e.target) || chip?.contains(e.target)) return;
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
  bindPlayerStageWheelSeek();
  loadState();
  syncPlaylistSortSelect();
  parseUrl();
  $("#sort").value = state.sort;
  if (state.pageSize === "auto") {
    lastAutoPageSize = computeAutoPageSize();
  }
  syncPageSizeControls();

  const galleryViewEl = $("#gallery-view");
  if (galleryViewEl && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => scheduleAutoPageSizeCheck());
    ro.observe(galleryViewEl);
  }
  window.addEventListener("resize", () => scheduleAutoPageSizeCheck());

  loadLibraries().then(() => loadPlayerSettings()).then(() => updatePotplayerPathVisibility());
  updateViewModeButtons();
  loadCategories().then(() => {
    loadVideos({ forceRebuild: true }).then(async () => {
      await loadProgress();
      await tryRestorePlayback();
    });
  });
  connectSSE();
  progressTimer = setInterval(loadProgress, progressPollMs);
})();
