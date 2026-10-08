import { useThemeStore, isGlassActive } from '../theme'
import type { GlassRegion } from '../../shared/types'

const APPEARANCE_LIGHT = 1
const APPEARANCE_DARK = 2
const CLEAR_DIM_DARK: GlassRegion['tint'] = [0, 0, 0, 0.3]
const CLEAR_DIM_LIGHT: GlassRegion['tint'] = [1, 1, 1, 0.35]

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2
}

function effectiveOpacity(element: Element): number {
  let alpha = 1
  for (let node: Element | null = element; node && alpha > 0; node = node.parentElement) {
    const opacity = Number.parseFloat(getComputedStyle(node).opacity)
    if (Number.isFinite(opacity)) alpha *= opacity
  }
  return alpha
}

function collectRegions(appearance: number): GlassRegion[] {
  const regions: GlassRegion[] = []
  document.querySelectorAll<HTMLElement>('[data-glass]').forEach((element) => {
    const id = element.dataset.glass
    const layoutWidth = element.offsetWidth
    if (!id || layoutWidth === 0 || element.offsetHeight === 0) return
    const alpha = effectiveOpacity(element)
    if (alpha <= 0.001) return
    const rect = element.getBoundingClientRect()
    const scale = rect.width / layoutWidth
    const radius = (Number(element.dataset.glassRadius) || 0) * scale
    const clear = element.dataset.glassStyle === 'clear'
    regions.push({
      id,
      x: roundHalf(rect.left),
      y: roundHalf(rect.top),
      width: roundHalf(rect.width),
      height: roundHalf(rect.height),
      radius: roundHalf(radius),
      alpha: Math.round(alpha * 100) / 100,
      style: clear ? 1 : 0,
      appearance,
      tint: clear ? (appearance === APPEARANCE_DARK ? CLEAR_DIM_DARK : CLEAR_DIM_LIGHT) : null,
    })
  })
  return regions
}

export function initNativeGlass(): () => void {
  const api = window.clui
  if (!api?.isNativeGlassSupported || !api.setGlassRegions) return () => {}

  let disposed = false
  let frame = 0
  let lastPayload = ''

  const send = (regions: GlassRegion[]) => {
    const payload = JSON.stringify(regions)
    if (payload === lastPayload) return
    lastPayload = payload
    api.setGlassRegions(regions)
  }

  const tick = () => {
    frame = 0
    if (disposed) return
    const state = useThemeStore.getState()
    if (!state.nativeGlass || !isGlassActive(state)) {
      send([])
      return
    }
    send(collectRegions(state.isDark ? APPEARANCE_DARK : APPEARANCE_LIGHT))
    frame = requestAnimationFrame(tick)
  }

  const start = () => {
    if (!frame && !disposed) frame = requestAnimationFrame(tick)
  }

  const unsubscribe = useThemeStore.subscribe(start)
  api.isNativeGlassSupported()
    .then((supported) => {
      if (disposed) return
      useThemeStore.getState().setNativeGlass(supported)
      start()
    })
    .catch(() => {})

  return () => {
    disposed = true
    if (frame) cancelAnimationFrame(frame)
    unsubscribe()
    api.setGlassRegions([])
  }
}
