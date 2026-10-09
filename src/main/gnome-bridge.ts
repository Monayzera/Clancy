import { createConnection, type Socket } from 'net'
import { join } from 'path'

export interface BridgeMessage {
  type: string
  [key: string]: unknown
}

interface BridgeHandlers {
  onConnect: () => void
  onDisconnect: () => void
  onMessage: (message: BridgeMessage) => void
  log: (message: string) => void
}

const SOCKET_NAME = 'clui-gnome-shell.sock'
const RECONNECT_MS = 2000
const MAX_BUFFER = 4 * 1024 * 1024
const MAX_PENDING_LATEST = 256 * 1024

export class GnomeBridge {
  private socket: Socket | null = null
  private buffer = ''
  private latest = new Map<string, BridgeMessage>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private connected = false
  private stopped = true

  constructor(private readonly handlers: BridgeHandlers) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.socket?.destroy()
    this.socket = null
  }

  isConnected(): boolean {
    return this.connected
  }

  sendLatest(key: string, message: BridgeMessage): void {
    this.latest.set(key, message)
    this.flushLatest()
  }

  private flushLatest(): void {
    for (const [key, message] of this.latest) {
      if (!this.connected || !this.socket || this.socket.writableLength > MAX_PENDING_LATEST) return
      this.latest.delete(key)
      this.send(message)
    }
  }

  send(message: BridgeMessage): boolean {
    if (!this.connected || !this.socket) return false
    try {
      this.socket.write(`${JSON.stringify(message)}\n`)
      return true
    } catch (err) {
      this.handlers.log(`send failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  private connect(): void {
    if (this.stopped || this.socket) return
    const runtimeDir = process.env.XDG_RUNTIME_DIR
    if (!runtimeDir) {
      this.handlers.log('XDG_RUNTIME_DIR is not set')
      return
    }
    const socket = createConnection(join(runtimeDir, SOCKET_NAME))
    this.socket = socket
    this.buffer = ''
    socket.setEncoding('utf8')
    socket.on('connect', () => {
      this.connected = true
      this.handlers.onConnect()
    })
    socket.on('data', (chunk: string) => this.receive(chunk))
    socket.on('drain', () => this.flushLatest())
    socket.on('error', () => {})
    socket.on('close', () => {
      const wasConnected = this.connected
      this.connected = false
      this.latest.clear()
      if (this.socket === socket) this.socket = null
      if (wasConnected) this.handlers.onDisconnect()
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.connect()
    }, RECONNECT_MS)
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    if (this.buffer.length > MAX_BUFFER) {
      this.handlers.log('incoming buffer overflow')
      this.socket?.destroy()
      return
    }
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      if (line) this.dispatch(line)
      index = this.buffer.indexOf('\n')
    }
  }

  private dispatch(line: string): void {
    try {
      const parsed: unknown = JSON.parse(line)
      if (typeof parsed !== 'object' || parsed === null) return
      if (typeof Reflect.get(parsed, 'type') !== 'string') return
      this.handlers.onMessage(parsed as BridgeMessage)
    } catch (err) {
      this.handlers.log(`bad message: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
