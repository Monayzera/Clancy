import { execFileSync } from 'child_process'
import { delimiter, join as pathJoin } from 'path'

let cachedPath: string | null = null

function appendPathEntries(target: string[], seen: Set<string>, rawPath: string | undefined, sep: string = delimiter): void {
  if (!rawPath) return
  const isWin = process.platform === 'win32'
  for (const entry of rawPath.split(sep)) {
    const p = entry.trim()
    if (!p) continue
    const key = isWin ? p.toLowerCase() : p
    if (seen.has(key)) continue
    seen.add(key)
    target.push(p)
  }
}

export function getCliPath(): string {
  if (cachedPath) return cachedPath

  const ordered: string[] = []
  const seen = new Set<string>()

  appendPathEntries(ordered, seen, process.env.PATH)

  if (process.platform === 'win32') {
    const home = process.env.USERPROFILE || (process.env.HOMEDRIVE && process.env.HOMEPATH ? `${process.env.HOMEDRIVE}${process.env.HOMEPATH}` : '')
    const appdata = process.env.APPDATA || ''
    const localappdata = process.env.LOCALAPPDATA || ''
    const winPaths: string[] = []
    if (appdata) winPaths.push(`${appdata}\\npm`)
    if (home) {
      winPaths.push(`${home}\\.npm-global`)
      winPaths.push(`${home}\\AppData\\Roaming\\npm`)
    }
    if (localappdata) winPaths.push(`${localappdata}\\Programs\\nodejs`)
    appendPathEntries(ordered, seen, winPaths.join(';'), ';')

    const psPath = pathJoin(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

    try {
      const machinePath = execFileSync(
        psPath,
        ['-NoProfile', '-NoLogo', '-Command', "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); [Environment]::GetEnvironmentVariable('PATH', 'Machine')"],
        { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
      ).trim()
      appendPathEntries(ordered, seen, machinePath, ';')
    } catch {}

    try {
      const userPath = execFileSync(
        psPath,
        ['-NoProfile', '-NoLogo', '-Command', "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); [Environment]::GetEnvironmentVariable('PATH', 'User')"],
        { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
      ).trim()
      appendPathEntries(ordered, seen, userPath, ';')
    } catch {}
  } else {
    appendPathEntries(ordered, seen, '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', ':')

    const shellCandidates: [string, string[]][] = [
      ['/bin/zsh', ['-lc', 'echo "$PATH"']],
      ['/bin/bash', ['-lc', 'echo "$PATH"']],
    ]

    for (const [shell, args] of shellCandidates) {
      try {
        const discovered = execFileSync(shell, args, { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' }).trim()
        if (discovered) {
          appendPathEntries(ordered, seen, discovered, ':')
          break
        }
      } catch {}
    }
  }

  cachedPath = ordered.join(delimiter)
  return cachedPath
}

export function getCliEnv(extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extraEnv,
    PATH: getCliPath(),
  }
  delete env.CLAUDECODE
  delete env.NODE_OPTIONS
  delete env.ELECTRON_RUN_AS_NODE
  return env
}
