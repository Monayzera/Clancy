import { useEffect, useState } from 'react'
import type { CodexQuota } from '../../shared/types'

const RESET_LABEL_TICK_MS = 1000
const QUOTA_REFRESH_TICK_MS = 3000

export function useCodexQuota(enabled: boolean): { quota: CodexQuota | null; nowMs: number } {
  const [quota, setQuota] = useState<CodexQuota | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) {
      setQuota(null)
      return
    }

    let alive = true
    const refresh = () => window.clui.codexQuota().then((next) => {
      if (alive) setQuota(next)
    }).catch(() => {})
    refresh()

    const unsubscribe = window.clui.onCodexQuotaUpdate((next) => {
      if (alive) setQuota(next)
    })
    const refreshTimer = setInterval(refresh, QUOTA_REFRESH_TICK_MS)

    return () => {
      alive = false
      clearInterval(refreshTimer)
      unsubscribe()
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    setNowMs(Date.now())
    const timer = setInterval(() => {
      setNowMs(Date.now())
    }, RESET_LABEL_TICK_MS)
    return () => clearInterval(timer)
  }, [enabled])

  return { quota, nowMs }
}
