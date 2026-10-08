export interface BlobCircle {
  x: number
  y: number
  r: number
}

export interface BlobShape {
  x: number
  y: number
  width: number
  height: number
  paths: number[][]
}

export const BLOB_BLEND = 20

const SWEEP_STEP = 0.5
const EDGE_ITERATIONS = 24
const RADIAL_ITERATIONS = 22
const MIN_SAMPLES = 24
const MAX_SAMPLES = 400
const SAMPLE_SPACING = 1.2

function smoothMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

function blobField(circles: BlobCircle[], px: number, py: number, k: number): number {
  let distance = Number.POSITIVE_INFINITY
  for (const circle of circles) {
    const value = Math.hypot(px - circle.x, py - circle.y) - circle.r
    distance = distance === Number.POSITIVE_INFINITY ? value : smoothMin(distance, value, k)
  }
  return distance
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function blobOutline(circles: BlobCircle[], k: number = BLOB_BLEND): number[][] {
  const valid = circles.filter((circle) => Number.isFinite(circle.x) && Number.isFinite(circle.y) && circle.r > 0)
  if (valid.length === 0) return []
  let centerY = 0
  let maxRadius = 0
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  for (const circle of valid) {
    centerY += circle.y
    maxRadius = Math.max(maxRadius, circle.r)
    minX = Math.min(minX, circle.x - circle.r)
    maxX = Math.max(maxX, circle.x + circle.r)
  }
  centerY /= valid.length
  const reach = maxRadius + k
  const insideAt = (x: number) => blobField(valid, x, centerY, k) <= 0

  const edge = (inside: number, outside: number) => {
    let a = inside
    let b = outside
    for (let i = 0; i < EDGE_ITERATIONS; i++) {
      const mid = (a + b) / 2
      if (insideAt(mid)) a = mid
      else b = mid
    }
    return a
  }

  const boundary = (x: number, direction: number) => {
    let inside = centerY
    let outside = centerY + direction * reach
    for (let i = 0; i < RADIAL_ITERATIONS; i++) {
      const mid = (inside + outside) / 2
      if (blobField(valid, x, mid, k) <= 0) inside = mid
      else outside = mid
    }
    return inside
  }

  const trace = (start: number, end: number) => {
    const width = end - start
    const samples = Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, Math.ceil(width / SAMPLE_SPACING)))
    const xs: number[] = []
    for (let i = 0; i <= samples; i++) xs.push(start + (width * (1 - Math.cos((Math.PI * i) / samples))) / 2)
    const points: number[] = []
    for (const x of xs) points.push(round2(x), round2(boundary(x, -1)))
    for (let i = xs.length - 2; i >= 1; i--) points.push(round2(xs[i]), round2(boundary(xs[i], 1)))
    return points
  }

  const paths: number[][] = []
  const from = minX - k
  const to = maxX + k
  let inside = false
  let start = 0
  for (let x = from; x <= to + SWEEP_STEP; x += SWEEP_STEP) {
    const now = insideAt(x)
    if (now && !inside) start = edge(x, x - SWEEP_STEP)
    if (!now && inside) {
      const end = edge(x - SWEEP_STEP, x)
      if (end - start > 1) paths.push(trace(start, end))
    }
    inside = now
  }
  return paths
}

export function measureBlob(element: HTMLElement, k: number = BLOB_BLEND): BlobShape | null {
  const circles: BlobCircle[] = []
  element.querySelectorAll<HTMLElement>('[data-glass-circle]').forEach((node) => {
    const rect = node.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    circles.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, r: Math.min(rect.width, rect.height) / 2 })
  })
  const outline = blobOutline(circles, k)
  if (outline.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const points of outline) {
    for (let i = 0; i + 1 < points.length; i += 2) {
      minX = Math.min(minX, points[i])
      maxX = Math.max(maxX, points[i])
      minY = Math.min(minY, points[i + 1])
      maxY = Math.max(maxY, points[i + 1])
    }
  }
  const x = Math.floor(minX)
  const y = Math.floor(minY)
  return {
    x,
    y,
    width: Math.ceil(maxX) - x,
    height: Math.ceil(maxY) - y,
    paths: outline.map((points) => points.map((value, index) => round2(value - (index % 2 === 0 ? x : y)))),
  }
}

export function blobSvgPath(paths: number[][], offsetX: number, offsetY: number, scale: number): string {
  const factor = scale > 0 ? 1 / scale : 1
  return paths
    .map((points) => {
      const commands: string[] = []
      for (let i = 0; i + 1 < points.length; i += 2) {
        const px = round2((points[i] + offsetX) * factor)
        const py = round2((points[i + 1] + offsetY) * factor)
        commands.push(`${i === 0 ? 'M' : 'L'}${px} ${py}`)
      }
      return `${commands.join('')}Z`
    })
    .join('')
}
