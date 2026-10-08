import React, { useLayoutEffect, useRef } from 'react'
import { useGlassActive, useThemeStore } from '../theme'
import { blobSvgPath, measureBlob } from '../glassBlob'

const STABLE_FRAMES = 8
const TRIGGER_EVENTS = ['pointerenter', 'pointerleave', 'transitionrun', 'transitionend', 'pointerdown', 'pointerup'] as const

export function GlassBlobLayer() {
  const active = useGlassActive()
  const nativeGlass = useThemeStore((s) => s.nativeGlass)
  const pathRef = useRef<SVGPathElement>(null)
  const enabled = active && !nativeGlass

  useLayoutEffect(() => {
    const path = pathRef.current
    const stack = path?.ownerSVGElement?.parentElement
    if (!enabled || !path || !stack) return

    let frame = 0
    let stableFrames = 0
    let lastPath = ''

    const update = () => {
      const blob = measureBlob(stack)
      const rect = stack.getBoundingClientRect()
      const scale = stack.offsetWidth > 0 ? rect.width / stack.offsetWidth : 1
      const next = blob ? blobSvgPath(blob.paths, blob.x - rect.left, blob.y - rect.top, scale) : ''
      if (next === lastPath) return false
      lastPath = next
      path.setAttribute('d', next)
      return true
    }

    const tick = () => {
      frame = 0
      try {
        stableFrames = update() ? 0 : stableFrames + 1
      } catch {
        stableFrames = STABLE_FRAMES
      }
      if (stableFrames < STABLE_FRAMES) frame = requestAnimationFrame(tick)
    }

    const wake = () => {
      stableFrames = 0
      if (!frame) frame = requestAnimationFrame(tick)
    }

    TRIGGER_EVENTS.forEach((type) => stack.addEventListener(type, wake))
    const observer = new ResizeObserver(wake)
    observer.observe(stack)
    window.addEventListener('resize', wake)
    try {
      update()
    } catch {
      lastPath = ''
    }
    wake()

    return () => {
      if (frame) cancelAnimationFrame(frame)
      TRIGGER_EVENTS.forEach((type) => stack.removeEventListener(type, wake))
      observer.disconnect()
      window.removeEventListener('resize', wake)
    }
  }, [enabled])

  if (!enabled) return null
  return (
    <svg aria-hidden className="lg-blob">
      <path ref={pathRef} />
    </svg>
  )
}
