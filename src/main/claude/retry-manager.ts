/**
 * Retry Manager
 *
 * Automatic retry with exponential backoff and jitter for CLI process
 * failures caused by rate limits, connection errors, and server errors.
 * Mirrors OpenClaude's retry semantics (8602-8620 of cli.mjs).
 *
 * Retries are triggered on:
 * - 429 (Too Many Requests / rate limit)
 * - 408 (Request Timeout)
 * - 409 (Conflict)
 * - 500+ (Server errors)
 * - Spawn failures (ENOTFOUND, ECONNREFUSED, ECONNRESET)
 * - Process exit with non-zero code + stderr containing rate limit / timeout keywords
 */

import { log as _log } from '../logger'
import type { RunOptions } from '../../shared/types'

const MAX_RETRIES = 3
const INITIAL_RETRY_DELAY_S = 0.5
const MAX_RETRY_DELAY_S = 8

const RATE_LIMIT_PATTERNS = [
  '\\b429\\b', 'rate.?limit', 'rate_limit', 'ratelimit', 'too many request',
  'throttl', 'ResourceExhausted', 'RESOURCE_EXHAUSTED', 'overloaded',
  'usage_limit', 'usage limit', 'quota', 'quota exceeded',
]

const SERVER_ERROR_PATTERNS = [
  '\\b500\\b', '\\b502\\b', '\\b503\\b', '\\b504\\b', 'internal server error', 'bad gateway',
  'service unavailable', 'gateway timeout', '500 status', '502 status',
  '503 status', '504 status',
]

const TRANSIENT_ERROR_PATTERNS = [
  'timeout', 'timed out', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED',
  'ENOTFOUND', 'EAI_AGAIN', 'socket hang up', 'connection reset',
  'connection refused', 'network error', 'unexpected end of',
]

function log(msg: string): void {
  _log('RetryManager', msg)
}

export interface RetryState {
  attempt: number
  maxAttempts: number
  delayMs: number
  triggerReason: string
  nextAttemptAt: number
  tabId: string
  requestId: string
  options: RunOptions
  originalStderr: string[]
}

export interface RetryResult {
  retryable: boolean
  reason?: string
  delayMs?: number
}

export function isRetryableError(stderrs: string[]): { retryable: boolean; reason: string } {
  const combined = stderrs.join(' ').toLowerCase()

  for (const pattern of RATE_LIMIT_PATTERNS) {
    if (new RegExp(pattern, 'i').test(combined)) {
      return { retryable: true, reason: 'Rate limited (429)' }
    }
  }

  for (const pattern of SERVER_ERROR_PATTERNS) {
    if (new RegExp(pattern, 'i').test(combined)) {
      return { retryable: true, reason: 'Server error (5xx)' }
    }
  }

  for (const pattern of TRANSIENT_ERROR_PATTERNS) {
    if (new RegExp(pattern, 'i').test(combined)) {
      return { retryable: true, reason: 'Transient connection error' }
    }
  }

  return { retryable: false, reason: 'Not a retryable error' }
}

export function calculateBackoff(attempt: number): number {
  const sleepSeconds = Math.min(
    INITIAL_RETRY_DELAY_S * Math.pow(2, attempt),
    MAX_RETRY_DELAY_S
  )
  const jitter = 1 - Math.random() * 0.25
  return Math.round(sleepSeconds * jitter * 1000)
}

export class RetryManager {
  private activeRetries = new Map<string, { timeout: ReturnType<typeof setTimeout>; state: RetryState }>()

  get activeCount(): number {
    return this.activeRetries.size
  }

  scheduleRetry(
    tabId: string,
    newRequestId: string,
    options: RunOptions,
    stderrTail: string[],
    reason: string,
    onRetry: (tabId: string, newRequestId: string, options: RunOptions) => Promise<void>,
    onFail: (tabId: string, requestId: string, reason: string) => void,
  ): RetryState {
    const attempt = 0
    const delayMs = calculateBackoff(attempt)
    const state: RetryState = {
      attempt,
      maxAttempts: MAX_RETRIES,
      delayMs,
      triggerReason: reason,
      nextAttemptAt: Date.now() + delayMs,
      tabId,
      requestId: newRequestId,
      options,
      originalStderr: stderrTail.slice(),
    }

    log(`Scheduling retry 1/${MAX_RETRIES} for tab ${tabId.substring(0, 8)}… in ${delayMs}ms (${reason})`)

    const timeout = setTimeout(async () => {
      this.activeRetries.delete(newRequestId)
      log(`Executing retry for ${newRequestId.substring(0, 8)}… (tab ${tabId.substring(0, 8)}…)`)
      try {
        await onRetry(tabId, newRequestId, options)
      } catch (err) {
        log(`Retry failed during dispatch: ${(err as Error).message}`)
        onFail(tabId, newRequestId, reason)
      }
    }, delayMs)

    this.activeRetries.set(newRequestId, { timeout, state })
    return state
  }

  cancelRetry(requestId: string): void {
    const pending = this.activeRetries.get(requestId)
    if (pending) {
      clearTimeout(pending.timeout)
      this.activeRetries.delete(requestId)
      log(`Cancelled retry for ${requestId.substring(0, 8)}…`)
    }
  }

  getState(requestId: string): RetryState | null {
    return this.activeRetries.get(requestId)?.state ?? null
  }
}
