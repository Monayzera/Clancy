export const DEFAULT_LINUX_SHORTCUT = '<Super>c'

const MODIFIER_ORDER = ['Control', 'Shift', 'Alt', 'Super'] as const

const MODIFIER_LABELS: Record<string, string> = {
  Control: 'Ctrl',
  Shift: 'Shift',
  Alt: 'Alt',
  Super: 'Super',
}

const NAMED_CODES: Record<string, string> = {
  Space: 'space',
  Enter: 'Return',
  NumpadEnter: 'KP_Enter',
  Tab: 'Tab',
  Backspace: 'BackSpace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page_Up',
  PageDown: 'Page_Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Minus: 'minus',
  Equal: 'equal',
  BracketLeft: 'bracketleft',
  BracketRight: 'bracketright',
  Backslash: 'backslash',
  Semicolon: 'semicolon',
  Quote: 'apostrophe',
  Comma: 'comma',
  Period: 'period',
  Slash: 'slash',
  Backquote: 'grave',
}

const KEY_LABELS: Record<string, string> = {
  space: 'Space',
  Return: 'Enter',
  KP_Enter: 'Enter',
  BackSpace: 'Backspace',
  Page_Up: 'Page Up',
  Page_Down: 'Page Down',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
  minus: '-',
  equal: '=',
  bracketleft: '[',
  bracketright: ']',
  backslash: '\\',
  semicolon: ';',
  apostrophe: "'",
  comma: ',',
  period: '.',
  slash: '/',
  grave: '`',
}

const KEY_NAMES = new Set(Object.values(NAMED_CODES))

function isKeyName(key: string): boolean {
  return /^[a-z0-9]$/.test(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key) || KEY_NAMES.has(key)
}

export function parseAccelerator(value: unknown): { modifiers: string[]; key: string } | null {
  if (typeof value !== 'string' || value.length > 96) return null
  const match = /^((?:<(?:Control|Shift|Alt|Super)>)+)([A-Za-z0-9_]+)$/.exec(value)
  if (!match) return null
  const modifiers = Array.from(match[1].matchAll(/<(\w+)>/g), (m) => m[1])
  if (new Set(modifiers).size !== modifiers.length) return null
  if (!modifiers.some((modifier) => modifier !== 'Shift')) return null
  if (!isKeyName(match[2])) return null
  return { modifiers, key: match[2] }
}

export function isValidAccelerator(value: unknown): value is string {
  return parseAccelerator(value) !== null
}

export function acceleratorLabels(value: string): string[] {
  const parsed = parseAccelerator(value)
  if (!parsed) return []
  const key = KEY_LABELS[parsed.key] ?? (parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key)
  return [...MODIFIER_ORDER.filter((m) => parsed.modifiers.includes(m)).map((m) => MODIFIER_LABELS[m]), key]
}

export function acceleratorFromKeyEvent(event: { code: string; key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }): string | null {
  let key: string | null = null
  const letter = /^Key([A-Z])$/.exec(event.code)
  const digit = /^Digit([0-9])$/.exec(event.code)
  if (/^[a-zA-Z]$/.test(event.key)) key = event.key.toLowerCase()
  else if (letter) key = letter[1].toLowerCase()
  else if (digit) key = digit[1]
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) key = event.code
  else key = NAMED_CODES[event.code] ?? null
  if (!key) return null
  const flags: Record<string, boolean> = { Control: event.ctrlKey, Shift: event.shiftKey, Alt: event.altKey, Super: event.metaKey }
  const modifiers = MODIFIER_ORDER.filter((m) => flags[m])
  const accelerator = `${modifiers.map((m) => `<${m}>`).join('')}${key}`
  return isValidAccelerator(accelerator) ? accelerator : null
}
