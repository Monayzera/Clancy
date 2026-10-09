import { execFile } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export const GNOME_EXTENSION_UUID = 'clui-cc@monayzera.github.io'

export function isGnomeSession(): boolean {
  if (process.platform !== 'linux') return false
  const desktops = process.env.ORIGINAL_XDG_CURRENT_DESKTOP ?? process.env.XDG_CURRENT_DESKTOP ?? ''
  return desktops.split(':').some((desktop) => desktop.toUpperCase() === 'GNOME')
}

function bundledDir(): string {
  return join(__dirname, '../../resources/gnome-extension')
}

function installDir(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  return join(dataHome, 'gnome-shell', 'extensions', GNOME_EXTENSION_UUID)
}

export function bundledExtensionVersion(): string | null {
  try {
    const metadata: unknown = JSON.parse(readFileSync(join(bundledDir(), 'metadata.json'), 'utf-8'))
    const version: unknown = typeof metadata === 'object' && metadata !== null ? Reflect.get(metadata, 'version-name') : null
    return typeof version === 'string' ? version : null
  } catch {
    return null
  }
}

function treeDiffers(from: string, to: string): boolean {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) {
      if (treeDiffers(source, target)) return true
    } else if (entry.isFile()) {
      if (!existsSync(target) || !readFileSync(source).equals(readFileSync(target))) return true
    }
  }
  return false
}

function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) copyTree(source, target)
    else if (entry.isFile()) copyFileSync(source, target)
  }
}

function parseStringArray(value: string): string[] | null {
  const trimmed = value.trim().replace(/^@as\s+/, '')
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null
  return Array.from(trimmed.matchAll(/'((?:[^'\\]|\\.)*)'/g), (match) => match[1].replace(/\\(.)/g, '$1'))
}

function formatStringArray(items: string[]): string {
  return `[${items.map((item) => `'${item.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`).join(', ')}]`
}

async function readStringList(key: string): Promise<string[]> {
  const { stdout } = await execFileAsync('gsettings', ['get', 'org.gnome.shell', key], { timeout: 5000 })
  const items = parseStringArray(stdout)
  if (!items) throw new Error(`unexpected ${key} value`)
  return items
}

async function enableIfUndecided(): Promise<boolean> {
  const enabled = await readStringList('enabled-extensions')
  const disabled = await readStringList('disabled-extensions')
  if (enabled.includes(GNOME_EXTENSION_UUID) || disabled.includes(GNOME_EXTENSION_UUID)) return false
  await execFileAsync('gsettings', ['set', 'org.gnome.shell', 'enabled-extensions', formatStringArray([...enabled, GNOME_EXTENSION_UUID])], { timeout: 5000 })
  return true
}

export async function ensureGnomeExtension(log: (message: string) => void): Promise<boolean> {
  if (!isGnomeSession()) return false
  const source = bundledDir()
  const target = installDir()
  let changed = false
  try {
    if (!existsSync(join(source, 'metadata.json'))) {
      log('bundled extension not found')
      return false
    }
    const fresh = !existsSync(target)
    if (fresh || treeDiffers(source, target)) {
      copyTree(source, target)
      changed = true
      log(`${fresh ? 'installed' : 'updated'} ${GNOME_EXTENSION_UUID}`)
    }
  } catch (err) {
    log(`install failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
  try {
    if (await enableIfUndecided()) {
      changed = true
      log(`enabled ${GNOME_EXTENSION_UUID}`)
    }
  } catch (err) {
    log(`enable failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  return changed
}
