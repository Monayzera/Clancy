#!/usr/bin/env node

const { execFileSync } = require('child_process')
const { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } = require('fs')
const { join } = require('path')
const { tmpdir } = require('os')

const SERVER_NAME = 'clui-screen-tools'
const SERVER_VERSION = '1.0.0'
const SNAPSHOT_DIR = join(tmpdir(), 'clui-screen-tools')

mkdirSync(SNAPSHOT_DIR, { recursive: true, mode: 0o700 })

const state = {
  history: [],
  running: false,
  timer: null,
  intervalMs: 3000,
  keepLast: 120,
  captureInFlight: false,
  lastError: null,
}

function nowIso(ts) {
  return new Date(ts).toISOString()
}

function toInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.floor(n) : fallback
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function tryRemove(path) {
  try {
    unlinkSync(path)
  } catch {}
}

function pruneHistory(keepLast) {
  const limit = clamp(toInt(keepLast, 120), 1, 500)
  while (state.history.length > limit) {
    const removed = state.history.shift()
    if (removed?.path) {
      tryRemove(removed.path)
    }
  }
}

function cleanupDiskOrphans() {
  const known = new Set(state.history.map((s) => s.path))
  let files = []
  try {
    files = readdirSync(SNAPSHOT_DIR)
  } catch {
    return
  }
  for (const name of files) {
    if (!name.endsWith('.png')) continue
    const full = join(SNAPSHOT_DIR, name)
    if (!known.has(full)) {
      tryRemove(full)
    }
  }
}

function captureWithMac(path) {
  execFileSync('/usr/sbin/screencapture', ['-x', path], {
    stdio: 'ignore',
    timeout: 20000,
  })
}

function captureWithLinux(path) {
  const candidates = [
    ['grim', [path]],
    ['gnome-screenshot', ['-f', path]],
    ['scrot', [path]],
  ]

  let lastErr = null
  for (const [command, args] of candidates) {
    try {
      execFileSync(command, args, { stdio: 'ignore', timeout: 20000 })
      if (existsSync(path)) return
    } catch (err) {
      lastErr = err
    }
  }

  const extra = lastErr instanceof Error ? ` (${lastErr.message})` : ''
  throw new Error(`No supported Linux screenshot command found (grim, gnome-screenshot, scrot)${extra}`)
}

function captureWithWindows(path) {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen',
    '$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height',
    '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
    '$graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bitmap.Size)',
    '$bitmap.Save($args[0], [System.Drawing.Imaging.ImageFormat]::Png)',
    '$graphics.Dispose()',
    '$bitmap.Dispose()',
  ].join('; ')

  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script, path], {
    stdio: 'ignore',
    timeout: 20000,
  })
}

function doCapture(prefix) {
  const ts = Date.now()
  const filePath = join(SNAPSHOT_DIR, `${prefix}-${ts}.png`)

  if (process.platform === 'darwin') {
    captureWithMac(filePath)
  } else if (process.platform === 'linux') {
    captureWithLinux(filePath)
  } else if (process.platform === 'win32') {
    captureWithWindows(filePath)
  } else {
    throw new Error(`Unsupported platform: ${process.platform}`)
  }

  if (!existsSync(filePath)) {
    throw new Error('Screenshot file was not created')
  }

  const size = statSync(filePath).size
  const entry = {
    path: filePath,
    timestamp: ts,
    isoTime: nowIso(ts),
    size,
    mimeType: 'image/png',
  }

  state.history.push(entry)
  pruneHistory(state.keepLast)
  return entry
}

function snapshotStatus() {
  const latest = state.history[state.history.length - 1] || null
  return {
    running: state.running,
    intervalMs: state.intervalMs,
    keepLast: state.keepLast,
    count: state.history.length,
    latest,
    snapshotDir: SNAPSHOT_DIR,
    lastError: state.lastError,
  }
}

function textContent(text) {
  return { type: 'text', text }
}

function imageContent(path) {
  const data = readFileSync(path).toString('base64')
  return { type: 'image', mimeType: 'image/png', data }
}

function toolError(message) {
  return {
    content: [textContent(message)],
    isError: true,
  }
}

async function runTick() {
  if (!state.running || state.captureInFlight) return
  state.captureInFlight = true
  try {
    state.lastError = null
    doCapture('continuous')
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err)
  } finally {
    state.captureInFlight = false
  }
}

function startContinuous(intervalMs, keepLast, captureNow) {
  const nextInterval = clamp(toInt(intervalMs, 3000), 500, 60000)
  const nextKeep = clamp(toInt(keepLast, 120), 1, 500)

  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }

  state.running = true
  state.intervalMs = nextInterval
  state.keepLast = nextKeep
  state.lastError = null

  state.timer = setInterval(() => {
    runTick().catch(() => {})
  }, state.intervalMs)

  if (captureNow !== false) {
    runTick().catch(() => {})
  }
}

function stopContinuous() {
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
  state.running = false
}

const tools = [
  {
    name: 'capture_screenshot',
    description: 'Capture an immediate full-screen screenshot from the local machine.',
    inputSchema: {
      type: 'object',
      properties: {
        include_image: { type: 'boolean', default: true },
        max_image_bytes: { type: 'integer', minimum: 1, default: 8000000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'start_continuous_capture',
    description: 'Start continuous screenshot capture in periodic intervals.',
    inputSchema: {
      type: 'object',
      properties: {
        interval_ms: { type: 'integer', minimum: 500, maximum: 60000, default: 3000 },
        keep_last: { type: 'integer', minimum: 1, maximum: 500, default: 120 },
        capture_immediately: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'stop_continuous_capture',
    description: 'Stop continuous screenshot capture.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_continuous_capture_status',
    description: 'Get status and latest metadata for continuous capture.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_latest_snapshot',
    description: 'Return metadata for the latest snapshot and optionally include image data.',
    inputSchema: {
      type: 'object',
      properties: {
        include_image: { type: 'boolean', default: true },
        max_image_bytes: { type: 'integer', minimum: 1, default: 8000000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_recent_snapshots',
    description: 'List recent snapshots from memory.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'clear_snapshots',
    description: 'Remove all captured snapshots from memory and disk.',
    inputSchema: {
      type: 'object',
      properties: {
        stop_continuous: { type: 'boolean', default: false },
      },
      additionalProperties: false,
    },
  },
]

function formatJson(value) {
  return JSON.stringify(value, null, 2)
}

function handleCaptureScreenshot(args) {
  const includeImage = args?.include_image !== false
  const maxBytes = clamp(toInt(args?.max_image_bytes, 8000000), 1, 50000000)

  const entry = doCapture('manual')
  const content = [
    textContent(`Captured screenshot at ${entry.isoTime}\npath: ${entry.path}\nsize: ${entry.size} bytes`),
  ]

  if (includeImage) {
    if (entry.size <= maxBytes) {
      content.push(imageContent(entry.path))
    } else {
      content.push(textContent(`Image omitted because file size ${entry.size} exceeds max_image_bytes=${maxBytes}`))
    }
  }

  return { content }
}

function handleStartContinuous(args) {
  startContinuous(args?.interval_ms, args?.keep_last, args?.capture_immediately)
  const status = snapshotStatus()
  return {
    content: [textContent(`Continuous capture started\n${formatJson(status)}`)],
  }
}

function handleStopContinuous() {
  stopContinuous()
  const status = snapshotStatus()
  return {
    content: [textContent(`Continuous capture stopped\n${formatJson(status)}`)],
  }
}

function handleGetStatus() {
  return {
    content: [textContent(formatJson(snapshotStatus()))],
  }
}

function handleLatest(args) {
  const latest = state.history[state.history.length - 1]
  if (!latest) {
    return toolError('No snapshots captured yet')
  }

  const includeImage = args?.include_image !== false
  const maxBytes = clamp(toInt(args?.max_image_bytes, 8000000), 1, 50000000)

  const content = [textContent(formatJson(latest))]
  if (includeImage) {
    if (latest.size <= maxBytes) {
      content.push(imageContent(latest.path))
    } else {
      content.push(textContent(`Image omitted because file size ${latest.size} exceeds max_image_bytes=${maxBytes}`))
    }
  }

  return { content }
}

function handleListRecent(args) {
  const limit = clamp(toInt(args?.limit, 10), 1, 100)
  const recent = state.history.slice(-limit).reverse()
  return {
    content: [textContent(formatJson({ count: recent.length, snapshots: recent }))],
  }
}

function handleClear(args) {
  if (args?.stop_continuous) {
    stopContinuous()
  }

  const snapshots = [...state.history]
  state.history = []
  state.lastError = null

  for (const snapshot of snapshots) {
    if (snapshot?.path) {
      tryRemove(snapshot.path)
    }
  }

  cleanupDiskOrphans()

  return {
    content: [textContent(`Cleared ${snapshots.length} snapshots`)],
  }
}

function callTool(name, args) {
  try {
    switch (name) {
      case 'capture_screenshot':
        return handleCaptureScreenshot(args)
      case 'start_continuous_capture':
        return handleStartContinuous(args)
      case 'stop_continuous_capture':
        return handleStopContinuous()
      case 'get_continuous_capture_status':
        return handleGetStatus()
      case 'get_latest_snapshot':
        return handleLatest(args)
      case 'list_recent_snapshots':
        return handleListRecent(args)
      case 'clear_snapshots':
        return handleClear(args)
      default:
        return toolError(`Unknown tool: ${name}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    state.lastError = message
    return toolError(message)
  }
}

function send(payload) {
  const json = JSON.stringify(payload)
  const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`
  process.stdout.write(header + json)
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function handleMessage(message) {
  if (!message || typeof message !== 'object') return

  const isRequest = Object.prototype.hasOwnProperty.call(message, 'id')
  const id = message.id
  const method = message.method
  const params = message.params || {}

  if (!isRequest) {
    return
  }

  if (method === 'initialize') {
    respond(id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
    })
    return
  }

  if (method === 'ping') {
    respond(id, {})
    return
  }

  if (method === 'tools/list') {
    respond(id, { tools })
    return
  }

  if (method === 'tools/call') {
    const name = params.name
    const args = params.arguments || {}
    respond(id, callTool(name, args))
    return
  }

  respondError(id, -32601, `Method not found: ${method}`)
}

let buffer = Buffer.alloc(0)

function parseHeaders(rawHeaders) {
  const lines = rawHeaders.split('\r\n')
  const headers = {}
  for (const line of lines) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    headers[key] = value
  }
  return headers
}

function processBuffer() {
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) return

    const rawHeaders = buffer.slice(0, headerEnd).toString('utf8')
    const headers = parseHeaders(rawHeaders)
    const contentLength = Number(headers['content-length'])

    if (!Number.isFinite(contentLength) || contentLength < 0) {
      buffer = Buffer.alloc(0)
      return
    }

    const totalLength = headerEnd + 4 + contentLength
    if (buffer.length < totalLength) return

    const payload = buffer.slice(headerEnd + 4, totalLength).toString('utf8')
    buffer = buffer.slice(totalLength)

    let message
    try {
      message = JSON.parse(payload)
    } catch {
      continue
    }

    handleMessage(message)
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  processBuffer()
})

process.stdin.on('end', () => {
  stopContinuous()
})

process.on('SIGINT', () => {
  stopContinuous()
  process.exit(0)
})

process.on('SIGTERM', () => {
  stopContinuous()
  process.exit(0)
})
