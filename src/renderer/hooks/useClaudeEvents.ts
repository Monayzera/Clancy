import { useEffect, useRef } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import type { NormalizedEvent } from '../../shared/types'

type TextChunkEvent = Extract<NormalizedEvent, { type: 'text_chunk' }>
type ThinkingChunkEvent = Extract<NormalizedEvent, { type: 'thinking_chunk' }>
type BufferedEvent<T> = { tabId: string; event: T }

/**
 * Subscribes to all ControlPlane events via IPC and routes them
 * to the Zustand store.
 *
 * text_chunk events are batched per animation frame to avoid
 * flooding React with one state update per chunk during streaming.
 */
export function useClaudeEvents() {
  const handleNormalizedEvent = useSessionStore((s) => s.handleNormalizedEvent)
  const handleStatusChange = useSessionStore((s) => s.handleStatusChange)
  const handleError = useSessionStore((s) => s.handleError)
  const handleRetryStatus = useSessionStore((s) => s.handleRetryStatus)

  const chunkBufferRef = useRef<Map<string, BufferedEvent<TextChunkEvent>>>(new Map())
  const thinkingBufferRef = useRef<Map<string, BufferedEvent<ThinkingChunkEvent>>>(new Map())
  const rafIdRef = useRef<number>(0)

  useEffect(() => {
    const flushChunks = () => {
      rafIdRef.current = 0
      const buffer = chunkBufferRef.current
      if (buffer.size > 0) {
        for (const { tabId, event } of buffer.values()) {
          handleNormalizedEvent(tabId, event)
        }
        buffer.clear()
      }
      const thinkingBuffer = thinkingBufferRef.current
      if (thinkingBuffer.size > 0) {
        for (const { tabId, event } of thinkingBuffer.values()) {
          handleNormalizedEvent(tabId, event)
        }
        thinkingBuffer.clear()
      }
    }

    const requestFlush = () => {
      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(flushChunks)
      }
    }

    const unsubEvent = window.clui.onEvent((tabId, event) => {
      if (event.type === 'text_chunk') {
        if (event.appendMode === 'block') {
          if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current)
            flushChunks()
          }
          handleNormalizedEvent(tabId, event)
          return
        }
        const buffer = chunkBufferRef.current
        const key = `${tabId}\u0000${event.streamId || ''}\u0000${event.appendMode || 'stream'}`
        const existing = buffer.get(key)
        buffer.set(key, {
          tabId,
          event: existing
            ? { ...event, text: existing.event.text + event.text }
            : event,
        })

        requestFlush()
      } else if (event.type === 'thinking_chunk') {
        const buffer = thinkingBufferRef.current
        const key = `${tabId}\u0000${event.streamId || ''}\u0000${event.insertBeforeAssistant ? 'before' : 'after'}`
        const existing = buffer.get(key)
        buffer.set(key, {
          tabId,
          event: existing
            ? { ...event, thinking: existing.event.thinking + event.thinking }
            : event,
        })

        requestFlush()
      } else {
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current)
          flushChunks()
        }
        handleNormalizedEvent(tabId, event)
      }
    })

    const unsubStatus = window.clui.onTabStatusChange((tabId, newStatus, oldStatus) => {
      handleStatusChange(tabId, newStatus, oldStatus)
    })

    const unsubError = window.clui.onError((tabId, error) => {
      handleError(tabId, error)
    })

    const unsubSkill = window.clui.onSkillStatus((status) => {
      if (status.state === 'failed') {
        console.warn(`[CLUI] Skill install failed: ${status.name} — ${status.error}`)
      }
    })

    const unsubRetry = window.clui.onRetryStatus((tabId, status) => {
      handleRetryStatus(tabId, status.active ? status : null)
    })

    return () => {
      unsubEvent()
      unsubStatus()
      unsubError()
      unsubSkill()
      unsubRetry()
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      chunkBufferRef.current.clear()
      thinkingBufferRef.current.clear()
    }
  }, [handleNormalizedEvent, handleStatusChange, handleError, handleRetryStatus])

  // Note: window.clui.start() is called via sessionStore.initStaticInfo() in App.tsx.
  // No duplicate call needed here.
}
