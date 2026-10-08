import { useThemeStore, isGlassActive } from '../theme'
import type { GlassRegion } from '../../shared/types'
import { measureBlob } from '../glassBlob'

const APPEARANCE_AUTOMATIC = 0
const STYLE_CLEAR = 1
const VARIANT_SYSTEM_DEFAULT = -1
const ADAPTIVE_OFF = 1
const SUBTLE_DIM: GlassRegion['tint'] = [0, 0, 0, 0.07]

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

function collectRegions(): GlassRegion[] {
  const regions: GlassRegion[] = []
  document.querySelectorAll<HTMLElement>('[data-glass]').forEach((element) => {
    const id = element.dataset.glass
    const layoutWidth = element.offsetWidth
    if (!id || layoutWidth === 0 || element.offsetHeight === 0) return
    const alpha = effectiveOpacity(element)
    if (alpha <= 0.001) return
    if (element.dataset.glassBlob !== undefined) {
      const blob = measureBlob(element)
      if (!blob) return
      regions.push({
        id,
        x: blob.x,
        y: blob.y,
        width: blob.width,
        height: blob.height,
        radius: 0,
        alpha: Math.round(alpha * 100) / 100,
        style: STYLE_CLEAR,
        appearance: APPEARANCE_AUTOMATIC,
        variant: VARIANT_SYSTEM_DEFAULT,
        adaptive: ADAPTIVE_OFF,
        tint: SUBTLE_DIM,
        paths: blob.paths,
      })
      return
    }
    const rect = element.getBoundingClientRect()
    const scale = rect.width / layoutWidth
    const radius = (Number(element.dataset.glassRadius) || 0) * scale
    regions.push({
      id,
      x: roundHalf(rect.left),
      y: roundHalf(rect.top),
      width: roundHalf(rect.width),
      height: roundHalf(rect.height),
      radius: roundHalf(radius),
      alpha: Math.round(alpha * 100) / 100,
      style: STYLE_CLEAR,
      appearance: APPEARANCE_AUTOMATIC,
      variant: VARIANT_SYSTEM_DEFAULT,
      adaptive: ADAPTIVE_OFF,
      tint: SUBTLE_DIM,
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
    send(collectRegions())
    frame = requestAnimationFrame(tick)
  }

  const start = () => {
    if (!frame && !disposed) frame = requestAnimationFrame(tick)
  }

  const unsubscribe = useThemeStore.subscribe(start)
  const unsubscribeTone = api.onGlassTone ? api.onGlassTone((tone) => useThemeStore.getState().setGlassTone(tone)) : () => {}
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
    unsubscribeTone()
    api.setGlassRegions([])
  }
}
