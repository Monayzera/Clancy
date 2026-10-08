#!/usr/bin/env node

const { execFileSync, execSync } = require('child_process')
const { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } = require('fs')
const { tmpdir } = require('os')
const { join } = require('path')

const SERVER_NAME = 'clui-computer-use'
const SERVER_VERSION = '1.0.0'
const TMP_DIR = join(tmpdir(), 'clui-computer-use')
mkdirSync(TMP_DIR, { recursive: true, mode: 0o700 })

let nutJs = null
try {
  nutJs = require('@nut-tree/nut-js')
} catch {
  nutJs = null
}

let playwright = null
try {
  playwright = require('playwright')
} catch {
  playwright = null
}

const browserState = {
  instance: null,
  page: null,
  context: null,
}

function nowIso() {
  return new Date().toISOString()
}

const textContent = (text) => ({ type: 'text', text })
const imageContent = (path) => {
  const data = readFileSync(path).toString('base64')
  return { type: 'image', mimeType: 'image/png', data }
}
const toolError = (message) => ({ content: [textContent(message)], isError: true })

// ─── Screenshot ───

function captureWithMac(filePath) {
  execFileSync('/usr/sbin/screencapture', ['-x', filePath], { stdio: 'ignore', timeout: 20000 })
}

function captureWithLinux(filePath) {
  for (const [cmd, args] of [['grim', [filePath]], ['gnome-screenshot', ['-f', filePath]], ['scrot', [filePath]]]) {
    try {
      execFileSync(cmd, args, { stdio: 'ignore', timeout: 20000 })
      if (existsSync(filePath)) return
    } catch {}
  }
  throw new Error('No supported Linux screenshot command (grim, gnome-screenshot, scrot)')
}

function captureWithWindows(filePath) {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$b = [System.Windows.Forms.SystemInformation]::VirtualScreen',
    '$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height',
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)',
    '$bmp.Save($args[0], [System.Drawing.Imaging.ImageFormat]::Png)',
    '$g.Dispose(); $bmp.Dispose()',
  ].join('; ')
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script, filePath], { stdio: 'ignore', timeout: 20000 })
}

function captureScreen() {
  const ts = Date.now()
  const filePath = join(TMP_DIR, `screen-${ts}.png`)

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

  return { path: filePath, timestamp: ts, isoTime: nowIso(), size: require('fs').statSync(filePath).size }
}

// ─── Mouse ───

function ensureNutJs() {
  if (!nutJs) {
    throw new Error('nut.js is not installed. Run: npm install @nut-tree/nut-js')
  }
  return nutJs
}

async function handleMouseMove(args) {
  const { mouse } = ensureNutJs()
  const x = Number(args.x)
  const y = Number(args.y)
  if (Number.isNaN(x) || Number.isNaN(y)) {
    return toolError('Invalid coordinates. Provide numeric x and y values.')
  }
  await mouse.setPosition({ x, y })
  return { content: [textContent(`Mouse moved to (${x}, ${y})`)] }
}

async function handleClick(args) {
  const { mouse, Button } = ensureNutJs()
  const x = Number(args.x)
  const y = Number(args.y)
  const button = Button[args.button || 'LEFT'] || Button.LEFT
  const count = Number(args.count) || 1

  if (!Number.isNaN(x) && !Number.isNaN(y)) {
    await mouse.setPosition({ x, y })
  }

  if (count > 1) {
    await mouse.doubleClick(button)
  } else {
    await mouse.click(button)
  }

  const label = count > 1 ? 'double-' : ''
  const pos = !Number.isNaN(x) ? ` at (${x}, ${y})` : ''
  return { content: [textContent(`Mouse ${label}click (${button})${pos}`)] }
}

async function handleScroll(args) {
  const { mouse } = ensureNutJs()
  const amount = Number(args.amount) || 1
  const direction = args.direction || 'down'
  const scrollAmount = direction === 'up' || direction === 'left'
    ? -Math.abs(amount)
    : Math.abs(amount)

  await mouse.scroll(scrollAmount)
  return { content: [textContent(`Scrolled ${direction} by ${amount}`)] }
}

async function handleDrag(args) {
  const { mouse, Button } = ensureNutJs()
  const fromX = Number(args.fromX)
  const fromY = Number(args.fromY)
  const toX = Number(args.toX)
  const toY = Number(args.toY)

  if ([fromX, fromY, toX, toY].some(Number.isNaN)) {
    return toolError('Drag requires numeric fromX, fromY, toX, toY values.')
  }

  await mouse.setPosition({ x: fromX, y: fromY })
  await mouse.pressButton(Button.LEFT)
  await mouse.setPosition({ x: toX, y: toY })
  await mouse.releaseButton(Button.LEFT)

  return { content: [textContent(`Dragged from (${fromX}, ${fromY}) to (${toX}, ${toY})`)] }
}

async function handleGetMousePosition(args) {
  const { mouse } = ensureNutJs()
  const pos = await mouse.getPosition()
  return { content: [textContent(JSON.stringify({ x: pos.x, y: pos.y, isoTime: nowIso() }, null, 2))] }
}

// ─── Keyboard ───

async function handleTypeText(args) {
  const { keyboard } = ensureNutJs()
  const text = args.text || ''
  if (!text) {
    return toolError('text parameter is required for typing.')
  }
  await keyboard.type(text)
  return { content: [textContent(`Typed ${text.length} characters`)] }
}

async function handlePressKey(args) {
  const { keyboard, Key } = ensureNutJs()
  const keyName = (args.key || '').toUpperCase()
  const key = Key[keyName]

  if (!key) {
    const validKeys = Object.keys(Key).join(', ')
    return toolError(`Unknown key: "${args.key}". Valid keys: ${validKeys}`)
  }

  if (args.modifiers && args.modifiers.length > 0) {
    const modifiers = args.modifiers.map((m) => {
      const upper = m.toUpperCase()
      return Key[upper] || Key[m]
    }).filter(Boolean)

    for (const mod of modifiers) {
      await keyboard.pressKey(mod)
    }
    await keyboard.pressKey(key)
    for (let i = modifiers.length - 1; i >= 0; i--) {
      await keyboard.releaseKey(modifiers[i])
    }
    await keyboard.releaseKey(key)
    return { content: [textContent(`Pressed ${args.modifiers.join('+')}+${args.key}`)] }
  }

  await keyboard.pressKey(key)
  await keyboard.releaseKey(key)
  return { content: [textContent(`Pressed key: ${args.key}`)] }
}

// ─── Browser Automation (Playwright) ───

async function getBrowser() {
  if (!playwright) {
    throw new Error('Playwright is not installed. Run: npx playwright install')
  }

  if (!browserState.instance) {
    browserState.instance = await playwright.chromium.launch({ headless: false })
    browserState.context = await browserState.instance.newContext({
      viewport: { width: 1280, height: 720 },
    })
    browserState.page = await browserState.context.newPage()
  }

  return browserState
}

async function handleBrowserNavigate(args) {
  const url = args.url
  if (!url) {
    return toolError('url parameter is required for browser navigation.')
  }

  try {
    const browser = await getBrowser()
    const response = await browser.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const title = await browser.page.title()
    const status = response ? response.status() : 'unknown'
    return { content: [textContent(`Navigated to ${url}\nStatus: ${status}\nTitle: ${title}`)] }
  } catch (err) {
    return toolError(`Browser navigation failed: ${err.message}`)
  }
}

async function handleBrowserScreenshot(args) {
  try {
    const browser = await getBrowser()
    const filePath = join(TMP_DIR, `browser-${Date.now()}.png`)

    const opts = { path: filePath, fullPage: args.fullPage === true }
    if (args.selector) {
      const element = await browser.page.locator(args.selector)
      await element.screenshot({ path: filePath })
    } else {
      await browser.page.screenshot(opts)
    }

    if (!existsSync(filePath)) {
      return toolError('Browser screenshot file was not created')
    }

    const includeImage = args.include_image !== false
    const content = [textContent(`Captured browser screenshot at ${nowIso()}\nPath: ${filePath}`)]

    if (includeImage) {
      content.push(imageContent(filePath))
    }

    return { content }
  } catch (err) {
    return toolError(`Browser screenshot failed: ${err.message}`)
  }
}

async function handleBrowserExecuteJs(args) {
  const js = args.javascript || args.js
  if (!js) {
    return toolError('javascript parameter is required.')
  }

  try {
    const browser = await getBrowser()
    const result = await browser.page.evaluate(js)
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    return { content: [textContent(`JavaScript executed successfully:\n${text.substring(0, 4000)}`)] }
  } catch (err) {
    return toolError(`JavaScript execution failed: ${err.message}`)
  }
}

async function handleBrowserExtract(args) {
  try {
    const browser = await getBrowser()
    const selector = args.selector

    if (selector) {
      const text = await browser.page.locator(selector).textContent()
      return { content: [textContent(`Extracted from "${selector}":\n${(text || '').substring(0, 4000)}`)] }
    }

    const text = await browser.page.textContent('body')
    return { content: [textContent(`Page text content:\n${(text || '').substring(0, 4000)}`)] }
  } catch (err) {
    return toolError(`Content extraction failed: ${err.message}`)
  }
}

async function handleBrowserClick(args) {
  const selector = args.selector
  if (!selector) {
    return toolError('selector parameter is required.')
  }

  try {
    const browser = await getBrowser()
    const count = Number(args.count) || 1
    if (count > 1) {
      await browser.page.locator(selector).dblclick()
    } else {
      await browser.page.locator(selector).click()
    }
    return { content: [textContent(`Clicked on "${selector}"`)] }
  } catch (err) {
    return toolError(`Click failed: ${err.message}`)
  }
}

async function handleBrowserType(args) {
  const { selector, text } = args
  if (!selector || !text) {
    return toolError('selector and text parameters are required.')
  }

  try {
    const browser = await getBrowser()
    await browser.page.locator(selector).fill(text)
    return { content: [textContent(`Typed into "${selector}"`)] }
  } catch (err) {
    return toolError(`Type failed: ${err.message}`)
  }
}

async function handleBrowserClose(args) {
  try {
    if (browserState.instance) {
      await browserState.instance.close()
      browserState.instance = null
      browserState.page = null
      browserState.context = null
      return { content: [textContent('Browser closed')] }
    }
    return { content: [textContent('No browser is currently open')] }
  } catch (err) {
    return toolError(`Browser close failed: ${err.message}`)
  }
}

async function handleBrowserInfo(args) {
  try {
    if (!browserState.page) {
      return { content: [textContent('No browser is currently open')] }
    }
    const url = browserState.page.url()
    const title = await browserState.page.title()
    return { content: [textContent(JSON.stringify({ url, title, isOpen: true }, null, 2))] }
  } catch (err) {
    return toolError(`Browser info failed: ${err.message}`)
  }
}

// ─── Tool Definitions ───

const tools = [
  {
    name: 'capture_screenshot',
    description: 'Capture an immediate full-screen screenshot from the local machine and return it as an image.',
    inputSchema: {
      type: 'object',
      properties: {
        include_image: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_mouse_position',
    description: 'Get the current position of the mouse cursor.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'move_mouse',
    description: 'Move the mouse cursor to specific screen coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
      },
      required: ['x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'click_mouse',
    description: 'Perform a mouse click (single, double) at specified coordinates or current position.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate (optional, defaults to current position)' },
        y: { type: 'number', description: 'Y coordinate (optional, defaults to current position)' },
        button: { type: 'string', enum: ['LEFT', 'RIGHT', 'MIDDLE'] },
        count: { type: 'integer', description: 'Click count. 1=single, 2=double.', default: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'scroll_mouse',
    description: 'Scroll the mouse wheel in a specified direction.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'integer', default: 1 },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'drag_mouse',
    description: 'Drag from one screen coordinate to another.',
    inputSchema: {
      type: 'object',
      properties: {
        fromX: { type: 'number' },
        fromY: { type: 'number' },
        toX: { type: 'number' },
        toY: { type: 'number' },
      },
      required: ['fromX', 'fromY', 'toX', 'toY'],
      additionalProperties: false,
    },
  },
  {
    name: 'type_text',
    description: 'Type text using the keyboard at the current cursor position.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'press_key',
    description: 'Press a keyboard key, optionally with modifier keys (Ctrl, Alt, Cmd, Shift).',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name (e.g., A, Enter, Escape, F5)' },
        modifiers: { type: 'array', items: { type: 'string' }, description: 'Modifier keys' },
      },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_navigate',
    description: 'Open a URL in an automated browser (Playwright).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the automated browser page or a specific element.',
    inputSchema: {
      type: 'object',
      properties: {
        fullPage: { type: 'boolean', default: true },
        selector: { type: 'string', description: 'CSS selector for element screenshot' },
        include_image: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'browser_execute_js',
    description: 'Execute JavaScript code in the automated browser page.',
    inputSchema: {
      type: 'object',
      properties: {
        javascript: { type: 'string', description: 'JavaScript code to execute' },
      },
      required: ['javascript'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_extract',
    description: 'Extract text content from the current browser page, optionally from a specific selector.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector (optional, defaults to full page body)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'browser_click',
    description: 'Click on an element in the automated browser by CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        count: { type: 'integer', default: 1 },
      },
      required: ['selector'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an element in the automated browser by CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['selector', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_close',
    description: 'Close the automated browser instance.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'browser_info',
    description: 'Get information about the currently open browser page (URL, title).',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
]

// ─── Tool Dispatcher ───

async function callTool(name, args) {
  try {
    switch (name) {
      case 'capture_screenshot': return handleCaptureScreenshot(args)
      case 'get_mouse_position': return await handleGetMousePosition(args)
      case 'move_mouse': return await handleMouseMove(args)
      case 'click_mouse': return await handleClick(args)
      case 'scroll_mouse': return await handleScroll(args)
      case 'drag_mouse': return await handleDrag(args)
      case 'type_text': return await handleTypeText(args)
      case 'press_key': return await handlePressKey(args)
      case 'browser_navigate': return await handleBrowserNavigate(args)
      case 'browser_screenshot': return await handleBrowserScreenshot(args)
      case 'browser_execute_js': return await handleBrowserExecuteJs(args)
      case 'browser_extract': return await handleBrowserExtract(args)
      case 'browser_click': return await handleBrowserClick(args)
      case 'browser_type': return await handleBrowserType(args)
      case 'browser_close': return await handleBrowserClose(args)
      case 'browser_info': return await handleBrowserInfo(args)
      default:
        return toolError(`Unknown tool: ${name}`)
    }
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err))
  }
}

function handleCaptureScreenshot(args) {
  try {
    const entry = captureScreen()
    const includeImage = args?.include_image !== false
    const content = [textContent(`Captured screenshot at ${entry.isoTime}\nPath: ${entry.path}\nSize: ${entry.size} bytes`)]
    if (includeImage) {
      content.push(imageContent(entry.path))
    }
    return { content }
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err))
  }
}

// ─── MCP Protocol ───

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

async function handleMessage(message) {
  if (!message || typeof message !== 'object') return

  const isRequest = Object.prototype.hasOwnProperty.call(message, 'id')
  const id = message.id
  const method = message.method
  const params = message.params || {}

  if (!isRequest) return

  if (method === 'initialize') {
    respond(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
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
    const result = await callTool(name, args)
    respond(id, result)
    return
  }

  respondError(id, -32601, `Method not found: ${method}`)
}

let buffer = Buffer.alloc(0)

function parseHeaders(rawHeaders) {
  const headers = {}
  for (const line of rawHeaders.split('\r\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim()
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

    handleMessage(message).catch((err) => {
      if (message?.id) {
        respondError(message.id, -32603, err.message)
      }
    })
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  processBuffer()
})

process.on('SIGINT', () => {
  if (browserState.instance) {
    browserState.instance.close().catch(() => {})
  }
  process.exit(0)
})

process.on('SIGTERM', () => {
  if (browserState.instance) {
    browserState.instance.close().catch(() => {})
  }
  process.exit(0)
})
