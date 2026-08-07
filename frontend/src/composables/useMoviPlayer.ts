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
  opts: { startAt?: number; noHotkeys?: boolean } = {},
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
    // 关键：src 必须在 appendChild（触发 connectedCallback）之前作为 attribute 设置，
    // 否则 connectedCallback 内 getAttribute('src') 为 null → 不调用 initializePlayer()，
    // 后续 property 赋值虽会走到 load()，但 load() 不会创建 player，导致永远加载中无事件。
    node.setAttribute('src', url)
    el = node
    bindEvents(node)
    host.appendChild(node)
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
