import 'movi-player/element'
import { MoviElement } from 'movi-player/element'
import type { AudioTrack, MoviPlayer, SubtitleTrack } from 'movi-player/player'

export interface MoviPlaybackHandlers {
  onReady?: () => void
  onTime?: (seconds: number) => void
  onEnded?: () => void
  onError?: (err: unknown) => void
  onSeeked?: (seconds: number) => void
  onStateChange?: (state: string) => void
}

/**
 * <movi-player> web 组件在运行时暴露 .player（核心 MoviPlayer 实例），但它在公共类型里是
 * 私有的，无法直接访问。用局部断言桥接，避免 any。
 */
function getCore(el: MoviElement | null): MoviPlayer | undefined {
  return (el as unknown as { player?: MoviPlayer } | null)?.player
}

/**
 * 创建 <movi-player> 自定义元素实例。
 *
 * 根因（已在真实浏览器验证）：movi-player@0.3.5 的 MoviElement 构造函数会在
 * createControls → setupControlHandlers → setupKeyboardShortcuts 调用链里
 * `setAttribute("tabindex", "0")`，违反 Custom Elements 规范
 * （"The element must not gain any attributes"）。因此对已注册元素调用
 * `document.createElement('movi-player')` 时：
 *   - 部分 Chromium 会抛 NotSupportedError: The result must not have attributes；
 *   - 另一些版本（含 Chrome 150）静默返回不可用的 HTMLUnknownElement
 *     （构造函数未执行：无 shadowRoot、无 player、永不派发 statechange）。
 * 两种失败形态都会导致播放器永久卡在"加载视频 正在分析…"，与视频内容无关。
 *
 * 绕过办法：直接 `new MoviElement()`（导入类本身）跳过 createElement 工厂的
 * 属性校验。new 出来的实例仍走完整自定义元素生命周期（connectedCallback、
 * attributeChangedCallback 正常触发），端到端验证播放正常（statechange 可达
 * ready/playing）。
 *
 * ⚠️ 必须同时校验"抛错"与"产物类型"两种失败：只 catch 抛错在 Chrome 150 上
 * 会漏掉静默返回 HTMLUnknownElement 的情况。
 */
function createMoviElement(): MoviElement {
  const registered =
    typeof customElements !== 'undefined' && !!customElements.get('movi-player')
  if (!registered) {
    console.error(
      '[LocGallery] <movi-player> 尚未注册，播放将无法初始化（customElements.define 可能未执行）',
    )
  }
  try {
    const el = document.createElement('movi-player') as MoviElement
    if (el instanceof MoviElement && el.shadowRoot) {
      return el
    }
    console.warn(
      '[LocGallery] createElement 产物不可用（构造函数未执行，got ' +
        el.constructor.name +
        '），回退到 new MoviElement()',
    )
  } catch (err) {
    console.warn(
      '[LocGallery] document.createElement("movi-player") 抛错，回退到 new MoviElement()',
      err,
    )
  }
  return new MoviElement()
}

/**
 * 用 <movi-player> web 组件（自带的 canvas 渲染 + 完整控件 + Shadow DOM 字幕渲染）
 * 承载播放。库自带字幕 CSS，无需在宿主侧手抄 .movi-subtitle-* 样式。
 *
 * 与早期 MoviPlayer 核心（canvas）入口不同，web 组件自己管理字幕 overlay 与控件，
 * 这里只做薄封装：创建元素、挂到宿主、转发事件、提供选轨/默认字幕等便捷方法。
 */
export function createMoviPlayer(
  host: HTMLElement,
  url: string,
  handlers: MoviPlaybackHandlers = {},
  opts: { startAt?: number; noHotkeys?: boolean; seekPreview?: boolean } = {},
) {
  let el: MoviElement | null = null
  let activeAudioTrackId: number | null = null
  let activeSubtitleTrackId: number | null = null
  const teardowns: Array<() => void> = []

  function bindEvents(target: MoviElement) {
    const onTime = (e: Event) => handlers.onTime?.((e as CustomEvent<number>).detail)
    const onEnded = () => handlers.onEnded?.()
    const onError = (e: Event) => handlers.onError?.((e as CustomEvent<unknown>).detail)
    // web 组件不派发 loadeddata；以 statechange 的状态机为准：
    // 状态进入 ready / playing 即视为“已就绪”，首次触发时回调 onReady。
    let readyFired = false
    const onState = (e: Event) => {
      const state = (e as CustomEvent<string>).detail
      handlers.onStateChange?.(state)
      // 就绪后 movi 可能已按"移动端布局状态"重排中心按钮（96px 覆盖），
      // 每次状态变化都重新钉一次 inline 覆盖，保证三角形/进度条样式不被覆盖。
      if (el?.shadowRoot) applyInlineOverrides(el.shadowRoot)
      // 就绪后 video 元素才完整，幂等暴露到 light DOM（h5player 才能找到）+ 同步倍速
      if (el) exposeVideoAndSyncRate(el, host)
      if (!readyFired && (state === 'ready' || state === 'playing')) {
        readyFired = true
        handlers.onReady?.()
      }
    }
    const onTracks = () => {
      // 默认选中文/第一条字幕（库本身不自动选）
      const pick = pickDefaultSubtitle(getCore(target)?.getSubtitleTracks() ?? [])
      if (pick) {
        activeSubtitleTrackId = pick.id
        void getCore(target)?.selectSubtitleTrack(pick.id)
      } else {
        activeSubtitleTrackId = null
      }
    }
    target.addEventListener('timeupdate', onTime)
    target.addEventListener('ended', onEnded)
    target.addEventListener('error', onError)
    target.addEventListener('statechange', onState)
    target.addEventListener('trackschange', onTracks)
    teardowns.push(() => {
      target.removeEventListener('timeupdate', onTime)
      target.removeEventListener('ended', onEnded)
      target.removeEventListener('error', onError)
      target.removeEventListener('statechange', onState)
      target.removeEventListener('trackschange', onTracks)
    })
  }

  function setup() {
    const node = createMoviElement()
    node.setAttribute('theme', 'dark')
    node.setAttribute('controls', '')
    node.setAttribute('playsinline', '')
    node.setAttribute('autoplay', '')
    if (opts.startAt && opts.startAt > 0) {
      node.setAttribute('startat', String(opts.startAt))
    }
    // nohotkeys：关闭 movi-player 内置键盘快捷键（空格/方向键/z/x 等），
    // 避免与油猴等全局快捷键脚本冲突（其 keydown 处理会 preventDefault 吞掉按键）。
    if (opts.noHotkeys) {
      node.setAttribute('nohotkeys', '')
    }
    // thumb：开启进度条悬停时间点截图（movi-player 原生：第二个 WASM 上下文
    // Range seek 解码目标帧，零预生成/零磁盘；由设置 html5_seek_preview 控制）。
    if (opts.seekPreview) {
      node.setAttribute('thumb', '')
    }
    // 关键：src 必须在 appendChild（触发 connectedCallback）之前作为 attribute 设置，
    // 否则 connectedCallback 内 getAttribute('src') 为 null → 不调用 initializePlayer()，
    // 后续 property 赋值虽会走到 load()，但 load() 不会创建 player，导致永远加载中无事件。
    node.setAttribute('src', url)
    el = node
    bindEvents(node)
    host.appendChild(node)
    injectCenterButtonStyle(node)
    exposeVideoAndSyncRate(node, host)
  }

  /** 把 movi 内部 <video> 暴露到 light DOM，并同步倍速给 movi。
   *  背景：h5player 等油猴脚本用 document.querySelector('video') 找视频——列表页
   *  预览是普通 <video> 所以生效；播放页 movi 的 video 在 shadowRoot 内（默认
   *  display:none，canvas 渲染）脚本找不到。且 movi 用独立解码时钟（_playbackRate
   *  驱动 WASM 解码），直接改 video.playbackRate 不会变速——需监听 video 的
   *  ratechange，同步给元素 playbackRate（MoviElement setter → updatePlaybackRate）。
   *  幂等：video 已在 light DOM / 已绑 ratechange 则跳过（statechange 会重复调用）。 */
  function exposeVideoAndSyncRate(node: MoviElement, host: HTMLElement) {
    const root = node.shadowRoot
    const video = root?.querySelector<HTMLVideoElement>('video')
    if (!video) return
    if (video.parentElement !== host) {
      // 移到 light DOM：保留 movi 的 inline 样式（display 由 movi 在 canvas/video
      // 渲染模式间切换），补绝对定位避免在流内占位、保证铺满宿主。
      video.style.position = 'absolute'
      video.style.left = '0'
      video.style.top = '0'
      video.style.width = '100%'
      video.style.height = '100%'
      video.style.objectFit = 'contain'
      video.style.zIndex = '0'
      host.appendChild(video)
    }
    if (!video.dataset.rateSynced) {
      video.dataset.rateSynced = '1'
      video.addEventListener('ratechange', () => {
        try {
          if (node.playbackRate !== video.playbackRate) {
            node.playbackRate = video.playbackRate
          }
        } catch {
          // movi 未就绪时忽略
        }
      })
    }
  }

  /** 播放器 UI 定制（shadowRoot 为 open 模式，可注入覆盖样式；appendChild 后
   *  组件已注入自身样式，覆盖规则带 !important 保证胜出）：
   *  ① 中间播放按钮：暂停时只显示三角形（去掉圆形背景），播放中不出现暂停图标；
   *  ② 三角形放大到 150px（原生 50px 的 3 倍）并圆角化（CSS d 覆盖 path，Chromium 106+ 支持）；
   *  ③ 已播放进度条改白色（其余进度条保持 movi 原生样式与交互，截图功能由
   *     setup 的 thumb 属性提供，与样式无关）；
   *  ④ 去掉载入转圈动画（隐藏 .movi-loader-container）。
   *  ⚠️ 关键：movi 在「移动端布局状态」下有 `.movi-center-play-pause svg { width:50px
   *  !important }` 和 `.movi-center-play-pause { width:96px !important }`（MoviElement.js
   *  ~11042，点击/控制栏可见等状态会触发），实测会把三角形压到 96px 宽——纯 CSS 覆盖
   *  不够稳。因此 CSS 注入后必须再用 inline style + important 直接钉死（inline+important
   *  是最高优先级，任何样式表规则都覆盖不了），并在 ready 时再补一次。 */
  function injectCenterButtonStyle(node: MoviElement) {
    const root = node.shadowRoot
    if (!root) {
      // 极端情况：connectedCallback 未同步创建 shadowRoot，延迟一帧重试
      requestAnimationFrame(() => injectCenterButtonStyle(node))
      return
    }
    const style = document.createElement('style')
    style.textContent = `
      /* ① 中间播放按钮：仅三角形，无圆形背景 */
      .movi-center-play-pause {
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
      }
      /* 播放中不出现暂停图标（乐观切换的 pause 也被禁用） */
      .movi-center-icon-pause {
        display: none !important;
      }
      /* ② 三角形：原生 50px 的 3 倍（150px）且圆角（三尖角用 Q 曲线过渡）。
         CSS 层仅作常规覆盖；最终尺寸靠下方 inline style 兜底。 */
      .movi-center-icon-play {
        width: 150px !important;
        height: 150px !important;
        transform: none !important;
      }
      .movi-center-icon-play path {
        d: path("M9.5 6.5 L17.8 11.3 Q19.5 12 17.8 12.7 L9.5 17.5 Q8 19 6.5 17.5 L6.5 6.5 Q8 5 9.5 6.5 Z");
      }
      /* ③ 已播放部分：白色（movi 默认 background: var(--movi-primary)，双保险防渐变） */
      .movi-progress-filled {
        background: #ffffff !important;
        background-image: none !important;
      }
      /* ④ 去掉载入转圈动画（.movi-loader-container 是 64px border-top 旋转圆环） */
      .movi-loader-container {
        display: none !important;
      }
    `
    root.appendChild(style)
    applyInlineOverrides(root)
  }

  /** 用 inline style + important 钉死关键视觉（最高优先级，movi 样式表无法覆盖）：
   *  三角形 150px；已播进度条白色。
   *  ⚠️ 已确认的坑：movi 在「移动端布局状态」（点击/控制栏可见时）会给按钮
   *  `.movi-center-play-pause { width: 96px }`，按钮是 flex 容器，svg 是 flex item，
   *  默认 flex-shrink 会把 150px 图标收缩到 96px（实测 96×150）——只设 width/height
   *  无效，必须同时：① 按钮尺寸放开（auto）② icon 加 flex:none + min-width/min-height。 */
  function applyInlineOverrides(root: ShadowRoot) {
    const btn = root.querySelector<HTMLElement>('.movi-center-play-pause')
    if (btn) {
      // 放开按钮容器约束，避免 flex 收缩图标
      btn.style.setProperty('width', 'auto', 'important')
      btn.style.setProperty('height', 'auto', 'important')
      btn.style.setProperty('min-width', '0', 'important')
      btn.style.setProperty('min-height', '0', 'important')
    }
    const icon = root.querySelector<HTMLElement>('.movi-center-icon-play')
    if (icon) {
      icon.style.setProperty('width', '150px', 'important')
      icon.style.setProperty('height', '150px', 'important')
      icon.style.setProperty('min-width', '150px', 'important')
      icon.style.setProperty('min-height', '150px', 'important')
      icon.style.setProperty('flex', 'none', 'important')
      icon.style.setProperty('flex-shrink', '0', 'important')
      icon.style.setProperty('transform', 'none', 'important')
    }
    const filled = root.querySelector<HTMLElement>('.movi-progress-filled')
    if (filled) {
      filled.style.setProperty('background', '#ffffff', 'important')
      filled.style.setProperty('background-image', 'none', 'important')
    }
  }

  function play() {
    void el?.play()
  }

  function pause() {
    el?.pause()
  }

  function seek(seconds: number) {
    if (el) el.currentTime = seconds
  }

  function getCurrentTime(): number {
    return el?.currentTime ?? 0
  }

  function getDuration(): number {
    return el?.duration ?? 0
  }

  function getState(): string {
    return el?.paused ? 'paused' : 'playing'
  }

  function getAudioTracks(): AudioTrack[] {
    return getCore(el)?.getAudioTracks() ?? []
  }

  function selectAudioTrack(id: number) {
    activeAudioTrackId = id
    void getCore(el)?.selectAudioTrack(id)
  }

  function getActiveAudioTrackId(): number | null {
    return activeAudioTrackId
  }

  function getSubtitleTracks(): SubtitleTrack[] {
    return getCore(el)?.getSubtitleTracks() ?? []
  }

  function selectSubtitleTrack(id: number | null) {
    activeSubtitleTrackId = id
    void getCore(el)?.selectSubtitleTrack(id)
  }

  function getActiveSubtitleTrackId(): number | null {
    return activeSubtitleTrackId
  }

  /**
   * 默认字幕：优先中文（zh/chi 或标签含 中文/简体/繁体/國語），否则选第一条。
   */
  function pickDefaultSubtitle(tracks: SubtitleTrack[]): SubtitleTrack | null {
    if (tracks.length === 0) return null
    const zh = tracks.find((t) => {
      const lang = (t.language || '').toLowerCase()
      const label = (t.label || '').toLowerCase()
      return (
        lang.startsWith('zh') ||
        lang.startsWith('chi') ||
        /chinese|中文|简体|繁体|國語|国语/.test(label)
      )
    })
    return zh ?? tracks[0]
  }

  function selectDefaultSubtitle() {
    const pick = pickDefaultSubtitle(getCore(el)?.getSubtitleTracks() ?? [])
    if (pick) {
      activeSubtitleTrackId = pick.id
      void getCore(el)?.selectSubtitleTrack(pick.id)
    } else {
      activeSubtitleTrackId = null
    }
  }

  function setVolume(v: number) {
    if (el) el.volume = v
  }

  function setMuted(m: boolean) {
    if (el) el.muted = m
  }

  function getPaused(): boolean {
    return !!el?.paused
  }

  function getElement(): MoviElement | null {
    return el
  }

  function destroy() {
    teardowns.forEach((fn) => fn())
    teardowns.length = 0
    if (el) {
      try {
        el.src = ''
      } catch {
        /* ignore */
      }
      el.remove()
    }
    el = null
  }

  setup()

  return {
    play,
    pause,
    seek,
    getCurrentTime,
    getDuration,
    getState,
    getAudioTracks,
    selectAudioTrack,
    getActiveAudioTrackId,
    getSubtitleTracks,
    selectSubtitleTrack,
    getActiveSubtitleTrackId,
    selectDefaultSubtitle,
    setVolume,
    setMuted,
    getPaused,
    getElement,
    destroy,
  }
}
