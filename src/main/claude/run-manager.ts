import { spawn, execSync, execFileSync, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { homedir } from 'os'
import { join, dirname, delimiter } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import { StreamParser } from '../stream-parser'
import { normalize, normalizeCodex, createNormalizerState, type NormalizerState } from './event-normalizer'
import { log as _log } from '../logger'
import { getCliEnv } from '../cli-env'
import { getScreenToolsMcpConfig } from '../mcp/screen-tools-config'
import { getComputerUseMcpConfig } from '../mcp/computer-use-config'
import { hasUsageData } from '../../shared/usage'
import type { ClaudeEvent, NormalizedEvent, RunOptions, EnrichedError, UsageData } from '../../shared/types'

const MAX_RING_LINES = 100
const DEBUG = process.env.CLUI_DEBUG === '1'

// Appended to Claude's default system prompt so it knows it's running inside CLUI.
// Uses --append-system-prompt (additive) not --system-prompt (replacement).
const CLUI_SYSTEM_HINT = [
  'IMPORTANT: You are NOT running in a terminal. You are running inside CLUI,',
  'a desktop chat application with a rich UI that renders full markdown.',
  'CLUI is a desktop coding interface — the user sees your output in a',
  'styled conversation view, not a raw terminal.',
  '',
  'Because CLUI renders markdown natively, you MUST use rich formatting when it helps:',
  '- Always use clickable markdown links: [label](https://url) — they render as real buttons.',
  '- When the user asks for images, and public web images are appropriate, proactively find and render them in CLUI.',
  '- Workflow: WebSearch for relevant public pages -> WebFetch those pages -> extract real image URLs -> render with markdown ![alt](url).',
  '- Do not guess, fabricate, or construct image URLs from memory.',
  '- Only embed images when the URL is a real publicly accessible image URL found through tools or explicitly provided by the user.',
  '- If real image URLs cannot be obtained confidently, fall back to clickable links and briefly say so.',
  '- Do not ask whether CLUI can render images; assume it can.',
  '- Use tables, bold, headers, and bullet lists freely — they all render beautifully.',
  '- Use code blocks with language tags for syntax highlighting.',
  '',
  'You are still a software engineering assistant. Keep using your tools (Read, Edit, Bash, etc.)',
  'normally. But when presenting information, links, resources, or explanations to the user,',
  'take full advantage of the rich UI. The user expects a polished chat experience, not raw terminal text.',
].join('\n')

// Tools auto-approved via --allowedTools (never trigger the permission card).
// Includes routine internal agent mechanics (Agent, Task, TaskOutput, TodoWrite,
// Notebook) — prompting for these would make UX terrible without adding meaningful
// safety. This is a deliberate CLUI policy choice, not native Claude parity.
// If runtime evidence shows any of these create real user-facing approval moments,
// they should be moved to the hook matcher in permission-server.ts instead.
const SAFE_TOOLS = [
  'Read', 'Glob', 'Grep', 'LS',
  'TodoRead', 'TodoWrite',
  'Agent', 'Task', 'TaskOutput',
  'Notebook',
  'WebSearch', 'WebFetch',
  'ExitPlanMode', 'EnterPlanMode',
  'capture_screenshot',
  'get_mouse_position',
  'browser_screenshot',
  'browser_extract',
  'browser_info',
]

const INTERACTION_TOOLS = [
  'AskUserQuestion',
]

const COMPUTER_USE_TOOLS = [
  'move_mouse', 'click_mouse', 'scroll_mouse', 'drag_mouse',
  'type_text', 'press_key',
  'browser_navigate', 'browser_execute_js', 'browser_click', 'browser_type', 'browser_close',
]

const HOOK_ALLOWED_TOOLS = [
  ...SAFE_TOOLS,
  ...INTERACTION_TOOLS,
  ...COMPUTER_USE_TOOLS,
]

const DEFAULT_ALLOWED_TOOLS = [
  ...HOOK_ALLOWED_TOOLS,
]

function uniqueTools(tools: string[]): string[] {
  return [...new Set(tools.filter(Boolean))]
}

function log(msg: string): void {
  _log('RunManager', msg)
}

function summarizeStdinMessage(message: object): string {
  const data = message as Record<string, any>
  if (data.type === 'user') {
    const content = Array.isArray(data.message?.content) ? data.message.content : []
    const blockTypes = content.map((block: any) => typeof block?.type === 'string' ? block.type : 'unknown').join(',')
    return `type=user role=${data.message?.role || 'unknown'} blocks=${blockTypes || 'none'}`
  }
  if (data.type === 'permission_response') {
    return `type=permission_response question=${String(data.question_id || '').substring(0, 40)} option=${String(data.option_id || '').substring(0, 40)}`
  }
  return `type=${String(data.type || 'unknown')}`
}

export interface RunHandle {
  runId: string
  sessionId: string | null
  process: ChildProcess
  pid: number | null
  startedAt: number
  stderrTail: string[]
  stdoutTail: string[]
  toolCallCount: number
  sawPermissionRequest: boolean
  permissionDenials: Array<{ tool_name: string; tool_use_id: string }>
  keepAlive: boolean
  model?: string
  codexTextLengths: Map<string, number>
  codexFallbackUsage?: UsageData
  normalizerState: NormalizerState
}

/**
 * RunManager: spawns one `claude -p` process per run, parses NDJSON,
 * emits normalized events, handles cancel, and keeps diagnostic ring buffers.
 *
 * Events emitted:
 *  - 'normalized' (runId, NormalizedEvent)
 *  - 'raw' (runId, ClaudeEvent)  — for logging/debugging
 *  - 'exit' (runId, code, signal, sessionId)
 *  - 'error' (runId, Error)
 */
export class RunManager extends EventEmitter {
  private activeRuns = new Map<string, RunHandle>()
  private _finishedRuns = new Map<string, RunHandle>()
  private claudeBinary: string
  private openClaudeBinary: string
  private codexBinary: string

  constructor() {
    super()
    this.claudeBinary = this._findClaudeBinary()
    this.openClaudeBinary = this._findOpenClaudeBinary()
    this.codexBinary = this._findCodexBinary()
    log(`Claude binary: ${this.claudeBinary}`)
    log(`OpenClaude binary: ${this.openClaudeBinary}`)
    log(`Codex binary: ${this.codexBinary}`)
  }

  private _findClaudeBinary(): string {
    const candidates = [
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      join(homedir(), '.local/bin/claude'),
      join(homedir(), '.npm-global/bin/claude'),
    ]

    for (const c of candidates) {
      try {
        execSync(`test -x "${c}"`, { stdio: 'ignore' })
        return c
      } catch {}
    }

    try {
      return execSync('/bin/zsh -ilc "whence -p claude"', { encoding: 'utf-8', env: getCliEnv() }).trim()
    } catch {}

    try {
      return execSync('/bin/bash -lc "which claude"', { encoding: 'utf-8', env: getCliEnv() }).trim()
    } catch {}

    return 'claude'
  }

  private _findCodexBinary(): string {
    const candidates = [
      '/usr/local/bin/codex',
      '/opt/homebrew/bin/codex',
      join(homedir(), '.npm-global/bin/codex'),
    ]

    for (const c of candidates) {
      try {
        execSync(`test -x "${c}"`, { stdio: 'ignore' })
        return c
      } catch {}
    }

    try {
      return execSync('/bin/zsh -ilc "whence -p codex"', { encoding: 'utf-8', env: getCliEnv() }).trim()
    } catch {}

    try {
      return execSync('/bin/bash -lc "which codex"', { encoding: 'utf-8', env: getCliEnv() }).trim()
    } catch {}

    return 'codex'
  }

  private _findOpenClaudeBinary(): string {
    if (process.platform === 'win32') {
      const candidates = [
        join(process.cwd(), 'vendor', 'openclaude', 'bin', 'openclaude.cmd'),
        join(__dirname, '..', '..', '..', 'vendor', 'openclaude', 'bin', 'openclaude.cmd'),
        join(homedir(), 'AppData', 'Roaming', 'npm', 'openclaude.cmd'),
        join(homedir(), '.npm-global', 'openclaude.cmd'),
      ]

      for (const c of candidates) {
        try {
          if (existsSync(c) && statSync(c).isFile()) {
            return c
          }
        } catch {}
      }

      const resolvedCmd = this._resolveWindowsCommand('openclaude.cmd')
      if (resolvedCmd) return resolvedCmd

      const resolvedBare = this._resolveWindowsCommand('openclaude')
      if (resolvedBare) return resolvedBare

      return 'openclaude.cmd'
    }

    const candidates = [
      join(process.cwd(), 'vendor', 'openclaude', 'bin', 'openclaude'),
      join(__dirname, '..', '..', '..', 'vendor', 'openclaude', 'bin', 'openclaude'),
      '/usr/local/bin/openclaude',
      '/opt/homebrew/bin/openclaude',
      join(homedir(), '.npm-global/bin/openclaude'),
    ]

    for (const c of candidates) {
      try {
        execSync(`test -x "${c}"`, { stdio: 'ignore' })
        return c
      } catch {}
    }

    try {
      return execSync('/bin/zsh -ilc "whence -p openclaude"', { encoding: 'utf-8', env: getCliEnv() }).trim()
    } catch {}

    try {
      return execSync('/bin/bash -lc "which openclaude"', { encoding: 'utf-8', env: getCliEnv() }).trim()
    } catch {}

    return 'openclaude'
  }

  private _resolveWindowsCommand(command: string): string | null {
    if (process.platform !== 'win32') return null
    const value = command.trim()
    if (!value) return null

    const names = /\.(cmd|bat|exe)$/i.test(value)
      ? [value]
      : [`${value}.cmd`, `${value}.bat`, `${value}.exe`, value]

    for (const name of names) {
      try {
        const resolved = execFileSync('where.exe', [name], {
          encoding: 'utf-8',
          timeout: 3000,
          env: getCliEnv(),
          windowsHide: true,
        })
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.length > 0)
        if (resolved) return resolved
      } catch {}
    }

    return null
  }

  private _resolveOpenClaudeBinary(configuredOpenClaude?: string): string {
    const configured = configuredOpenClaude?.trim()
    const candidate = configured && configured.length > 0 ? configured : this.openClaudeBinary
    if (process.platform !== 'win32') return candidate

    const raw = candidate.trim().replace(/^"(.*)"$/, '$1')
    if (!raw) return this.openClaudeBinary
    if (/\.(cmd|bat|exe)$/i.test(raw)) return raw

    const hasPathSeparator = raw.includes('\\') || raw.includes('/')
    if (hasPathSeparator) {
      const pathCandidates = [`${raw}.cmd`, `${raw}.bat`, `${raw}.exe`]
      for (const p of pathCandidates) {
        try {
          if (existsSync(p) && statSync(p).isFile()) {
            return p
          }
        } catch {}
      }
      const fileName = raw.split(/[\\/]/).pop() || ''
      const resolved = fileName ? this._resolveWindowsCommand(fileName) : null
      if (resolved) return resolved
      const fallback = this._resolveWindowsCommand('openclaude.cmd')
      if (fallback) return fallback
      return raw
    }

    const resolved = this._resolveWindowsCommand(raw)
    if (resolved) return resolved
    const fallback = this._resolveWindowsCommand('openclaude.cmd')
    if (fallback) return fallback
    return raw
  }

  private _resolveOpenClaudeNodeScript(binary: string): string | null {
    if (process.platform !== 'win32') return null
    const raw = binary.trim().replace(/^"(.*)"$/, '$1')
    if (!/\.cmd$/i.test(raw)) return null
    if (!existsSync(raw)) return null

    const shimDir = dirname(raw)
    const candidates = [
      join(shimDir, 'node_modules', '@gitlawb', 'openclaude', 'bin', 'openclaude'),
      join(shimDir, 'node_modules', '@gitlawb', 'openclaude', 'dist', 'cli.mjs'),
    ]
    for (const c of candidates) {
      try {
        if (existsSync(c) && statSync(c).isFile()) {
          return c
        }
      } catch {}
    }
    return null
  }

  private _getEnv(provider?: string, options?: RunOptions): NodeJS.ProcessEnv {
    const env = getCliEnv()
    const configuredOpenClaude = options?.openRouter?.openClaudePath?.trim()
    const binary = provider === 'codex'
      ? this.codexBinary
      : provider === 'openclaude'
        ? this._resolveOpenClaudeBinary(configuredOpenClaude)
        : this.claudeBinary
    const binDir = dirname(binary)
    if (binDir && binDir !== '.') {
      const pathEntries = (env.PATH || '')
        .split(delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean)
      const hasBinDir = pathEntries.some((entry) =>
        process.platform === 'win32' ? entry.toLowerCase() === binDir.toLowerCase() : entry === binDir
      )
      if (!hasBinDir) {
        env.PATH = env.PATH ? `${binDir}${delimiter}${env.PATH}` : binDir
      }
    }

    if (provider === 'openclaude') {
      const openRouter = options?.openRouter
      if (openRouter?.enabled) {
        env.CLAUDE_CODE_USE_OPENAI = '1'
        if (openRouter.apiKey) {
          env.OPENAI_API_KEY = openRouter.apiKey
          env.OPENROUTER_API_KEY = openRouter.apiKey
        }
        if (openRouter.baseUrl) {
          env.OPENAI_BASE_URL = openRouter.baseUrl
        }
        if (openRouter.model) {
          env.OPENAI_MODEL = openRouter.model
        }
        if (openRouter.httpReferer) {
          env.OPENROUTER_HTTP_REFERER = openRouter.httpReferer
        }
        if (openRouter.appTitle) {
          env.OPENROUTER_APP_TITLE = openRouter.appTitle
        }
      }
    }

    return env
  }

  private _toTomlString(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }

  private _toTomlArray(values: string[]): string {
    return `[${values.map((v) => this._toTomlString(v)).join(', ')}]`
  }

  private _toTomlInlineTable(values: Record<string, string>): string {
    const entries = Object.entries(values).map(([k, v]) => `${k} = ${this._toTomlString(v)}`)
    return `{ ${entries.join(', ')} }`
  }

  private _resolveSessionCwd(sessionId: string): string | null {
    const projectsBase = join(homedir(), '.claude', 'projects')
    try {
      const dirs = readdirSync(projectsBase)
      for (const dir of dirs) {
        if (existsSync(join(projectsBase, dir, `${sessionId}.jsonl`))) {
          return this._decodeEncodedDir(dir)
        }
      }
    } catch {}
    return null
  }

  private _decodeEncodedDir(encoded: string): string {
    if (process.platform === 'win32') {
      const parts = encoded.split('-')
      const driveLetter = parts[0]
      if (!driveLetter || driveLetter.length !== 1) return homedir()
      const baseDir = driveLetter.toUpperCase() + ':\\'
      const startIdx = parts.length > 1 && parts[1] === '' ? 2 : 1
      return this._dfsDecodeWin(parts, startIdx, baseDir) || homedir()
    }
    if (!encoded.startsWith('-')) return homedir()
    const parts = encoded.slice(1).split('-')
    return this._dfsDecode(parts, 0, '') || homedir()
  }

  private _dfsDecodeWin(parts: string[], idx: number, current: string): string | null {
    if (idx >= parts.length) return existsSync(current) ? current : null
    for (let take = 1; idx + take <= parts.length; take++) {
      const component = parts.slice(idx, idx + take).join('-')
      if (!component) continue
      const next = join(current, component)
      if (idx + take === parts.length) {
        if (existsSync(next)) return next
      } else {
        try {
          if (existsSync(next) && statSync(next).isDirectory()) {
            const found = this._dfsDecodeWin(parts, idx + take, next)
            if (found) return found
          }
        } catch {}
      }
    }
    return null
  }

  private _dfsDecode(parts: string[], idx: number, current: string): string | null {
    if (idx >= parts.length) return existsSync(current) ? current : null
    for (let take = 1; idx + take <= parts.length; take++) {
      const component = parts.slice(idx, idx + take).join('-')
      const next = current + '/' + component
      if (idx + take === parts.length) {
        if (existsSync(next)) return next
      } else {
        try {
          if (existsSync(next) && statSync(next).isDirectory()) {
            const found = this._dfsDecode(parts, idx + take, next)
            if (found) return found
          }
        } catch {}
      }
    }
    return null
  }

  startRun(requestId: string, options: RunOptions, flags?: { keepAlive?: boolean; skipPrompt?: boolean }): RunHandle {
    const isCodex = options.provider === 'codex'
    const isOpenClaude = options.provider === 'openclaude'
    const configuredOpenClaude = options.openRouter?.openClaudePath?.trim()
    const binary = isCodex ? this.codexBinary : isOpenClaude ? this._resolveOpenClaudeBinary(configuredOpenClaude) : this.claudeBinary

    let cwd = options.projectPath === '~' ? homedir() : options.projectPath
    const hasExplicitPath = typeof options.projectPath === 'string' && options.projectPath.trim() !== '' && options.projectPath !== '~'
    if (options.sessionId && !hasExplicitPath && !isCodex) {
      const sessionCwd = this._resolveSessionCwd(options.sessionId)
      if (sessionCwd) cwd = sessionCwd
    }

    let args: string[]

    if (isCodex) {
      args = ['exec', '--cd', cwd, '--json']
      const screenToolsMcp = getScreenToolsMcpConfig()
      args.push('-c', `mcp_servers.${screenToolsMcp.name}.command=${this._toTomlString(screenToolsMcp.command)}`)
      args.push('-c', `mcp_servers.${screenToolsMcp.name}.args=${this._toTomlArray(screenToolsMcp.args)}`)
      args.push('-c', `mcp_servers.${screenToolsMcp.name}.env=${this._toTomlInlineTable(screenToolsMcp.env)}`)
      const computerUseMcp = getComputerUseMcpConfig()
      args.push('-c', `mcp_servers.${computerUseMcp.name}.command=${this._toTomlString(computerUseMcp.command)}`)
      args.push('-c', `mcp_servers.${computerUseMcp.name}.args=${this._toTomlArray(computerUseMcp.args)}`)
      args.push('-c', `mcp_servers.${computerUseMcp.name}.env=${this._toTomlInlineTable(computerUseMcp.env)}`)
      if (options.model) {
        args.push('-m', options.model)
      }
      if (options.cliPermissionMode === 'bypassPermissions') {
        args.push('--dangerously-bypass-approvals-and-sandbox')
      } else {
        args.push('--full-auto')
      }
      if (options.addDirs && options.addDirs.length > 0) {
        for (const dir of options.addDirs) {
          args.push('--add-dir', dir)
        }
      }
      if (options.effort) {
        const codexEffort = options.effort === 'max' ? 'xhigh' : options.effort
        args.push('-c', `model_reasoning_effort="${codexEffort}"`)
      }
      args.push('-c', 'model_reasoning_summary="auto"')
      args.push('-c', 'hide_agent_reasoning=false')
      if (options.sessionId) {
        args.push('resume', options.sessionId, '-')
      } else {
        args.push('-')
      }
    } else {
      args = [
        '-p',
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--permission-mode', options.cliPermissionMode || 'default',
        '--tools', 'default',
      ]
      if (isOpenClaude && options.openRouter?.enabled) {
        args.push('--provider', 'openai')
      }
      if (options.sessionId) {
        args.push('--resume', options.sessionId)
      }
      if (options.model) {
        args.push('--model', options.model)
      }
      if (options.effort) {
        args.push('--effort', options.effort)
      }
      if (options.thinking) {
        args.push('--thinking', options.thinking)
      }
      if (options.addDirs && options.addDirs.length > 0) {
        for (const dir of options.addDirs) {
          args.push('--add-dir', dir)
        }
      }
      if (options.hookSettingsPath) {
        args.push('--settings', options.hookSettingsPath)
      }
      const allowedTools = uniqueTools([
        ...(options.hookSettingsPath ? HOOK_ALLOWED_TOOLS : DEFAULT_ALLOWED_TOOLS),
        ...(options.allowedTools || []),
      ])
      args.push('--allowedTools', allowedTools.join(','))
      if (options.maxTurns) {
        args.push('--max-turns', String(options.maxTurns))
      }
      if (options.maxBudgetUsd) {
        args.push('--max-budget-usd', String(options.maxBudgetUsd))
      }
      if (options.systemPrompt) {
        args.push('--system-prompt', options.systemPrompt)
      }
      args.push('--append-system-prompt', CLUI_SYSTEM_HINT)
    }

    if (DEBUG) {
      log(`Starting run ${requestId}: ${binary} ${args.join(' ')}`)
      log(`Prompt: ${options.prompt.substring(0, 200)}`)
    } else {
      log(`Starting run ${requestId} [${isCodex ? 'codex' : isOpenClaude ? 'openclaude' : 'claude'}]`)
    }

    const isWindowsCmdScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(binary)
    const openClaudeNodeScript = isOpenClaude ? this._resolveOpenClaudeNodeScript(binary) : null
    const windowsNodeBinary = openClaudeNodeScript
      ? (this._resolveWindowsCommand('node.exe') || this._resolveWindowsCommand('node') || 'node')
      : null
    const spawnBinary = openClaudeNodeScript ? windowsNodeBinary! : isWindowsCmdScript ? 'cmd.exe' : binary
    const spawnArgs = openClaudeNodeScript ? [openClaudeNodeScript, ...args] : isWindowsCmdScript ? ['/c', binary, ...args] : args

    const child = spawn(spawnBinary, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: this._getEnv(options.provider, options),
    })

    log(`Spawned PID: ${child.pid}`)

    const handle: RunHandle = {
      runId: requestId,
      sessionId: options.sessionId || null,
      process: child,
      pid: child.pid || null,
      startedAt: Date.now(),
      stderrTail: [],
      stdoutTail: [],
      toolCallCount: 0,
      sawPermissionRequest: false,
      permissionDenials: [],
      keepAlive: flags?.keepAlive ?? false,
      model: options.model,
      codexTextLengths: new Map(),
      normalizerState: createNormalizerState(),
    }

    // ─── stdout → NDJSON parser → normalizer → events ───
    const parser = StreamParser.fromStream(child.stdout!)

    parser.on('event', (raw: ClaudeEvent) => {
      if (isCodex) {
        const r = raw as any
        if (r.type === 'thread.started' && r.thread_id) {
          handle.sessionId = r.thread_id
        }
      } else {
        if (raw.type === 'system' && 'subtype' in raw && raw.subtype === 'init') {
          handle.sessionId = (raw as any).session_id
        }

        if (raw.type === 'permission_request' || (raw.type === 'system' && 'subtype' in raw && (raw as any).subtype === 'permission_request')) {
          handle.sawPermissionRequest = true
          log(`Permission request seen [${handle.runId}]`)
        }

        if (raw.type === 'result') {
          const denials = (raw as any).permission_denials
          if (Array.isArray(denials) && denials.length > 0) {
            handle.permissionDenials = denials.map((d: any) => ({
              tool_name: d.tool_name || '',
              tool_use_id: d.tool_use_id || '',
            }))
            log(`Permission denials [${handle.runId}]: ${JSON.stringify(handle.permissionDenials)}`)
          }
        }
      }

      this._ringPush(handle.stdoutTail, JSON.stringify(raw).substring(0, 300))

      this.emit('raw', handle.runId, raw)

      const normalized = isCodex ? normalizeCodex(raw) : normalize(raw, handle.normalizerState)
      for (const evt of normalized) {
        if (evt.type === 'tool_call') handle.toolCallCount++
        if (isCodex && evt.type === 'text_chunk') {
          const r = raw as any
          const payload = r?.type === 'event_msg' && r?.payload ? r.payload : r
          const item = payload?.item || r?.item
          const itemId = evt.streamId || item?.id || '_default'
          const prevLen = handle.codexTextLengths.get(itemId) || 0
          const fullText = item?.text || (evt.appendMode === 'block' ? evt.text : '')
          if (!item && evt.appendMode === 'block') {
            this.emit('normalized', handle.runId, evt)
            continue
          }
          if (!fullText) {
            this.emit('normalized', handle.runId, evt)
            continue
          }
          if (fullText.length > prevLen) {
            handle.codexTextLengths.set(itemId, fullText.length)
            this.emit('normalized', handle.runId, { type: 'text_chunk', text: fullText.substring(prevLen), streamId: itemId, appendMode: 'stream' })
          }
          continue
        }
        if (isCodex && evt.type === 'usage') {
          if (hasUsageData(evt.usage)) {
            handle.codexFallbackUsage = evt.usage
          }
          continue
        }
        if (isCodex && evt.type === 'task_complete' && !hasUsageData(evt.usage) && handle.codexFallbackUsage) {
          this.emit('normalized', handle.runId, { ...evt, usage: handle.codexFallbackUsage })
          continue
        }
        this.emit('normalized', handle.runId, evt)
      }

      if (isCodex) {
        const r = raw as any
        if (r.type === 'turn.completed' || r.type === 'turn.failed') {
          log(`Codex run complete [${handle.runId}]: type=${r.type}`)
          try { child.stdin?.end() } catch {}
        }
      } else if (raw.type === 'result') {
        const r = raw as any
        log(`Run complete [${handle.runId}]: is_error=${r.is_error} result=${(r.result || '').substring(0, 300)} sawPerm=${handle.sawPermissionRequest} denials=${handle.permissionDenials.length}`)
        if (!handle.keepAlive || r.is_error) {
          try { child.stdin?.end() } catch {}
        }
      }
    })

    parser.on('parse-error', (line: string) => {
      log(`Parse error [${handle.runId}]: ${line.substring(0, 200)}`)
      this._ringPush(handle.stderrTail, `[parse-error] ${line.substring(0, 200)}`)
    })

    child.stderr?.setEncoding('utf-8')
    child.stderr?.on('data', (data: string) => {
      const lines = data.split('\n').filter((l: string) => l.trim())
      for (const line of lines) {
        this._ringPush(handle.stderrTail, line)
      }
      log(`Stderr [${handle.runId}]: ${data.trim().substring(0, 500)}`)
    })

    child.on('close', (code, signal) => {
      const rid = handle.runId
      log(`Process closed [${rid}]: code=${code} signal=${signal}`)
      this._finishedRuns.set(rid, handle)
      this.activeRuns.delete(rid)
      this.emit('exit', rid, code, signal, handle.sessionId)
      setTimeout(() => this._finishedRuns.delete(rid), 5000)
    })

    child.on('error', (err) => {
      const rid = handle.runId
      log(`Process error [${rid}]: ${err.message}`)
      this._finishedRuns.set(rid, handle)
      this.activeRuns.delete(rid)
      this.emit('error', rid, err)
      setTimeout(() => this._finishedRuns.delete(rid), 5000)
    })

    if (!flags?.skipPrompt) {
      if (isCodex) {
        child.stdin!.write(options.prompt)
        child.stdin!.end()
      } else {
        const userMessage = JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: options.prompt }],
          },
        })
        child.stdin!.write(userMessage + '\n')
      }
    }

    this.activeRuns.set(requestId, handle)
    return handle
  }

  reuseRun(oldRequestId: string, newRequestId: string, options: RunOptions): RunHandle | null {
    const handle = this.activeRuns.get(oldRequestId)
    if (!handle) return null
    if (!handle.process.stdin || handle.process.stdin.destroyed) return null
    if (handle.process.exitCode !== null) return null

    this.activeRuns.delete(oldRequestId)
    handle.runId = newRequestId
    handle.startedAt = Date.now()
    handle.toolCallCount = 0
    handle.sawPermissionRequest = false
    handle.permissionDenials = []
    handle.codexTextLengths.clear()
    handle.codexFallbackUsage = undefined
    handle.normalizerState.blockToolIds.clear()

    const userMessage = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: options.prompt }],
      },
    })
    handle.process.stdin.write(userMessage + '\n')

    this.activeRuns.set(newRequestId, handle)
    log(`Reused process PID ${handle.pid}: ${oldRequestId.substring(0, 8)}… → ${newRequestId.substring(0, 8)}…`)
    return handle
  }

  /**
   * Write a message to a running process's stdin (for follow-up prompts, etc.)
   */
  writeToStdin(requestId: string, message: object): boolean {
    const handle = this.activeRuns.get(requestId)
    if (!handle) return false
    if (!handle.process.stdin || handle.process.stdin.destroyed) return false

    const json = JSON.stringify(message)
    log(`Writing to stdin [${requestId}]: ${summarizeStdinMessage(message)}`)
    handle.process.stdin.write(json + '\n')
    return true
  }

  /**
   * Cancel a running process: SIGINT, then SIGKILL after 5s.
   */
  cancel(requestId: string): boolean {
    const handle = this.activeRuns.get(requestId)
    if (!handle) return false

    log(`Cancelling run ${requestId}`)
    handle.process.kill('SIGINT')

    // Fallback: SIGKILL if process hasn't exited after 5s.
    // Only check exitCode — process.killed is set true by the SIGINT call above,
    // so checking !killed would prevent the fallback from ever firing.
    setTimeout(() => {
      if (handle.process.exitCode === null) {
        log(`Force killing run ${requestId} (SIGINT did not terminate)`)
        handle.process.kill('SIGKILL')
      }
    }, 5000)

    return true
  }

  /**
   * Get an enriched error object for a failed run.
   */
  getEnrichedError(requestId: string, exitCode: number | null): EnrichedError {
    const handle = this.activeRuns.get(requestId) || this._finishedRuns.get(requestId)
    return {
      message: `Run failed with exit code ${exitCode}`,
      stderrTail: handle?.stderrTail.slice(-20) || [],
      stdoutTail: handle?.stdoutTail.slice(-20) || [],
      exitCode,
      elapsedMs: handle ? Date.now() - handle.startedAt : 0,
      toolCallCount: handle?.toolCallCount || 0,
      sawPermissionRequest: handle?.sawPermissionRequest || false,
      permissionDenials: handle?.permissionDenials || [],
    }
  }

  isRunning(requestId: string): boolean {
    return this.activeRuns.has(requestId)
  }

  getHandle(requestId: string): RunHandle | undefined {
    return this.activeRuns.get(requestId)
  }

  getActiveRunIds(): string[] {
    return Array.from(this.activeRuns.keys())
  }

  private _ringPush(buffer: string[], line: string): void {
    buffer.push(line)
    if (buffer.length > MAX_RING_LINES) {
      buffer.shift()
    }
  }
}
