const MAX_RECT_VALUES = 4096 * 4

function cornerRadius(value: string, width: number, height: number, scale: number): number {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  const radius = value.trim().endsWith('%') ? (parsed / 100) * Math.min(width, height) : parsed * scale
  return Math.min(radius, width / 2, height / 2)
}

function cornerInset(radius: number, offset: number): number {
  if (radius <= 0 || offset >= radius) return 0
  const distance = radius - offset
  return Math.round(radius - Math.sqrt(Math.max(0, radius * radius - distance * distance)))
}

function pushBand(out: number[], left: number, right: number, top: number, rows: number, leftRadius: number, rightRadius: number, fromTop: boolean): void {
  let started = false
  let runTop = top
  let runLeft = left
  let runRight = right
  for (let row = 0; row < rows; row++) {
    const offset = (fromTop ? row : rows - 1 - row) + 0.5
    const rowLeft = left + cornerInset(leftRadius, offset)
    const rowRight = right - cornerInset(rightRadius, offset)
    if (started && rowLeft === runLeft && rowRight === runRight) continue
    if (started && runRight > runLeft) out.push(runLeft, runTop, runRight - runLeft, top + row - runTop)
    started = true
    runTop = top + row
    runLeft = rowLeft
    runRight = rowRight
  }
  if (started && runRight > runLeft && top + rows > runTop) out.push(runLeft, runTop, runRight - runLeft, top + rows - runTop)
}

function pushShape(out: number[], element: HTMLElement, pixelRatio: number): void {
  const rect = element.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return
  const style = getComputedStyle(element)
  if (style.visibility === 'hidden') return
  const left = Math.floor(rect.left * pixelRatio)
  const top = Math.floor(rect.top * pixelRatio)
  const right = Math.ceil(rect.right * pixelRatio)
  const bottom = Math.ceil(rect.bottom * pixelRatio)
  const width = right - left
  const height = bottom - top
  if (width < 1 || height < 1) return
  const scale = element.offsetWidth > 0 ? (rect.width / element.offsetWidth) * pixelRatio : pixelRatio
  const topLeft = cornerRadius(style.borderTopLeftRadius, width, height, scale)
  const topRight = cornerRadius(style.borderTopRightRadius, width, height, scale)
  const bottomRight = cornerRadius(style.borderBottomRightRadius, width, height, scale)
  const bottomLeft = cornerRadius(style.borderBottomLeftRadius, width, height, scale)
  const topRows = Math.min(height, Math.ceil(Math.max(topLeft, topRight)))
  const bottomRows = Math.min(height - topRows, Math.ceil(Math.max(bottomLeft, bottomRight)))
  const middleRows = height - topRows - bottomRows
  if (topRows > 0) pushBand(out, left, right, top, topRows, topLeft, topRight, true)
  if (middleRows > 0) out.push(left, top + topRows, width, middleRows)
  if (bottomRows > 0) pushBand(out, left, right, bottom - bottomRows, bottomRows, bottomLeft, bottomRight, false)
}

function pushBounds(out: number[], element: HTMLElement, pixelRatio: number): void {
  const rect = element.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return
  const left = Math.floor(rect.left * pixelRatio)
  const top = Math.floor(rect.top * pixelRatio)
  out.push(left, top, Math.ceil(rect.right * pixelRatio) - left, Math.ceil(rect.bottom * pixelRatio) - top)
}

function collectRects(): number[] {
  const pixelRatio = window.devicePixelRatio || 1
  const elements = document.querySelectorAll<HTMLElement>('[data-clui-ui]')
  const rects: number[] = []
  elements.forEach((element) => pushShape(rects, element, pixelRatio))
  if (rects.length <= MAX_RECT_VALUES) return rects
  const bounds: number[] = []
  elements.forEach((element) => pushBounds(bounds, element, pixelRatio))
  return bounds.slice(0, MAX_RECT_VALUES)
}

function sameRects(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function initInputRegion(): () => void {
  const api = window.clui
  if (!api?.isInputRegionSupported || !api.setInputRegion) return () => {}

  let disposed = false
  let frame = 0
  let last: number[] | null = null

  const tick = () => {
    frame = 0
    if (disposed) return
    try {
      const rects = collectRects()
      if (!last || !sameRects(rects, last)) {
        last = rects
        api.setInputRegion(rects)
      }
    } catch {}
    frame = requestAnimationFrame(tick)
  }

  api.isInputRegionSupported()
    .then((supported) => {
      if (supported && !disposed && !frame) frame = requestAnimationFrame(tick)
    })
    .catch(() => {})

  return () => {
    disposed = true
    if (frame) cancelAnimationFrame(frame)
  }
}
