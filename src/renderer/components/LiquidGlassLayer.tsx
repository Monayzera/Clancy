import React from 'react'
import { useGlassActive, useThemeStore } from '../theme'

export function LiquidGlassLayer() {
  const active = useGlassActive()
  const nativeGlass = useThemeStore((s) => s.nativeGlass)
  if (!active || nativeGlass) return null
  return <div aria-hidden className="lg-layer" />
}
