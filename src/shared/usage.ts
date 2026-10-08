import type { UsageData } from './types'

type TokenCounterKey = 'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens' | 'reasoning_output_tokens' | 'total_tokens'

const TOKEN_KEYS: TokenCounterKey[] = [
  'input_tokens',
  'output_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
  'reasoning_output_tokens',
  'total_tokens',
]

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function valueAt(value: unknown, path: string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    const obj = asObject(current)
    if (!obj) return undefined
    current = obj[key]
  }
  return current
}

function tokenNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value))
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed))
  }
  return undefined
}

function firstTokenNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = tokenNumber(value)
    if (parsed !== undefined) return parsed
  }
  return undefined
}

function sumTokenNumbers(...values: unknown[]): number | undefined {
  let sum = 0
  let found = false
  for (const value of values) {
    const parsed = tokenNumber(value)
    if (parsed !== undefined) {
      sum += parsed
      found = true
    }
  }
  return found ? sum : undefined
}

function setToken(usage: UsageData, key: TokenCounterKey, value: number | undefined): void {
  if (value !== undefined) usage[key] = value
}

export function normalizeUsageData(raw: unknown): UsageData {
  const data = asObject(raw)
  if (!data) return {}

  const usage: UsageData = {}
  setToken(usage, 'input_tokens', firstTokenNumber(data.input_tokens, data.prompt_tokens))
  setToken(usage, 'output_tokens', firstTokenNumber(data.output_tokens, data.completion_tokens))
  setToken(usage, 'cache_read_input_tokens', firstTokenNumber(
    data.cache_read_input_tokens,
    data.cached_input_tokens,
    valueAt(data, ['input_tokens_details', 'cached_tokens']),
    valueAt(data, ['prompt_tokens_details', 'cached_tokens'])
  ))
  setToken(usage, 'cache_creation_input_tokens', firstTokenNumber(
    data.cache_creation_input_tokens,
    data.cache_write_input_tokens,
    sumTokenNumbers(
      valueAt(data, ['cache_creation', 'ephemeral_1h_input_tokens']),
      valueAt(data, ['cache_creation', 'ephemeral_5m_input_tokens'])
    )
  ))
  setToken(usage, 'reasoning_output_tokens', firstTokenNumber(
    data.reasoning_output_tokens,
    valueAt(data, ['output_tokens_details', 'reasoning_tokens']),
    valueAt(data, ['completion_tokens_details', 'reasoning_tokens'])
  ))
  setToken(usage, 'total_tokens', firstTokenNumber(data.total_tokens))

  if (typeof data.service_tier === 'string') {
    usage.service_tier = data.service_tier
  }

  return usage
}

export function hasUsageData(usage: UsageData | undefined): boolean {
  if (!usage) return false
  return TOKEN_KEYS.some((key) => (usage[key] || 0) > 0)
}

export function usageToTokenUsage(usage: UsageData | undefined): { input: number; output: number; cacheRead: number; cacheCreation: number; reasoning: number; total: number } {
  const normalized = normalizeUsageData(usage)
  return {
    input: normalized.input_tokens || 0,
    output: normalized.output_tokens || 0,
    cacheRead: normalized.cache_read_input_tokens || 0,
    cacheCreation: normalized.cache_creation_input_tokens || 0,
    reasoning: normalized.reasoning_output_tokens || 0,
    total: normalized.total_tokens || 0,
  }
}
