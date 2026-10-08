import { spawn, execSync, execFile, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { homedir } from 'os'
import { appendFileSync, existsSync, accessSync, constants as fsConstants } from 'fs'
import { join, dirname, delimiter } from 'path'
import { StreamParser } from './stream-parser'
import { getCliEnv } from './cli-env'
import type { ClaudeEvent, RunOptions } from '../shared/types'

const LOG_FILE = join(homedir(), '.clui-debug.log')

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try { appendFileSync(LOG_FILE, line) } catch {}
}

export interface RunHandle {
  runId: string
  sessionId: string | null
  process: ChildProcess
  parser: StreamParser
}

export class ProcessManager extends EventEmitter {
  private activeRuns = new Map<string, RunHandle>()
  private claudeBinary: string

  constructor() {
    super()
    this.claudeBinary = this.findClaudeBinary()
    log(`Claude binary: ${this.claudeBinary}`)
  }

  private findClaudeBinary(): string {
    if (process.platform === 'win32') {
      try {
        const result = execSync('where.exe claude', { encoding: 'utf-8', timeout: 3000, env: getCliEnv() }).trim()
        if (result) return result.split(/\r?\n/)[0].trim()
      } catch {}

      const home = homedir()
      const appdata = process.env.APPDATA || ''
      const winCandidates = [
        join(appdata, 'npm', 'claude.cmd'),
        join(home, '.npm-global', 'claude.cmd'),
        join(appdata, 'npm', 'claude'),
        join(home, '.npm-global', 'claude'),
      ]
      for (const c of winCandidates) {
        try {
          if (existsSync(c)) return c
        } catch {}
      }
      return 'claude'
    }

    const candidates = [
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      join(homedir(), '.npm-global/bin/claude'),
    ]

    for (const c of candidates) {
      try {
        accessSync(c, fsConstants.X_OK)
        return c
      } catch {}
    }

    try {
      const result = execSync('/bin/zsh -ilc "whence -p claude"', { encoding: 'utf-8', env: getCliEnv() }).trim()
      if (result) return result
    } catch {}

    try {
      const result = execSync('/bin/bash -lc "which claude"', { encoding: 'utf-8', env: getCliEnv() }).trim()
      if (result) return result
    } catch {}

    return 'claude'
  }

  startRun(options: RunOptions): RunHandle {
    const runId = crypto.randomUUID()
    const cwd = options.projectPath === '~' ? homedir() : options.projectPath

    const args: string[] = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode', options.cliPermissionMode || 'acceptEdits',
      '--chrome',
    ]

    if (options.sessionId) {
      args.push('--resume', options.sessionId)
    }

    if (options.allowedTools?.length) {
      args.push('--allowedTools', options.allowedTools.join(','))
    }

    if (options.maxTurns) {
      args.push('--max-turns', String(options.maxTurns))
    }

    if (options.maxBudgetUsd) {
      args.push('--max-budget-usd', String(options.maxBudgetUsd))
    }

    if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt)
    }

    log(`Starting run ${runId}: ${this.claudeBinary} ${args.join(' ')}`)
    log(`Prompt: ${options.prompt.substring(0, 200)}`)

    const env = getCliEnv()

    const binDir = dirname(this.claudeBinary)
    if (env.PATH && !env.PATH.includes(binDir)) {
      env.PATH = `${binDir}${delimiter}${env.PATH}`
    }

    const child = spawn(this.claudeBinary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env,
      shell: process.platform === 'win32' && this.claudeBinary.endsWith('.cmd'),
    })

    log(`Spawned PID: ${child.pid}`)

    const parser = StreamParser.fromStream(child.stdout!)

    const handle: RunHandle = {
      runId,
      sessionId: null,
      process: child,
      parser,
    }

    parser.on('event', (event: ClaudeEvent) => {
      log(`Event [${runId}]: ${event.type}`)
      if (event.type === 'system' && 'subtype' in event && event.subtype === 'init') {
        handle.sessionId = (event as any).session_id
      }
      this.emit('event', runId, event)
    })

    parser.on('parse-error', (line: string) => {
      log(`Parse error [${runId}]: ${line.substring(0, 200)}`)
      this.emit('parse-error', runId, line)
    })

    let finalized = false
    const finalize = (type: 'close' | 'error', codeOrErr: number | null | Error) => {
      if (finalized) return
      finalized = true
      if (this.activeRuns.get(runId) === handle) {
        this.activeRuns.delete(runId)
      }
      if (type === 'close') {
        this.emit('exit', runId, codeOrErr as number | null, handle.sessionId)
      } else {
        this.emit('error', runId, codeOrErr as Error)
      }
    }

    child.on('close', (code) => {
      log(`Process closed [${runId}]: code=${code}`)
      finalize('close', code)
    })

    child.on('error', (err) => {
      log(`Process error [${runId}]: ${err.message}`)
      finalize('error', err)
    })

    child.stderr?.setEncoding('utf-8')
    child.stderr?.on('data', (data: string) => {
      log(`Stderr [${runId}]: ${data.trim().substring(0, 500)}`)
      this.emit('stderr', runId, data)
    })

    this.activeRuns.set(runId, handle)

    try {
      child.stdin?.on('error', () => {})
      child.stdin!.write(options.prompt)
      child.stdin!.end()
    } catch (stdinErr) {
      log(`Stdin error [${runId}]: ${stdinErr}`)
      try { child.kill() } catch {}
    }

    return handle
  }

  cancelRun(runId: string): boolean {
    const handle = this.activeRuns.get(runId)
    if (!handle) return false

    log(`Cancelling run ${runId}`)

    try {
      handle.process.kill('SIGINT')
    } catch {}

    setTimeout(() => {
      if (handle.process.exitCode === null) {
        try {
          if (process.platform === 'win32' && handle.process.pid) {
            try {
              execFile('taskkill', ['/T', '/F', '/PID', String(handle.process.pid)], { timeout: 5000 }, () => {})
            } catch {
              handle.process.kill()
            }
          } else {
            handle.process.kill('SIGTERM')
          }
        } catch {}
      }
    }, 5000)

    setTimeout(() => {
      if (handle.process.exitCode === null) {
        try { handle.process.kill('SIGKILL') } catch {}
      }
    }, 10000)

    return true
  }

  isRunning(runId: string): boolean {
    return this.activeRuns.has(runId)
  }

  getActiveRunIds(): string[] {
    return Array.from(this.activeRuns.keys())
  }
}
