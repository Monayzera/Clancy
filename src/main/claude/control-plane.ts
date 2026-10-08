import { EventEmitter } from 'events'
import { RunManager } from './run-manager'
import { PtyRunManager } from './pty-run-manager'
import { PermissionServer, maskSensitiveFields } from '../hooks/permission-server'
import type { HookToolRequest, PermissionOption } from '../hooks/permission-server'
import { isRetryableError } from './retry-manager'
import { log as _log } from '../logger'
import { NativeAskUserQuestionHarness, normalizeAskUserQuestionToolInput, type AskUserQuestionResolvePayload } from '../native-harness/ask-user-question'
import type {
  TabStatus,
  TabRegistryEntry,
  HealthReport,
  NormalizedEvent,
  RunOptions,
  EnrichedError,
} from '../../shared/types'

const MAX_QUEUE_DEPTH = 32

function log(msg: string): void {
  _log('ControlPlane', msg)
}

interface QueuedRequest {
  requestId: string
  tabId: string
  options: RunOptions
  resolve: (value: void) => void
  reject: (reason: Error) => void
  enqueuedAt: number
  /** Additional waiters that called submitPrompt with the same requestId */
  extraWaiters: Array<{ resolve: (value: void) => void; reject: (reason: Error) => void }>
}

interface InflightRequest {
  requestId: string
  tabId: string
  promise: Promise<void>
  resolve: (value: void) => void
  reject: (reason: Error) => void
}

interface AskUserQuestionToolBuffer {
  toolName: string
  toolId: string
  index: number
  input: string
}

type AskUserQuestionEvent = Extract<NormalizedEvent, { type: 'ask_user_question' }>

function isAskUserQuestionToolName(name?: string): boolean {
  return (name || '').split(':').pop()!.replace(/[_-]/g, '').toLowerCase() === 'askuserquestion'
}

function askToolBufferKey(toolId?: string, index?: number): string {
  return toolId || `index:${index ?? 0}`
}

/**
 * ControlPlane: the single backend authority for tab/session lifecycle.
 *
 * Responsibilities:
 *  1. Tab/session registry
 *  2. Request queue + backpressure
 *  3. RequestId idempotency
 *  4. Target session guard
 *  5. Run lifecycle state transitions
 *  6. Health reporting for renderer reconciliation
 *  7. Diagnostic data (delegated to RunManager ring buffers)
 *
 * Events emitted (forwarded from RunManager, tagged with tabId):
 *  - 'event' (tabId, NormalizedEvent)
 *  - 'tab-status-change' (tabId, newStatus, oldStatus)
 *  - 'error' (tabId, EnrichedError)
 */
export class ControlPlane extends EventEmitter {
  private tabs = new Map<string, TabRegistryEntry>()
  private inflightRequests = new Map<string, InflightRequest>()
  private requestQueue: QueuedRequest[] = []
  private interruptLocks = new Map<string, Promise<void>>()
  private staleRequests = new Set<string>()
  private runManager: RunManager
  private ptyRunManager: PtyRunManager
  /** Feature flag: use PTY transport for interactive permissions */
  private interactivePty: boolean
  /** Tracks which runs are using PTY transport (by requestId) */
  private ptyRuns = new Set<string>()
  /** Tracks requestIds that are warmup init requests (invisible to renderer) */
  private initRequestIds = new Set<string>()
  /** Permission hook server for PreToolUse HTTP hooks */
  private permissionServer: PermissionServer
  /** Per-run tokens: requestId → runToken (for cleanup on exit/error) */
  private runTokens = new Map<string, string>()
  /** Global permission mode: 'ask' shows cards, 'auto' auto-approves */
  private permissionMode: 'ask' | 'auto' = 'ask'
  private hookServerReady: Promise<void>
  private warmHandles = new Map<string, { requestId: string; cwd: string; model?: string }>()
  private resumedRequests = new Map<string, { tabId: string; options: RunOptions }>()
  private askUserQuestionHarness = new NativeAskUserQuestionHarness()
  private askQuestionToolBuffers = new Map<string, Map<string, AskUserQuestionToolBuffer>>()
  /** Track options for active retries so re-failed retries can re-schedule */
  private activeRetryOptions = new Map<string, { tabId: string; options: RunOptions; attempt: number; reason: string }>()
  /** Last request options per requestId — used by retry to reconstruct RunOptions */
  private lastRequestOptions = new Map<string, RunOptions>()

  constructor(interactivePty = false) {
    super()
    this.interactivePty = interactivePty
    this.runManager = new RunManager()
    this.ptyRunManager = new PtyRunManager()
    this.permissionServer = new PermissionServer()

    // Start the permission hook server. _dispatch awaits hookServerReady
    // so early prompts don't silently fall back to the --allowedTools path.
    this.hookServerReady = this.permissionServer.start()
      .then((port) => {
        log(`Permission hook server ready on port ${port}`)
      })
      .catch((err) => {
        log(`Failed to start permission hook server: ${(err as Error).message}`)
        // No hook server → dispatch falls back to --allowedTools
      })

    // Wire permission server events → normalized events for renderer.
    // 4-arg signature: (questionId, toolRequest, tabId, options)
    // tabId comes directly from per-run token registration — no session_id lookup needed.
    this.permissionServer.on('permission-request', (questionId: string, toolRequest: HookToolRequest, tabId: string, options: PermissionOption[]) => {
      // Verify tab still exists — deny immediately if closed (prevents 5-min timeout hang)
      if (!this.tabs.has(tabId)) {
        log(`Permission request for closed tab ${tabId.substring(0, 8)}… — auto-denying`)
        this.permissionServer.respondToPermission(questionId, 'deny', 'Tab closed')
        return
      }

      log(`Permission request [${questionId}]: tool=${toolRequest.tool_name} tab=${tabId.substring(0, 8)}… mode=${this.permissionMode}`)

      // Auto mode: immediately allow without showing UI
      if (this.permissionMode === 'auto') {
        this.permissionServer.respondToPermission(questionId, 'allow', 'Auto mode')
        return
      }

      // Mask sensitive fields before sending to renderer (defense-in-depth)
      const safeInput = toolRequest.tool_input
        ? maskSensitiveFields(toolRequest.tool_input)
        : undefined

      const permEvent: NormalizedEvent = {
        type: 'permission_request',
        questionId,
        toolName: toolRequest.tool_name,
        toolDescription: undefined,
        toolInput: safeInput,
        options,
      }
      this.emit('event', tabId, permEvent)
    })

    log(`Interactive PTY transport: ${interactivePty ? 'ENABLED' : 'disabled'}`)

    // ─── Wire PtyRunManager events → ControlPlane routing ───
    this._wirePtyEvents()

    // ─── Wire RunManager events → ControlPlane routing ───

    this.runManager.on('normalized', (requestId: string, event: NormalizedEvent) => {
      if (this.staleRequests.has(requestId)) return

      const tabId = this._findTabByRequest(requestId)
      if (!tabId) return

      const tab = this.tabs.get(tabId)
      if (!tab) return

      tab.lastActivityAt = Date.now()

      if (event.type === 'session_init') {
        tab.claudeSessionId = event.sessionId
        this.resumedRequests.delete(requestId)

        if (this.initRequestIds.has(requestId)) {
          this.emit('event', tabId, { ...event, isWarmup: true })
          return
        }

        if (tab.status === 'connecting') {
          this._setTabStatus(tabId, 'running')
        }
      }

      if (this.initRequestIds.has(requestId)) {
        return
      }

      if (event.type === 'error' && this.resumedRequests.has(requestId)) {
        return
      }

      if (event.type === 'error' && event.message === 'Unknown error') {
        const handle = this.runManager.getHandle(requestId)
        if (handle) {
          const stderrHint = handle.stderrTail.slice(-3).join(' ').substring(0, 200)
          if (stderrHint) {
            this.emit('event', tabId, { ...event, message: stderrHint })
          } else {
            this.emit('event', tabId, event)
          }
        } else {
          this.emit('event', tabId, event)
        }
      } else {
        this._emitNormalizedEvent(requestId, tabId, event)
      }

      if (event.type === 'task_complete') {
        const handle = this.runManager.getHandle(requestId)
        if (handle?.keepAlive) {
          const inflight = this.inflightRequests.get(requestId)
          if (inflight) {
            inflight.resolve()
            this.inflightRequests.delete(requestId)
          }
          tab.activeRequestId = null
          tab.runPid = null

          this._setTabStatus(tabId, 'completed')

          this.warmHandles.set(tabId, { requestId, cwd: '', model: handle.model })
          log(`Process kept warm for tab ${tabId.substring(0, 8)}… (PID ${handle.pid})`)

          this._processQueue(tabId)
        }
      }
    })

    this.runManager.on('exit', (requestId: string, code: number | null, signal: string | null, sessionId: string | null) => {
      const runToken = this.runTokens.get(requestId)
      if (runToken) {
        this.permissionServer.unregisterRun(runToken)
        this.runTokens.delete(requestId)
      }
      this._clearRequestState(requestId)

      for (const [wTabId, warm] of this.warmHandles) {
        if (warm.requestId === requestId) {
          this.warmHandles.delete(wTabId)
          log(`Warm process died for tab ${wTabId.substring(0, 8)}…`)
          break
        }
      }

      const tabId = this._findTabByRequest(requestId)
      const inflight = this.inflightRequests.get(requestId)

      if (!tabId || !this.tabs.get(tabId)) {
        if (inflight) {
          inflight.resolve()
          this.inflightRequests.delete(requestId)
        }
        return
      }

      const tab = this.tabs.get(tabId)!

      if (this.staleRequests.has(requestId)) {
        this.staleRequests.delete(requestId)
        const wasInit = this.initRequestIds.delete(requestId)
        if (tab.activeRequestId === requestId) {
          tab.activeRequestId = null
          tab.runPid = null
        }
        if (sessionId && !wasInit) tab.claudeSessionId = sessionId
        if (inflight) {
          inflight.resolve()
          this.inflightRequests.delete(requestId)
        }
        return
      }

      if (!inflight && tab.activeRequestId !== requestId) {
        tab.runPid = null
        this.initRequestIds.delete(requestId)
        if (sessionId) tab.claudeSessionId = sessionId
        return
      }

      tab.activeRequestId = null
      tab.runPid = null

      if (sessionId) tab.claudeSessionId = sessionId

      if (this.initRequestIds.has(requestId)) {
        this.initRequestIds.delete(requestId)
        this._setTabStatus(tabId, 'idle')
        if (inflight) {
          inflight.resolve()
          this.inflightRequests.delete(requestId)
        }
        this._processQueue(tabId)
        return
      }

      const resumeRetry = this.resumedRequests.get(requestId)
      if (resumeRetry && signal !== 'SIGINT' && signal !== 'SIGKILL') {
        this.resumedRequests.delete(requestId)
        log(`Resume failed for tab ${tabId.substring(0, 8)}… — retrying without --resume`)
        tab.claudeSessionId = null
        if (inflight) {
          inflight.resolve()
          this.inflightRequests.delete(requestId)
        }
        const retryId = `retry-${crypto.randomUUID().substring(0, 8)}`
        this._dispatch(tabId, retryId, resumeRetry.options).catch((err) => {
          log(`Retry without resume failed: ${(err as Error).message}`)
          this._setTabStatus(tabId, 'failed')
        })
        return
      }

      this._tryAutomaticRetry({
        requestId,
        tabId,
        tab,
        code,
        signal,
        inflight,
      })
    })

    this.runManager.on('error', (requestId: string, err: Error) => {
      // Clean up per-run token
      const runToken = this.runTokens.get(requestId)
      if (runToken) {
        this.permissionServer.unregisterRun(runToken)
        this.runTokens.delete(requestId)
      }
      this._clearRequestState(requestId)

      const tabId = this._findTabByRequest(requestId)

      // Always clean up inflight even if tab is gone
      const inflight = this.inflightRequests.get(requestId)

      if (!tabId || !this.tabs.get(tabId)) {
        if (inflight) {
          inflight.reject(err)
          this.inflightRequests.delete(requestId)
        }
        return
      }

      const tab = this.tabs.get(tabId)!

      if (this.staleRequests.has(requestId)) {
        this.staleRequests.delete(requestId)
        if (tab.activeRequestId === requestId) {
          tab.activeRequestId = null
          tab.runPid = null
        }
        if (inflight) {
          inflight.resolve()
          this.inflightRequests.delete(requestId)
        }
        return
      }

      tab.activeRequestId = null
      tab.runPid = null

      if (this.initRequestIds.has(requestId)) {
        this.initRequestIds.delete(requestId)
        log(`Init session error for tab ${tabId}: ${err.message}`)
        this._setTabStatus(tabId, 'idle')
        if (inflight) {
          inflight.reject(err)
          this.inflightRequests.delete(requestId)
        }
        this._processQueue(tabId)
        return
      }

      const resumeRetry = this.resumedRequests.get(requestId)
      if (resumeRetry) {
        this.resumedRequests.delete(requestId)
        log(`Resume process error for tab ${tabId.substring(0, 8)}… — retrying without --resume`)
        tab.claudeSessionId = null
        if (inflight) {
          inflight.resolve()
          this.inflightRequests.delete(requestId)
        }
        const retryId = `retry-${crypto.randomUUID().substring(0, 8)}`
        this._dispatch(tabId, retryId, resumeRetry.options).catch((e) => {
          log(`Retry without resume failed: ${(e as Error).message}`)
          this._setTabStatus(tabId, 'failed')
        })
        return
      }

      this._setTabStatus(tabId, 'dead')

      const enriched = this.runManager.getEnrichedError(requestId, null)
      enriched.message = err.message
      this.emit('error', tabId, enriched)

      if (inflight) {
        inflight.reject(err)
        this.inflightRequests.delete(requestId)
      }
    })
  }

  private _emitNormalizedEvent(requestId: string, tabId: string, event: NormalizedEvent): void {
    const askEvent = this._captureAskUserQuestionEvent(requestId, event)
    if (event.type === 'ask_user_question') {
      this.askUserQuestionHarness.register(tabId, requestId, event)
      this.emit('event', tabId, event)
      return
    }
    if (askEvent) {
      this.askUserQuestionHarness.register(tabId, requestId, askEvent)
      this.emit('event', tabId, askEvent)
    }
    this.emit('event', tabId, event)
  }

  private _captureAskUserQuestionEvent(requestId: string, event: NormalizedEvent): AskUserQuestionEvent | null {
    if (event.type === 'tool_call') {
      if (!isAskUserQuestionToolName(event.toolName)) return null
      const buffers = this._askToolBuffersForRequest(requestId)
      buffers.set(askToolBufferKey(event.toolId, event.index), {
        toolName: event.toolName,
        toolId: event.toolId,
        index: event.index,
        input: '',
      })
      return null
    }

    if (event.type === 'tool_call_update') {
      const buffer = this._findAskToolBuffer(requestId, event.toolId, event.index)
      if (buffer) buffer.input += event.partialInput
      return null
    }

    if (event.type === 'tool_call_complete') {
      const buffers = this.askQuestionToolBuffers.get(requestId)
      const buffer = this._findAskToolBuffer(requestId, event.toolId, event.index)
      if (!buffer) return null
      buffers?.delete(askToolBufferKey(buffer.toolId, buffer.index))
      if (buffers && buffers.size === 0) this.askQuestionToolBuffers.delete(requestId)
      const normalized = normalizeAskUserQuestionToolInput(buffer.input, buffer.toolId || event.toolId || '')
      return normalized && normalized.type === 'ask_user_question' ? normalized : null
    }

    return null
  }

  private _askToolBuffersForRequest(requestId: string): Map<string, AskUserQuestionToolBuffer> {
    let buffers = this.askQuestionToolBuffers.get(requestId)
    if (!buffers) {
      buffers = new Map()
      this.askQuestionToolBuffers.set(requestId, buffers)
    }
    return buffers
  }

  private _findAskToolBuffer(requestId: string, toolId?: string, index?: number): AskUserQuestionToolBuffer | null {
    const buffers = this.askQuestionToolBuffers.get(requestId)
    if (!buffers) return null
    if (toolId) {
      const byToolId = buffers.get(askToolBufferKey(toolId, index))
      if (byToolId) return byToolId
    }
    if (typeof index === 'number') {
      const byIndex = buffers.get(askToolBufferKey('', index))
      if (byIndex) return byIndex
      for (const buffer of buffers.values()) {
        if (buffer.index === index) return buffer
      }
    }
    return null
  }

  private _clearRequestState(requestId: string): void {
    this.askQuestionToolBuffers.delete(requestId)
    this.askUserQuestionHarness.clearRequest(requestId)
    this.lastRequestOptions.delete(requestId)
  }

  /**
   * Wire PtyRunManager events using the same routing logic as RunManager.
   */
  private _wirePtyEvents(): void {
    // Normalized events → same routing as RunManager
    this.ptyRunManager.on('normalized', (requestId: string, event: NormalizedEvent) => {
      if (this.staleRequests.has(requestId)) return

      const tabId = this._findTabByRequest(requestId)
      if (!tabId) return

      const tab = this.tabs.get(tabId)
      if (!tab) return

      tab.lastActivityAt = Date.now()

      // Handle session init
      if (event.type === 'session_init') {
        tab.claudeSessionId = event.sessionId

        if (this.initRequestIds.has(requestId)) {
          this.emit('event', tabId, { ...event, isWarmup: true })
          return
        }

        if (tab.status === 'connecting') {
          this._setTabStatus(tabId, 'running')
        }
      }

      // Suppress events from init requests
      if (this.initRequestIds.has(requestId)) return

      this._emitNormalizedEvent(requestId, tabId, event)
    })

    // Exit events
    this.ptyRunManager.on('exit', (requestId: string, code: number | null, signal: number | null, sessionId: string | null) => {
      // Clean up per-run token
      const runToken = this.runTokens.get(requestId)
      if (runToken) {
        this.permissionServer.unregisterRun(runToken)
        this.runTokens.delete(requestId)
      }
      this._clearRequestState(requestId)

      const tabId = this._findTabByRequest(requestId)
      const inflight = this.inflightRequests.get(requestId)

      // Clean up PTY run tracking
      this.ptyRuns.delete(requestId)

      if (!tabId || !this.tabs.get(tabId)) {
        if (inflight) {
          inflight.resolve()
          this.inflightRequests.delete(requestId)
        }
        return
      }

      const tab = this.tabs.get(tabId)!
      tab.activeRequestId = null
      tab.runPid = null
      if (sessionId) tab.claudeSessionId = sessionId

      if (this.initRequestIds.has(requestId)) {
        this.initRequestIds.delete(requestId)
        this._setTabStatus(tabId, 'idle')
        if (inflight) {
          inflight.resolve()
          this.inflightRequests.delete(requestId)
        }
        this._processQueue(tabId)
        return
      }

      if (code === 0) {
        this._setTabStatus(tabId, 'completed')
      } else if (signal) {
        this._setTabStatus(tabId, 'failed')
      } else {
        const enriched = this.ptyRunManager.getEnrichedError(requestId, code)
        this.emit('error', tabId, enriched)
        this._setTabStatus(tabId, code === null ? 'dead' : 'failed')
      }

      if (inflight) {
        inflight.resolve()
        this.inflightRequests.delete(requestId)
      }

      this._processQueue(tabId)
    })

    // Error events
    this.ptyRunManager.on('error', (requestId: string, err: Error) => {
      // Clean up per-run token
      const runToken = this.runTokens.get(requestId)
      if (runToken) {
        this.permissionServer.unregisterRun(runToken)
        this.runTokens.delete(requestId)
      }
      this._clearRequestState(requestId)

      const tabId = this._findTabByRequest(requestId)
      const inflight = this.inflightRequests.get(requestId)

      this.ptyRuns.delete(requestId)

      if (!tabId || !this.tabs.get(tabId)) {
        if (inflight) {
          inflight.reject(err)
          this.inflightRequests.delete(requestId)
        }
        return
      }

      const tab = this.tabs.get(tabId)!
      tab.activeRequestId = null
      tab.runPid = null

      if (this.initRequestIds.has(requestId)) {
        this.initRequestIds.delete(requestId)
        log(`PTY init session error for tab ${tabId}: ${err.message}`)
        this._setTabStatus(tabId, 'idle')
        if (inflight) {
          inflight.reject(err)
          this.inflightRequests.delete(requestId)
        }
        this._processQueue(tabId)
        return
      }

      this._setTabStatus(tabId, 'dead')

      const enriched = this.ptyRunManager.getEnrichedError(requestId, null)
      enriched.message = err.message
      this.emit('error', tabId, enriched)

      if (inflight) {
        inflight.reject(err)
        this.inflightRequests.delete(requestId)
      }
    })
  }

  // ─── Tab Lifecycle ───

  createTab(): string {
    const tabId = crypto.randomUUID()
    const entry: TabRegistryEntry = {
      tabId,
      claudeSessionId: null,
      status: 'idle',
      activeRequestId: null,
      runPid: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      promptCount: 0,
    }
    this.tabs.set(tabId, entry)
    log(`Tab created: ${tabId}`)
    return tabId
  }

  initSession(tabId: string, systemPrompt?: string): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    if (this.warmHandles.has(tabId)) return
    if (tab.activeRequestId) return

    const requestId = `warm-${tabId}`
    this.initRequestIds.add(requestId)

    const cwd = process.env.HOME || process.cwd()

    Promise.race([
      this.hookServerReady,
      new Promise<void>((r) => setTimeout(r, 2500)),
    ]).then(() => {
      if (!this.tabs.has(tabId)) {
        this.initRequestIds.delete(requestId)
        return
      }

      const runOptions: RunOptions = {
        prompt: '',
        projectPath: cwd,
        cliPermissionMode: this.permissionMode === 'auto' ? 'bypassPermissions' : undefined,
        systemPrompt: systemPrompt || undefined,
      }

      if (this.permissionServer.getPort()) {
        const runToken = this.permissionServer.registerRun(tabId, requestId, null)
        this.runTokens.set(requestId, runToken)
        try {
          runOptions.hookSettingsPath = this.permissionServer.generateSettingsFile(runToken)
        } catch (err) {
          log(`Failed to generate hook settings: ${(err as Error).message}`)
          this.permissionServer.unregisterRun(runToken)
          this.runTokens.delete(requestId)
        }
      }

      try {
        const handle = this.runManager.startRun(requestId, runOptions, { keepAlive: true, skipPrompt: true })
        this.warmHandles.set(tabId, { requestId, cwd })
        log(`Warm process spawned for tab ${tabId.substring(0, 8)}…: PID ${handle.pid}`)
      } catch (err) {
        this.initRequestIds.delete(requestId)
        const rt = this.runTokens.get(requestId)
        if (rt) { this.permissionServer.unregisterRun(rt); this.runTokens.delete(requestId) }
        log(`Failed to spawn warm process: ${(err as Error).message}`)
      }
    }).catch((err) => {
      this.initRequestIds.delete(requestId)
      log(`Init session failed: ${(err as Error).message}`)
    })
  }

  /**
   * Clear stored session ID for a tab — used when working directory changes
   * so _dispatch won't inject a stale --resume from the old directory.
   */
  resetTabSession(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    log(`Resetting session for tab ${tabId} (was: ${tab.claudeSessionId})`)
    tab.claudeSessionId = null

    const warm = this.warmHandles.get(tabId)
    if (warm) {
      this.warmHandles.delete(tabId)
      this.initRequestIds.delete(warm.requestId)
      this.runManager.cancel(warm.requestId)
      const rt = this.runTokens.get(warm.requestId)
      if (rt) { this.permissionServer.unregisterRun(rt); this.runTokens.delete(warm.requestId) }
    }
  }

  /**
   * Set global permission mode.
   * 'ask' = show permission cards, 'auto' = auto-approve all tool calls.
   */
  setPermissionMode(mode: 'ask' | 'auto'): void {
    log(`Permission mode set to: ${mode}`)
    this.permissionMode = mode
  }

  closeTab(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return

    const warm = this.warmHandles.get(tabId)
    if (warm) {
      this.warmHandles.delete(tabId)
      this.initRequestIds.delete(warm.requestId)
      this.runManager.cancel(warm.requestId)
      const rt = this.runTokens.get(warm.requestId)
      if (rt) { this.permissionServer.unregisterRun(rt); this.runTokens.delete(warm.requestId) }
    }

    if (tab.activeRequestId) {
      this.cancel(tab.activeRequestId)

      const inflight = this.inflightRequests.get(tab.activeRequestId)
      if (inflight) {
        inflight.reject(new Error('Tab closed'))
        this.inflightRequests.delete(tab.activeRequestId)
      }
    }

    this.requestQueue = this.requestQueue.filter((r) => {
      if (r.tabId === tabId) {
        const reason = new Error('Tab closed')
        r.reject(reason)
        for (const w of r.extraWaiters) w.reject(reason)
        return false
      }
      return true
    })

    this.tabs.delete(tabId)
    this.askUserQuestionHarness.clearTab(tabId)
    log(`Tab closed: ${tabId}`)
  }

  // ─── Submit Prompt ───

  /**
   * Submit a prompt to a specific tab. Returns a promise that resolves
   * when the run completes.
   *
   * Guards:
   *  - Rejects without targetSession (tabId)
   *  - Returns existing promise for duplicate requestId (idempotency)
   *  - Queues if tab is busy, rejects if queue is full
   */
  async submitPrompt(
    tabId: string,
    requestId: string,
    options: RunOptions,
  ): Promise<void> {
    // ─── Guard: target session required ───
    if (!tabId) {
      throw new Error('No targetSession (tabId) provided — rejecting to prevent misrouting')
    }

    const tab = this.tabs.get(tabId)
    if (!tab) {
      throw new Error(`Tab ${tabId} does not exist`)
    }

    // ─── Guard: requestId idempotency (check inflight AND queue) ───
    const existing = this.inflightRequests.get(requestId)
    if (existing) {
      log(`Duplicate requestId ${requestId} — returning existing inflight promise`)
      return existing.promise
    }

    const queued = this.requestQueue.find((r) => r.requestId === requestId)
    if (queued) {
      log(`Duplicate requestId ${requestId} — already queued, adding waiter`)
      return new Promise<void>((resolve, reject) => {
        queued.extraWaiters.push({ resolve, reject })
      })
    }

    // ─── If tab has an active run, queue the request ───
    if (tab.activeRequestId) {
      if (this.requestQueue.length >= MAX_QUEUE_DEPTH) {
        throw new Error('Request queue full — back-pressure')
      }

      log(`Tab ${tabId} busy — queuing request ${requestId} (queue depth: ${this.requestQueue.length + 1})`)
      return new Promise<void>((resolve, reject) => {
        this.requestQueue.push({
          requestId,
          tabId,
          options,
          resolve,
          reject,
          enqueuedAt: Date.now(),
          extraWaiters: [],
        })
      })
    }

    // ─── Dispatch immediately ───
    return this._dispatch(tabId, requestId, options)
  }

  private async _dispatch(tabId: string, requestId: string, options: RunOptions): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error(`Tab ${tabId} disappeared`)

    const isCodex = options.provider === 'codex'
    const warm = this.warmHandles.get(tabId)
    const hasSessionToResume = !!(options.sessionId || tab.claudeSessionId)

    if (warm && isCodex) {
      this.warmHandles.delete(tabId)
      this.initRequestIds.delete(warm.requestId)
      this.runManager.cancel(warm.requestId)
      const rt = this.runTokens.get(warm.requestId)
      if (rt) { this.permissionServer.unregisterRun(rt); this.runTokens.delete(warm.requestId) }
      log(`Cancelled warm process for tab ${tabId.substring(0, 8)}… — switching to Codex`)
    }

    if (warm && !isCodex && hasSessionToResume) {
      this.warmHandles.delete(tabId)
      this.initRequestIds.delete(warm.requestId)
      this.runManager.cancel(warm.requestId)
      const rt = this.runTokens.get(warm.requestId)
      if (rt) { this.permissionServer.unregisterRun(rt); this.runTokens.delete(warm.requestId) }
      log(`Cancelled warm process for tab ${tabId.substring(0, 8)}… — resuming session`)
    }

    if (warm && !isCodex && !hasSessionToResume) {
      this.warmHandles.delete(tabId)
      this.initRequestIds.delete(warm.requestId)

      if (warm.model !== options.model) {
        this.runManager.cancel(warm.requestId)
        const rt = this.runTokens.get(warm.requestId)
        if (rt) { this.permissionServer.unregisterRun(rt); this.runTokens.delete(warm.requestId) }
        log(`Warm model mismatch (${warm.model ?? 'default'} → ${options.model ?? 'default'}) — spawning new`)
      } else {
        const oldToken = this.runTokens.get(warm.requestId)
        if (oldToken) {
          this.runTokens.delete(warm.requestId)
          this.runTokens.set(requestId, oldToken)
        }

        const handle = this.runManager.reuseRun(warm.requestId, requestId, options)
        if (handle) {
          tab.activeRequestId = requestId
          tab.promptCount++
          tab.lastActivityAt = Date.now()
          tab.runPid = handle.pid
          this._setTabStatus(tabId, 'running')
          log(`Reused warm process for tab ${tabId.substring(0, 8)}… (PID ${handle.pid})`)

          let resolve!: (value: void) => void
          let reject!: (reason: Error) => void
          const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
          this.inflightRequests.set(requestId, { requestId, tabId, promise, resolve, reject })
          return promise
        }

        log(`Warm process reuse failed for tab ${tabId.substring(0, 8)}… — spawning new`)
        const rt = this.runTokens.get(warm.requestId)
        if (rt) { this.permissionServer.unregisterRun(rt); this.runTokens.delete(warm.requestId) }
      }
    }

    await Promise.race([
      this.hookServerReady,
      new Promise<void>((r) => setTimeout(r, 2500)),
    ])

    if (!options.sessionId && tab.claudeSessionId) {
      options = { ...options, sessionId: tab.claudeSessionId }
    }
    if (options.sessionId) {
      this.resumedRequests.set(requestId, { tabId, options: { ...options, sessionId: undefined } })
    }

    if (this.permissionServer.getPort()) {
      const runToken = this.permissionServer.registerRun(tabId, requestId, options.sessionId || null)
      this.runTokens.set(requestId, runToken)
      try {
        const hookSettingsPath = this.permissionServer.generateSettingsFile(runToken)
        options = { ...options, hookSettingsPath }
      } catch (err) {
        log(`Failed to generate hook settings file: ${(err as Error).message} — running without permission hook`)
        this.permissionServer.unregisterRun(runToken)
        this.runTokens.delete(requestId)
      }
    }

    if (this.permissionMode === 'auto') {
      options = { ...options, cliPermissionMode: 'bypassPermissions' }
    }

    this.lastRequestOptions.set(requestId, options)

    tab.activeRequestId = requestId
    if (!this.initRequestIds.has(requestId)) tab.promptCount++
    tab.lastActivityAt = Date.now()

    if (!this.initRequestIds.has(requestId)) {
      const newStatus: TabStatus = tab.claudeSessionId ? 'running' : 'connecting'
      this._setTabStatus(tabId, newStatus)
    }

    const usePty = false

    let pid: number | null = null
    try {
      if (usePty) {
        log(`Dispatching via PTY transport: ${requestId}`)
        const handle = this.ptyRunManager.startRun(requestId, options)
        this.ptyRuns.add(requestId)
        pid = handle.pid
      } else {
        const handle = this.runManager.startRun(requestId, options, { keepAlive: !isCodex })
        pid = handle.pid
      }
      tab.runPid = pid
    } catch (err) {
      tab.activeRequestId = null
      tab.runPid = null
      const runToken = this.runTokens.get(requestId)
      if (runToken) {
        this.permissionServer.unregisterRun(runToken)
        this.runTokens.delete(requestId)
      }
      this._setTabStatus(tabId, 'failed')
      throw err
    }

    let resolve!: (value: void) => void
    let reject!: (reason: Error) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })

    this.inflightRequests.set(requestId, { requestId, tabId, promise, resolve, reject })
    return promise
  }

  // ─── Cancel ───

  cancel(requestId: string): boolean {
    // Check if it's in the queue first
    const queueIdx = this.requestQueue.findIndex((r) => r.requestId === requestId)
    if (queueIdx !== -1) {
      const req = this.requestQueue.splice(queueIdx, 1)[0]
      const reason = new Error('Request cancelled')
      req.reject(reason)
      for (const w of req.extraWaiters) w.reject(reason)
      log(`Cancelled queued request ${requestId}`)
      return true
    }

    // Cancel active run — route to correct transport
    if (this.ptyRuns.has(requestId)) {
      return this.ptyRunManager.cancel(requestId)
    }
    return this.runManager.cancel(requestId)
  }

  /**
   * Cancel active run on a tab (by tabId instead of requestId).
   */
  cancelTab(tabId: string): boolean {
    const tab = this.tabs.get(tabId)
    if (!tab?.activeRequestId) return false
    return this.cancel(tab.activeRequestId)
  }

  async interruptAndSend(tabId: string, requestId: string, options: RunOptions): Promise<void> {
    const existing = this.interruptLocks.get(tabId)
    if (existing) {
      try { await existing } catch {}
    }

    const promise = this._doInterruptAndSend(tabId, requestId, options)
    this.interruptLocks.set(tabId, promise)
    try {
      await promise
    } finally {
      if (this.interruptLocks.get(tabId) === promise) {
        this.interruptLocks.delete(tabId)
      }
    }
  }

  private async _doInterruptAndSend(tabId: string, requestId: string, options: RunOptions): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error(`Tab ${tabId} does not exist`)

    if (tab.activeRequestId) {
      const oldRequestId = tab.activeRequestId
      this.staleRequests.add(oldRequestId)

      this.requestQueue = this.requestQueue.filter((r) => {
        if (r.tabId === tabId) {
          const reason = new Error('Interrupted by user message')
          r.reject(reason)
          for (const w of r.extraWaiters) w.reject(reason)
          return false
        }
        return true
      })

      this.cancel(oldRequestId)

      await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 10000
        const check = () => {
          const current = this.tabs.get(tabId)
          if (!current?.activeRequestId) {
            resolve()
            return
          }
          if (Date.now() > deadline) {
            if (current) {
              current.activeRequestId = null
              current.runPid = null
            }
            log(`interruptAndSend: timeout waiting for cancel on tab ${tabId}, force-clearing`)
            resolve()
            return
          }
          setTimeout(check, 30)
        }
        check()
      })
    }

    const currentTab = this.tabs.get(tabId)
    if (currentTab && (currentTab.status === 'failed' || currentTab.status === 'dead' || currentTab.status === 'completed')) {
      if (currentTab.status === 'dead') {
        currentTab.claudeSessionId = null
      }
      this._setTabStatus(tabId, 'idle')
    }

    return this.submitPrompt(tabId, requestId, options)
  }

  async retry(tabId: string, requestId: string, options: RunOptions): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error(`Tab ${tabId} does not exist`)

    // If dead, clear session so a new one starts
    if (tab.status === 'dead') {
      tab.claudeSessionId = null
      this._setTabStatus(tabId, 'idle')
    }

    return this.submitPrompt(tabId, requestId, options)
  }

  // ─── Permission Response ───

  respondToPermission(tabId: string, questionId: string, optionId: string): boolean {
    // Route to hook server if this is a hook-based permission request.
    // Pass optionId directly — it matches the permission card option IDs
    // (allow, allow-session, allow-domain, deny).
    if (questionId.startsWith('hook-')) {
      return this.permissionServer.respondToPermission(questionId, optionId)
    }

    const tab = this.tabs.get(tabId)
    if (!tab?.activeRequestId) return false

    // Route to correct transport
    if (this.ptyRuns.has(tab.activeRequestId)) {
      return this.ptyRunManager.respondToPermission(tab.activeRequestId, questionId, optionId)
    }

    // Print-json transport: send structured permission response via stdin
    const msg = {
      type: 'permission_response',
      question_id: questionId,
      option_id: optionId,
    }

    return this.runManager.writeToStdin(tab.activeRequestId, msg)
  }

  respondToUserQuestion(payload: AskUserQuestionResolvePayload): boolean {
    this.askUserQuestionHarness.complete(payload.tabId, payload.questionId)
    return true
  }

  // ─── Health ───

  getHealth(): HealthReport {
    const tabEntries: HealthReport['tabs'] = []

    for (const [tabId, tab] of this.tabs) {
      let alive = false
      if (tab.activeRequestId) {
        alive = this.runManager.isRunning(tab.activeRequestId)
          || this.ptyRunManager.isRunning(tab.activeRequestId)
      }

      tabEntries.push({
        tabId,
        status: tab.status,
        activeRequestId: tab.activeRequestId,
        claudeSessionId: tab.claudeSessionId,
        alive,
      })
    }

    return {
      tabs: tabEntries,
      queueDepth: this.requestQueue.length,
    }
  }

  getTabStatus(tabId: string): TabRegistryEntry | undefined {
    return this.tabs.get(tabId)
  }

  getEnrichedError(requestId: string, exitCode: number | null): EnrichedError {
    if (this.ptyRuns.has(requestId)) {
      return this.ptyRunManager.getEnrichedError(requestId, exitCode)
    }
    return this.runManager.getEnrichedError(requestId, exitCode)
  }

  // ─── Queue Processing ───

  private _processQueue(tabId: string): void {
    // Find next queued request for this specific tab
    const idx = this.requestQueue.findIndex((r) => r.tabId === tabId)
    if (idx === -1) return

    const req = this.requestQueue.splice(idx, 1)[0]
    log(`Processing queued request ${req.requestId} for tab ${tabId}`)

    this._dispatch(tabId, req.requestId, req.options)
      .then((v) => {
        req.resolve(v)
        for (const w of req.extraWaiters) w.resolve(v)
      })
      .catch((e) => {
        req.reject(e)
        for (const w of req.extraWaiters) w.reject(e)
      })
  }

  // ─── Internal ───

  private _findTabByRequest(requestId: string): string | null {
    const inflight = this.inflightRequests.get(requestId)
    if (inflight) return inflight.tabId

    for (const [tabId, tab] of this.tabs) {
      if (tab.activeRequestId === requestId) return tabId
    }

    for (const [tabId, warm] of this.warmHandles) {
      if (warm.requestId === requestId) return tabId
    }

    return null
  }

  private _setTabStatus(tabId: string, newStatus: TabStatus): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return

    const oldStatus = tab.status
    if (oldStatus === newStatus) return

    tab.status = newStatus
    log(`Tab ${tabId}: ${oldStatus} → ${newStatus}`)
    this.emit('tab-status-change', tabId, newStatus, oldStatus)
  }

  private _calcBackoffDelay(attempt: number): number {
    const base = 500
    const maxDelay = 8000
    const delay = Math.min(base * Math.pow(2, attempt), maxDelay)
    const jitter = 1 - Math.random() * 0.25
    return Math.round(delay * jitter)
  }

  private _emitRetryFailed(tabId: string, attempt: number, reason: string): void {
    this.emit('retry-status', tabId, {
      active: false,
      attempt: 0,
      maxAttempts: 3,
      reason: `All retries exhausted: ${reason}`,
      delayMs: 0,
    })
  }

  private _tryAutomaticRetry(params: {
    requestId: string
    tabId: string
    tab: TabRegistryEntry
    code: number | null
    signal: string | null
    inflight: InflightRequest | undefined
  }): void {
    const { requestId, tabId, tab, code, signal, inflight } = params
    const existingRetry = this.activeRetryOptions.get(requestId)

    if (signal === 'SIGINT' || signal === 'SIGKILL') {
      this.activeRetryOptions.delete(requestId)
      this.lastRequestOptions.delete(requestId)
      this._setTabStatus(tabId, 'failed')
      if (inflight) {
        inflight.resolve()
        this.inflightRequests.delete(requestId)
      }
      this._processQueue(tabId)
      return
    }

    const enriched = this.getEnrichedError(requestId, code)
    const allErrorLines = enriched.stderrTail.length > 0 ? enriched.stderrTail.slice() : []
    if (enriched.message) {
      allErrorLines.push(enriched.message)
    }

    const { retryable, reason } = isRetryableError(allErrorLines)

    if (!retryable) {
      this.activeRetryOptions.delete(requestId)
      this.lastRequestOptions.delete(requestId)
      if (code === 0 && enriched.stderrTail.length > 0) {
        this._setTabStatus(tabId, 'completed')
        const lastStderr = enriched.stderrTail.slice(-3).join(' ')
        if (lastStderr.trim()) {
          this.emit('event', tabId, {
            type: 'error',
            message: lastStderr.trim(),
            isError: false,
          })
        }
      } else {
        this._setTabStatus(tabId, code === 0 ? 'completed' : 'failed')
        if (code !== 0) {
          this.emit('error', tabId, enriched)
        }
      }
      if (inflight) {
        inflight.resolve()
        this.inflightRequests.delete(requestId)
      }
      this._processQueue(tabId)
      return
    }

    const attempt = existingRetry ? existingRetry.attempt : 0
    const nextAttempt = attempt + 1

    if (nextAttempt >= 3) {
      log(`All retries exhausted for tab ${tabId.substring(0, 8)}… (${reason})`)
      this.activeRetryOptions.delete(requestId)
      this.lastRequestOptions.delete(requestId)
      this._emitRetryFailed(tabId, attempt, reason)
      this._setTabStatus(tabId, 'failed')
      this.emit('error', tabId, enriched)
      if (inflight) {
        inflight.resolve()
        this.inflightRequests.delete(requestId)
      }
      this._processQueue(tabId)
      return
    }

    const delayMs = this._calcBackoffDelay(attempt)
    const newRequestId = `retry-${crypto.randomUUID().substring(0, 8)}`

    log(`Auto-retry ${nextAttempt}/3 for tab ${tabId.substring(0, 8)}… in ${delayMs}ms (${reason})`)

    this.emit('retry-status', tabId, {
      active: true,
      attempt: nextAttempt,
      maxAttempts: 3,
      reason,
      delayMs,
    })

    const baseOptions = this.lastRequestOptions.get(requestId) ?? {
      prompt: '',
      projectPath: tabId ? (process.env.HOME || process.cwd()) : process.cwd(),
    }

    const retryOptions: RunOptions = { ...baseOptions }

    this.activeRetryOptions.set(newRequestId, {
      tabId,
      options: retryOptions,
      attempt: nextAttempt,
      reason,
    })

    tab.activeRequestId = null
    tab.runPid = null

    if (inflight) {
      inflight.resolve()
      this.inflightRequests.delete(requestId)
    }

    setTimeout(async () => {
      this.emit('retry-status', tabId, {
        active: false,
        attempt: 0,
        maxAttempts: 3,
        reason: '',
        delayMs: 0,
      })
      const currentTab = this.tabs.get(tabId)
      if (!currentTab || currentTab.activeRequestId) {
        this.activeRetryOptions.delete(newRequestId)
        this.lastRequestOptions.delete(newRequestId)
        return
      }
      try {
        await this._dispatch(tabId, newRequestId, retryOptions)
      } catch (err) {
        this.activeRetryOptions.delete(newRequestId)
        this.lastRequestOptions.delete(newRequestId)
        log(`Auto-retry dispatch failed: ${(err as Error).message}`)
        this._setTabStatus(tabId, 'failed')
        this._processQueue(tabId)
      }
    }, delayMs)
  }

  // ─── Shutdown ───

  shutdown(): void {
    log('Shutting down control plane')
    this.permissionServer.stop()
    for (const [tabId] of this.tabs) {
      this.closeTab(tabId)
    }
  }
}
