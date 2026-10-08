import { useCallback, useEffect, useState } from 'react'
import { useGlassActive } from '../theme'

export interface GlassOptions {
  radius: number
  bezel: number
  thickness: number
  blur: number
  saturation: number
  brightness: number
}

export const GLASS_POPOVER: GlassOptions = { radius: 12, bezel: 18, thickness: 34, blur: 6, saturation: 1.7, brightness: 1.04 }

interface DisplacementMap {
  url: string
  scale: number
}

interface FilterHandle {
  filter: SVGFilterElement
  image: SVGFEImageElement
  displacement: SVGFEDisplacementMapElement
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const REFRACTIVE_INDEX = 1.5
const MAX_MAP_SIDE = 4096
const MAP_CACHE_LIMIT = 32
const MAP_REBUILD_DELAY_MS = 140
const mapCache = new Map<string, DisplacementMap>()
let defsRoot: SVGDefsElement | null = null
let filterSequence = 0

function surfaceHeight(t: number): number {
  return Math.pow(1 - Math.pow(1 - t, 4), 0.25)
}

function surfaceSlope(t: number): number {
  const step = 1e-3
  const a = Math.max(0, t - step)
  const b = Math.min(1, t + step)
  return (surfaceHeight(b) - surfaceHeight(a)) / (b - a)
}

function buildDisplacementMap(width: number, height: number, options: GlassOptions): DisplacementMap | null {
  const key = `${width}x${height}:${options.radius}:${options.bezel}:${options.thickness}`
  const cached = mapCache.get(key)
  if (cached) {
    mapCache.delete(key)
    mapCache.set(key, cached)
    return cached
  }
  if (width < 1 || height < 1 || width > MAX_MAP_SIDE || height > MAX_MAP_SIDE) return null

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null

  const centerX = width / 2
  const centerY = height / 2
  const halfWidth = centerX
  const halfHeight = centerY
  const radius = Math.min(options.radius, halfWidth, halfHeight)
  const bezel = Math.max(1, options.bezel)
  const offsetX = new Float32Array(width * height)
  const offsetY = new Float32Array(width * height)
  const rimWeight = new Float32Array(width * height)
  let maxOffset = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5 - centerX
      const py = y + 0.5 - centerY
      const qx = Math.abs(px) - (halfWidth - radius)
      const qy = Math.abs(py) - (halfHeight - radius)
      const signedDistance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
      const depth = -signedDistance
      if (depth <= 0 || depth >= bezel) continue

      let normalX: number
      let normalY: number
      if (qx > 0 && qy > 0) {
        const length = Math.hypot(qx, qy)
        normalX = qx / length
        normalY = qy / length
      } else if (qx > qy) {
        normalX = 1
        normalY = 0
      } else {
        normalX = 0
        normalY = 1
      }
      normalX *= px < 0 ? -1 : 1
      normalY *= py < 0 ? -1 : 1

      const incidence = Math.atan(surfaceSlope(depth / bezel) * options.thickness / bezel)
      const refraction = Math.asin(Math.sin(incidence) / REFRACTIVE_INDEX)
      const magnitude = Math.tan(incidence - refraction) * options.thickness
      const index = y * width + x
      offsetX[index] = -normalX * magnitude
      offsetY[index] = -normalY * magnitude
      rimWeight[index] = Math.pow(1 - depth / bezel, 0.6)
      if (magnitude > maxOffset) maxOffset = magnitude
    }
  }

  const image = context.createImageData(width, height)
  const normalizer = maxOffset > 0 ? maxOffset : 1
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    image.data[o] = Math.round(128 + (offsetX[i] / normalizer) * 127)
    image.data[o + 1] = Math.round(128 + (offsetY[i] / normalizer) * 127)
    image.data[o + 2] = Math.round(rimWeight[i] * 255)
    image.data[o + 3] = 255
  }
  context.putImageData(image, 0, 0)

  const map: DisplacementMap = { url: canvas.toDataURL('image/png'), scale: maxOffset * 2 }
  if (mapCache.size >= MAP_CACHE_LIMIT) {
    const oldest = mapCache.keys().next().value
    if (oldest !== undefined) mapCache.delete(oldest)
  }
  mapCache.set(key, map)
  return map
}

function ensureDefsRoot(): SVGDefsElement {
  if (defsRoot && defsRoot.isConnected) return defsRoot
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.position = 'absolute'
  svg.style.pointerEvents = 'none'
  const defs = document.createElementNS(SVG_NS, 'defs')
  svg.appendChild(defs)
  document.body.appendChild(svg)
  defsRoot = defs
  return defs
}

function primitive<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name)
  for (const [attribute, value] of Object.entries(attributes)) element.setAttribute(attribute, value)
  return element
}

function createFilter(id: string, width: number, height: number, map: DisplacementMap, options: GlassOptions): FilterHandle {
  const filter = primitive('filter', {
    id,
    x: '0',
    y: '0',
    width: String(width),
    height: String(height),
    filterUnits: 'userSpaceOnUse',
    'color-interpolation-filters': 'sRGB',
  })
  filter.appendChild(primitive('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: String(options.blur), result: 'frosted' }))
  const image = primitive('feImage', { href: map.url, x: '0', y: '0', width: String(width), height: String(height), preserveAspectRatio: 'none', result: 'map' })
  filter.appendChild(image)

  const displacement = primitive('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: String(map.scale), xChannelSelector: 'R', yChannelSelector: 'G', result: 'lens' })
  filter.appendChild(displacement)

  filter.appendChild(primitive('feColorMatrix', { in: 'map', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0', result: 'rim' }))
  filter.appendChild(primitive('feComposite', { in: 'lens', in2: 'rim', operator: 'in', result: 'rimLens' }))
  filter.appendChild(primitive('feComposite', { in: 'rimLens', in2: 'frosted', operator: 'over', result: 'refracted' }))
  filter.appendChild(primitive('feColorMatrix', { in: 'refracted', type: 'saturate', values: String(options.saturation), result: 'saturated' }))
  const transfer = primitive('feComponentTransfer', { in: 'saturated' })
  for (const channel of ['feFuncR', 'feFuncG', 'feFuncB'] as const) {
    transfer.appendChild(primitive(channel, { type: 'linear', slope: String(options.brightness), intercept: '0' }))
  }
  filter.appendChild(transfer)
  return { filter, image, displacement }
}

function resizeFilter(handle: FilterHandle, width: number, height: number): void {
  handle.filter.setAttribute('width', String(width))
  handle.filter.setAttribute('height', String(height))
  handle.image.setAttribute('width', String(width))
  handle.image.setAttribute('height', String(height))
}

function applyMap(handle: FilterHandle, map: DisplacementMap): void {
  handle.image.setAttribute('href', map.url)
  handle.displacement.setAttribute('scale', String(map.scale))
}

export function useLiquidGlass(options: GlassOptions): { ref: (element: HTMLElement | null) => void; filter: string | undefined } {
  const active = useGlassActive()
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [filterId] = useState(() => `clui-liquid-glass-${++filterSequence}`)
  const [ready, setReady] = useState(false)
  const ref = useCallback((node: HTMLElement | null) => setElement(node), [])
  const { radius, bezel, thickness, blur, saturation, brightness } = options

  useEffect(() => {
    if (!active || !element) return
    const resolved: GlassOptions = { radius, bezel, thickness, blur, saturation, brightness }
    let handle: FilterHandle | null = null
    let width = 0
    let height = 0
    let rebuildTimer: ReturnType<typeof setTimeout> | null = null

    const build = () => {
      rebuildTimer = null
      try {
        const map = buildDisplacementMap(width, height, resolved)
        if (!map) return
        if (handle) {
          applyMap(handle, map)
        } else {
          handle = createFilter(filterId, width, height, map, resolved)
          ensureDefsRoot().appendChild(handle.filter)
          setReady(true)
        }
      } catch {
        handle?.filter.remove()
        handle = null
        setReady(false)
      }
    }

    const measure = () => {
      const nextWidth = element.offsetWidth
      const nextHeight = element.offsetHeight
      if (nextWidth === width && nextHeight === height) return
      width = nextWidth
      height = nextHeight
      if (!handle) {
        build()
        return
      }
      resizeFilter(handle, width, height)
      if (rebuildTimer) clearTimeout(rebuildTimer)
      rebuildTimer = setTimeout(build, MAP_REBUILD_DELAY_MS)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (rebuildTimer) clearTimeout(rebuildTimer)
      handle?.filter.remove()
      handle = null
      setReady(false)
    }
  }, [active, element, filterId, radius, bezel, thickness, blur, saturation, brightness])

  return { ref, filter: active && ready ? `url(#${filterId})` : undefined }
}
