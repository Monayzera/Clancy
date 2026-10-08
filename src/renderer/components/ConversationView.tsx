import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  FileText, PencilSimple, FileArrowUp, Terminal, MagnifyingGlass, Globe,
  Robot, Question, Wrench, FolderOpen, Copy, Check, CaretRight, CaretDown,
  SpinnerGap, ArrowCounterClockwise, Square, Brain, ListChecks, ClipboardText,
  Sparkle, Plugs,
} from '@phosphor-icons/react'
import { useSessionStore, useActiveTab } from '../stores/sessionStore'
import { usePopoverLayer } from './PopoverLayer'
import { PermissionCard } from './PermissionCard'
import { PermissionDeniedCard } from './PermissionDeniedCard'
import { AskUserQuestionCard } from './AskUserQuestionCard'
import { DiffViewer } from './DiffViewer'
import { useColors, useThemeStore } from '../theme'
import type { Message, Attachment } from '../../shared/types'


const INITIAL_RENDER_CAP = 100
const PAGE_SIZE = 100
const REMARK_PLUGINS = [remarkGfm]


type GroupedItem =
  | { kind: 'user'; message: Message }
  | { kind: 'assistant'; message: Message }
  | { kind: 'system'; message: Message }
  | { kind: 'tool-group'; messages: Message[] }
  | { kind: 'thinking'; message: Message }


function groupMessages(messages: Message[]): GroupedItem[] {
  const result: GroupedItem[] = []
  let toolBuf: Message[] = []

  const flushTools = () => {
    if (toolBuf.length > 0) {
      result.push({ kind: 'tool-group', messages: [...toolBuf] })
      toolBuf = []
    }
  }

  for (const msg of messages) {
    if (msg.role === 'tool') {
      toolBuf.push(msg)
    } else {
      flushTools()
      if (msg.role === 'user') result.push({ kind: 'user', message: msg })
      else if (msg.role === 'assistant') result.push({ kind: 'assistant', message: msg })
      else if (msg.role === 'thinking') result.push({ kind: 'thinking', message: msg })
      else result.push({ kind: 'system', message: msg })
    }
  }
  flushTools()
  return result
}


export function ConversationView() {
  const tab = useActiveTab()
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const sendMessage = useSessionStore((s) => s.sendMessage)
  const addAttachments = useSessionStore((s) => s.addAttachments)
  const clearAttachments = useSessionStore((s) => s.clearAttachments)
  const staticInfo = useSessionStore((s) => s.staticInfo)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [renderOffset, setRenderOffset] = useState(0)
  const isNearBottomRef = useRef(true)
  const prevTabIdRef = useRef(activeTabId)
  const colors = useColors()
  const expandedUI = useThemeStore((s) => s.expandedUI)

  useEffect(() => {
    if (activeTabId !== prevTabIdRef.current) {
      prevTabIdRef.current = activeTabId
      setRenderOffset(0)
      isNearBottomRef.current = true
    }
  }, [activeTabId])

  // Track whether user is scrolled near the bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }, [])

  // Auto-scroll when content changes and user is near bottom.
  const msgCount = tab?.messages.length ?? 0
  const lastMsg = tab?.messages[tab.messages.length - 1]
  const permissionQueueLen = tab?.permissionQueue?.length ?? 0
  const queuedCount = tab?.queuedPrompts?.length ?? 0
  const scrollTrigger = `${msgCount}:${lastMsg?.content?.length ?? 0}:${lastMsg?.toolInput?.length ?? 0}:${lastMsg?.toolResult?.length ?? 0}:${lastMsg?.toolStatus ?? ''}:${permissionQueueLen}:${queuedCount}`

  useEffect(() => {
    if (isNearBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [scrollTrigger])

  // Group only the visible slice of messages
  const allMessages = tab?.messages ?? []
  const totalCount = allMessages.length
  const startIndex = Math.max(0, totalCount - INITIAL_RENDER_CAP - renderOffset * PAGE_SIZE)
  const visibleMessages = startIndex > 0 ? allMessages.slice(startIndex) : allMessages
  const hasOlder = startIndex > 0

  const grouped = useMemo(
    () => groupMessages(visibleMessages),
    [visibleMessages],
  )

  const hiddenCount = totalCount - visibleMessages.length

  const handleLoadOlder = useCallback(() => {
    setRenderOffset((o) => o + 1)
  }, [])

  if (!tab) return null

  const isRunning = tab.status === 'running' || tab.status === 'connecting'
  const isDead = tab.status === 'dead'
  const isFailed = tab.status === 'failed'
  const showInterrupt = isRunning && tab.messages.some((m) => m.role === 'user')

  if (tab.messages.length === 0) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={`empty-${activeTabId}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.1, 1] }}
        >
          <EmptyState />
        </motion.div>
      </AnimatePresence>
    )
  }

  // Messages from before initial render cap are "historical" — no motion
  const historicalThreshold = Math.max(0, totalCount - 20)

  const handleRetry = () => {
    const lastUserMsg = [...tab.messages].reverse().find((m) => m.role === 'user')
    if (lastUserMsg) {
      clearAttachments()
      if (lastUserMsg.attachments && lastUserMsg.attachments.length > 0) {
        addAttachments(lastUserMsg.attachments)
      }
      sendMessage(lastUserMsg.content)
    }
  }

  return (
    <div
      data-clui-ui
    >
      <AnimatePresence mode="wait">
      <motion.div
        key={activeTabId}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
      >
      <div
        ref={scrollRef}
        className="overflow-y-auto overflow-x-hidden px-4 pt-2 conversation-selectable"
        style={{ maxHeight: expandedUI ? 460 : 336, paddingBottom: 54 }}
        onScroll={handleScroll}
      >
        {hasOlder && (
          <div className="flex justify-center py-2">
            <button
              onClick={handleLoadOlder}
              className="text-[11px] px-3 py-1 rounded-full transition-colors"
              style={{ color: colors.textTertiary, border: `1px solid ${colors.toolBorder}` }}
            >
              Load {Math.min(PAGE_SIZE, hiddenCount)} older messages ({hiddenCount} hidden)
            </button>
          </div>
        )}

        <div className="space-y-2 relative">
          {grouped.map((item, idx) => {
            const msgIndex = startIndex + idx
            const isHistorical = msgIndex < historicalThreshold

            switch (item.kind) {
              case 'user':
                return <UserMessage key={item.message.id} message={item.message} skipMotion={isHistorical} />
              case 'assistant':
                return <AssistantMessage key={item.message.id} message={item.message} skipMotion={isHistorical} />
              case 'tool-group':
                return <ToolGroup key={`tg-${item.messages[0].id}`} tools={item.messages} skipMotion={isHistorical} />
              case 'system':
                return <SystemMessage key={item.message.id} message={item.message} skipMotion={isHistorical} />
              case 'thinking':
                return <ThinkingMessage key={item.message.id} message={item.message} skipMotion={isHistorical} />
              default:
                return null
            }
          })}
        </div>

        <AnimatePresence>
          {tab.permissionQueue.length > 0 && (
            <PermissionCard
              tabId={tab.id}
              permission={tab.permissionQueue[0]}
              queueLength={tab.permissionQueue.length}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {tab.askUserQuestions.length > 0 && (
            <AskUserQuestionCard
              key={tab.askUserQuestions[0].questionId}
              tabId={tab.id}
              question={tab.askUserQuestions[0]}
              queueLength={tab.askUserQuestions.length}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {tab.permissionDenied && (
            <PermissionDeniedCard
              tools={tab.permissionDenied.tools}
              sessionId={tab.claudeSessionId}
              projectPath={staticInfo?.projectPath || process.cwd()}
              onDismiss={() => {
                useSessionStore.setState((s) => ({
                  tabs: s.tabs.map((t) =>
                    t.id === tab.id ? { ...t, permissionDenied: null } : t
                  ),
                }))
              }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {tab.queuedPrompts.map((prompt, i) => (
            <QueuedMessage key={`queued-${i}`} content={prompt} />
          ))}
        </AnimatePresence>

        <div ref={bottomRef} />
      </div>
      </motion.div>
      </AnimatePresence>

      <div
        className="flex items-center justify-between px-4 relative"
        style={{
          height: 28,
          minHeight: 28,
          marginTop: -28,
          background: `linear-gradient(to bottom, transparent, ${colors.containerBg} 60%)`,
          zIndex: 2,
          pointerEvents: 'none',
        }}
      >
        <div className="flex items-center gap-1.5 text-[11px] min-w-0">
          {isRunning && (
            <span className="flex items-center gap-1.5">
              <span className="flex gap-[3px]">
                <span className="w-[4px] h-[4px] rounded-full animate-bounce-dot" style={{ background: colors.statusRunning, animationDelay: '0ms' }} />
                <span className="w-[4px] h-[4px] rounded-full animate-bounce-dot" style={{ background: colors.statusRunning, animationDelay: '150ms' }} />
                <span className="w-[4px] h-[4px] rounded-full animate-bounce-dot" style={{ background: colors.statusRunning, animationDelay: '300ms' }} />
              </span>
              <span style={{ color: colors.textSecondary }}>{tab.currentActivity || 'Working…'}</span>
            </span>
          )}

          {isDead && (
            <span style={{ color: colors.statusError, fontSize: 11 }}>Session ended unexpectedly</span>
          )}

          {isFailed && (
            <span className="flex items-center gap-1.5">
              <span style={{ color: colors.statusError, fontSize: 11 }}>Failed</span>
              <button
                onClick={handleRetry}
                className="flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors"
                style={{ color: colors.accent, fontSize: 11, pointerEvents: 'auto' }}
              >
                <ArrowCounterClockwise size={10} />
                Retry
              </button>
            </span>
          )}
        </div>

        <div className="flex items-center flex-shrink-0" style={{ pointerEvents: 'auto' }}>
          <AnimatePresence>
            {showInterrupt && (
              <InterruptButton tabId={tab.id} />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}


function EmptyState() {
  const setBaseDirectory = useSessionStore((s) => s.setBaseDirectory)
  const colors = useColors()

  const handleChooseFolder = async () => {
    const dir = await window.clui.selectDirectory()
    if (dir) {
      setBaseDirectory(dir)
    }
  }

  return (
    <div
      className="flex flex-col items-center justify-center px-4 py-6 gap-2.5"
      style={{ minHeight: 140 }}
    >
      <div
        className="w-10 h-10 rounded-2xl flex items-center justify-center"
        style={{ background: colors.accentLight, border: `1px solid ${colors.accentBorder}` }}
      >
        <Sparkle size={18} weight="fill" style={{ color: colors.accent }} />
      </div>
      <div className="text-center">
        <div className="text-[13px] font-semibold" style={{ color: colors.textPrimary }}>
          Ready when you are
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: colors.textTertiary }}>
          Pick a folder to start coding with Claude
        </div>
      </div>
      <button
        onClick={handleChooseFolder}
        className="flex items-center gap-1.5 text-[12px] px-3.5 py-1.5 rounded-lg transition-colors"
        style={{
          color: colors.textOnAccent,
          background: colors.accent,
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <FolderOpen size={13} weight="bold" />
        Choose folder
      </button>
      <span className="text-[11px]" style={{ color: colors.textTertiary }}>
        Press <strong style={{ color: colors.textSecondary }}>⌥ + Space</strong> to show/hide this overlay
      </span>
    </div>
  )
}


function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const colors = useColors()

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <motion.button
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] cursor-pointer flex-shrink-0"
      style={{
        background: copied ? colors.statusCompleteBg : 'transparent',
        color: copied ? colors.statusComplete : colors.textTertiary,
        border: 'none',
      }}
      title="Copy response"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </motion.button>
  )
}


function InterruptButton({ tabId }: { tabId: string }) {
  const colors = useColors()

  const handleStop = () => {
    window.clui.stopTab(tabId)
  }

  return (
    <motion.button
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      onClick={handleStop}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] cursor-pointer flex-shrink-0 transition-colors"
      style={{
        background: 'transparent',
        color: colors.statusError,
        border: 'none',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = colors.statusErrorBg }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      title="Stop current task"
    >
      <Square size={9} weight="fill" />
      <span>Interrupt</span>
    </motion.button>
  )
}


function ImageLightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const layer = usePopoverLayer()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  if (!layer) return null

  return createPortal(
    <motion.div
      data-clui-ui
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'zoom-out',
        pointerEvents: 'auto',
      }}
    >
      <motion.img
        src={src}
        alt={name}
        initial={{ opacity: 0, scale: 0.88 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28, mass: 0.7 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '90vw',
          maxHeight: '90vh',
          objectFit: 'contain',
          borderRadius: 12,
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          cursor: 'default',
          display: 'block',
        }}
      />
    </motion.div>,
    layer
  )
}

function UserMessageAttachments({ attachments }: { attachments: Attachment[] }) {
  const colors = useColors()
  const [lightbox, setLightbox] = useState<{ src: string; name: string } | null>(null)
  const images = attachments.filter((a) => a.type === 'image' && a.dataUrl)
  const files = attachments.filter((a) => !(a.type === 'image' && a.dataUrl))

  return (
    <div className="flex flex-col items-end gap-1.5">
      {lightbox && (
        <ImageLightbox src={lightbox.src} name={lightbox.name} onClose={() => setLightbox(null)} />
      )}
      {images.length > 0 && (
        <div className={`flex gap-1.5 justify-end ${images.length > 1 ? 'flex-wrap' : ''}`}>
          {images.map((a) => (
            <img
              key={a.id}
              src={a.dataUrl}
              alt={a.name}
              title={a.name}
              onClick={() => setLightbox({ src: a.dataUrl!, name: a.name })}
              style={{
                maxWidth: images.length === 1 ? 220 : 140,
                maxHeight: images.length === 1 ? 180 : 120,
                objectFit: 'contain',
                borderRadius: 10,
                display: 'block',
                border: `1px solid ${colors.userBubbleBorder}`,
                cursor: 'zoom-in',
              }}
            />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1 justify-end">
          {files.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-1 px-2 py-1 text-[11px]"
              style={{
                background: colors.userBubble,
                border: `1px solid ${colors.userBubbleBorder}`,
                borderRadius: 10,
                color: colors.userBubbleText,
              }}
            >
              <FileText size={11} />
              <span className="truncate" style={{ maxWidth: 140 }}>{a.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function UserMessage({ message, skipMotion }: { message: Message; skipMotion?: boolean }) {
  const colors = useColors()
  const hasAttachments = (message.attachments?.length ?? 0) > 0

  const content = (
    <div className="flex flex-col items-end gap-1.5 max-w-[85%]">
      {hasAttachments && <UserMessageAttachments attachments={message.attachments!} />}
      {message.content.trim() && (
        <div
          className="text-[13px] leading-[1.5] px-3 py-1.5 w-full"
          style={{
            background: colors.userBubble,
            color: colors.userBubbleText,
            border: `1px solid ${colors.userBubbleBorder}`,
            borderRadius: '14px 14px 4px 14px',
          }}
        >
          {message.content}
        </div>
      )}
    </div>
  )

  if (skipMotion) {
    return <div className="flex justify-end py-2">{content}</div>
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26, mass: 0.6 }}
      className="flex justify-end py-2"
    >
      {content}
    </motion.div>
  )
}

function QueuedMessage({ content }: { content: string }) {
  const colors = useColors()

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.93 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26, mass: 0.6 }}
      className="flex justify-end py-2"
    >
      <div
        className="text-[13px] leading-[1.5] px-3 py-1.5 max-w-[85%]"
        style={{
          background: colors.userBubble,
          color: colors.userBubbleText,
          border: `1px dashed ${colors.userBubbleBorder}`,
          borderRadius: '14px 14px 4px 14px',
          opacity: 0.6,
        }}
      >
        {content}
      </div>
    </motion.div>
  )
}


function TableScrollWrapper({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState<string | undefined>(undefined)
  const prevFade = useRef<string | undefined>(undefined)

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    let next: string | undefined
    if (scrollWidth <= clientWidth + 1) {
      next = undefined
    } else {
      const l = scrollLeft > 1
      const r = scrollLeft + clientWidth < scrollWidth - 1
      next = l && r
        ? 'linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent)'
        : l
          ? 'linear-gradient(to right, transparent, black 24px)'
          : r
            ? 'linear-gradient(to right, black calc(100% - 24px), transparent)'
            : undefined
    }
    if (next !== prevFade.current) {
      prevFade.current = next
      setFade(next)
    }
  }, [])

  useEffect(() => {
    update()
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    const table = el.querySelector('table')
    if (table) ro.observe(table)
    return () => ro.disconnect()
  }, [update])

  return (
    <div
      ref={ref}
      onScroll={update}
      style={{
        overflowX: 'auto',
        scrollbarWidth: 'thin',
        maskImage: fade,
        WebkitMaskImage: fade,
      }}
    >
      <table>{children}</table>
    </div>
  )
}


function ImageCard({ src, alt, colors }: { src?: string; alt?: string; colors: ReturnType<typeof useColors> }) {
  const [failed, setFailed] = useState(false)
  // Reset failed state when src changes (e.g. during streaming)
  useEffect(() => { setFailed(false) }, [src])
  const label = alt || 'Image'
  const open = () => { if (src) window.clui.openExternal(String(src)) }

  if (failed || !src) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1.5 my-1 px-2.5 py-1.5 rounded-md text-[12px] cursor-pointer"
        style={{ background: colors.surfacePrimary, color: colors.accent, border: `1px solid ${colors.toolBorder}` }}
        onClick={open}
        title={src}
      >
        <Globe size={12} />
        Image unavailable{alt ? ` — ${alt}` : ''}
      </button>
    )
  }

  return (
    <button
      type="button"
      className="block my-2 rounded-lg overflow-hidden border text-left cursor-pointer"
      style={{ borderColor: colors.toolBorder, background: colors.surfacePrimary }}
      onClick={open}
      title={src}
    >
      <img
        src={src}
        alt={label}
        className="block w-full max-h-[260px] object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
      />
      {alt && (
        <div className="px-2 py-1 text-[11px]" style={{ color: colors.textTertiary }}>
          {alt}
        </div>
      )}
    </button>
  )
}


const AssistantMessage = React.memo(function AssistantMessage({
  message,
  skipMotion,
}: {
  message: Message
  skipMotion?: boolean
}) {
  const colors = useColors()

  const markdownComponents = useMemo(() => ({
    table: ({ children }: any) => <TableScrollWrapper>{children}</TableScrollWrapper>,
    a: ({ href, children }: any) => (
      <button
        type="button"
        className="underline decoration-dotted underline-offset-2 cursor-pointer"
        style={{ color: colors.accent }}
        onClick={() => {
          if (href) window.clui.openExternal(String(href))
        }}
      >
        {children}
      </button>
    ),
    img: ({ src, alt }: any) => <ImageCard src={src} alt={alt} colors={colors} />,
  }), [colors])

  const inner = (
    <div className="group/msg relative">
      <div className="text-[13px] leading-[1.6] prose-cloud min-w-0 max-w-[92%]">
        <Markdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>
          {message.content}
        </Markdown>
      </div>
      {message.content.trim() && (
        <div className="absolute bottom-0 right-0 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-100">
          <CopyButton text={message.content} />
        </div>
      )}
    </div>
  )

  if (skipMotion) {
    return <div className="py-2">{inner}</div>
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26, mass: 0.6 }}
      className="py-2"
    >
      {inner}
    </motion.div>
  )
}, (prev, next) => prev.message.content === next.message.content && prev.skipMotion === next.skipMotion)


function toolSummary(tools: Message[]): string {
  if (tools.length === 0) return ''
  // Use first tool's context for summary
  const first = tools[0]
  const desc = getToolDescription(first.toolName || 'Tool', first.toolInput)
  if (tools.length === 1) return desc
  return `${desc} and ${tools.length - 1} more tool${tools.length > 2 ? 's' : ''}`
}

/** Short human-readable description from tool name + input */
function getToolDescription(name: string, input?: string): string {
  if (name.startsWith('mcp__')) {
    const parts = name.split('__')
    return `${parts[1] || 'mcp'} · ${parts.slice(2).join('__') || 'tool'}`
  }
  if (!input) return name

  // Try to extract a meaningful short description from the input JSON
  try {
    const parsed = JSON.parse(input)
    switch (name) {
      case 'Read': return `Read ${parsed.file_path || parsed.path || 'file'}`
      case 'Edit': return `Edit ${parsed.file_path || 'file'}`
      case 'MultiEdit': return `Edit ${parsed.file_path || 'file'}`
      case 'NotebookEdit': return `Edit ${parsed.notebook_path || parsed.file_path || 'notebook'}`
      case 'Write': return `Write ${parsed.file_path || 'file'}`
      case 'Glob': return `Search files: ${parsed.pattern || ''}`
      case 'Grep': return `Search: ${parsed.pattern || ''}`
      case 'Bash': {
        const cmd = parsed.command || ''
        return cmd.length > 60 ? `${cmd.substring(0, 57)}…` : cmd || 'Bash'
      }
      case 'WebSearch': return `Search: ${parsed.query || parsed.search_query || ''}`
      case 'WebFetch': return `Fetch: ${parsed.url || ''}`
      case 'Agent':
      case 'Task': return `Task: ${String(parsed.description || parsed.subagent_type || parsed.prompt || '').substring(0, 50)}`
      case 'LS': return `List ${parsed.path || parsed.dir || 'directory'}`
      case 'TodoWrite': return `Update todos${Array.isArray(parsed.todos) ? ` (${parsed.todos.length})` : ''}`
      case 'ExitPlanMode': return 'Plan ready for review'
      case 'Skill': return `Skill: ${parsed.command || parsed.name || ''}`
      case 'BashOutput': return 'Read shell output'
      case 'KillShell': return 'Kill shell'
      default: return name
    }
  } catch {
    // Input is not JSON or is partial — show truncated raw
    const trimmed = input.trim()
    if (trimmed.length > 60) return `${name}: ${trimmed.substring(0, 57)}…`
    return trimmed ? `${name}: ${trimmed}` : name
  }
}

function ToolResultView({ result, isError }: { result: string; isError: boolean }) {
  const colors = useColors()
  const [showAll, setShowAll] = useState(false)
  const trimmed = result.replace(/\s+$/, '')
  if (!trimmed) {
    if (!isError) return null
    return (
      <span className="inline-block text-[10px] mt-1 px-1.5 py-[1px] rounded" style={{ background: colors.statusErrorBg, color: colors.statusError }}>
        failed
      </span>
    )
  }
  const lines = trimmed.split('\n')
  const LIMIT = 16
  const truncated = !showAll && lines.length > LIMIT
  const shown = truncated ? lines.slice(0, LIMIT).join('\n') : trimmed

  return (
    <div className="mt-1.5 rounded-md overflow-hidden" style={{ border: `1px solid ${isError ? colors.statusError : colors.toolBorder}` }}>
      <pre
        className="font-mono text-[11px] leading-[1.55] px-2 py-1.5 overflow-x-auto"
        style={{ background: colors.codeBg, color: isError ? colors.statusError : colors.textSecondary, whiteSpace: 'pre', maxHeight: showAll ? undefined : 320, margin: 0 }}
      >
        {shown}
      </pre>
      {truncated && (
        <div
          className="px-2 py-1 text-[10px] cursor-pointer text-center"
          style={{ color: colors.textTertiary, background: colors.surfaceHover, borderTop: `1px solid ${colors.toolBorder}` }}
          onClick={() => setShowAll(true)}
        >
          Show {lines.length - LIMIT} more line{lines.length - LIMIT > 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}

function TodoChecklist({ input }: { input: string }) {
  const colors = useColors()
  const todos = useMemo(() => {
    try {
      const p = JSON.parse(input)
      return Array.isArray(p.todos) ? p.todos : []
    } catch { return [] }
  }, [input])
  if (todos.length === 0) return null
  return (
    <div className="mt-1.5 rounded-md px-2 py-1.5 space-y-1" style={{ border: `1px solid ${colors.toolBorder}`, background: colors.surfaceHover }}>
      {todos.map((t: any, i: number) => {
        const status = t.status || 'pending'
        const text = status === 'in_progress' && t.activeForm ? t.activeForm : (t.content || t.activeForm || '')
        const color = status === 'completed' ? colors.statusComplete : status === 'in_progress' ? colors.statusRunning : colors.textTertiary
        return (
          <div key={i} className="flex items-start gap-1.5 text-[11px] leading-[1.45]">
            <span className="flex-shrink-0 mt-[1px]" style={{ color }}>
              {status === 'completed'
                ? <Check size={11} weight="bold" />
                : status === 'in_progress'
                  ? <SpinnerGap size={11} className="animate-spin" />
                  : <CaretRight size={9} />}
            </span>
            <span style={{ color: status === 'completed' ? colors.textTertiary : colors.textSecondary, textDecoration: status === 'completed' ? 'line-through' : 'none' }}>
              {text}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function PlanCard({ plan }: { plan: string }) {
  const colors = useColors()
  return (
    <div className="mt-1.5 rounded-md px-2.5 py-1.5 prose-cloud" style={{ border: `1px solid ${colors.accentBorder}`, background: colors.accentLight }}>
      <Markdown remarkPlugins={REMARK_PLUGINS}>{plan}</Markdown>
    </div>
  )
}

function ToolBody({ tool }: { tool: Message }) {
  const colors = useColors()
  const toolName = tool.toolName || 'Tool'
  const isError = tool.toolStatus === 'error'
  const isDiff = toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit' || toolName === 'NotebookEdit'

  if (toolName === 'TodoWrite' && tool.toolInput) {
    return <TodoChecklist input={tool.toolInput} />
  }
  if (toolName === 'ExitPlanMode' && tool.toolInput) {
    let plan: unknown = null
    try { plan = JSON.parse(tool.toolInput).plan } catch { plan = null }
    if (typeof plan === 'string' && plan.trim()) return <PlanCard plan={plan} />
  }

  return (
    <>
      {isDiff && !isError && tool.toolInput && <DiffViewer toolName={toolName} toolInput={tool.toolInput} />}
      {isDiff && isError && tool.toolResult && <ToolResultView result={tool.toolResult} isError />}
      {!isDiff && tool.toolResult && <ToolResultView result={tool.toolResult} isError={isError} />}
      {!isDiff && !tool.toolResult && isError && (
        <span className="inline-block text-[10px] mt-1 px-1.5 py-[1px] rounded" style={{ background: colors.statusErrorBg, color: colors.statusError }}>
          failed
        </span>
      )}
      {!isDiff && !tool.toolResult && !isError && (
        <span className="inline-flex items-center gap-1 text-[10px] mt-1" style={{ color: colors.statusComplete }}>
          <Check size={10} weight="bold" /> done
        </span>
      )}
    </>
  )
}

function ToolGroup({ tools, skipMotion }: { tools: Message[]; skipMotion?: boolean }) {
  const hasRunning = tools.some((t) => t.toolStatus === 'running')
  const hasDiffTool = tools.some((t) => t.toolName === 'Edit' || t.toolName === 'Write' || t.toolName === 'MultiEdit' || t.toolName === 'NotebookEdit')
  const [expanded, setExpanded] = useState(() => hasDiffTool)
  const colors = useColors()

  const isOpen = expanded || hasRunning

  if (isOpen) {
    const inner = (
      <div className="py-2">
        {!hasRunning && (
          <div
            className="flex items-center gap-1 cursor-pointer mb-1.5"
            onClick={() => setExpanded(false)}
          >
            <CaretDown size={10} style={{ color: colors.textTertiary }} />
            <span className="text-[11px]" style={{ color: colors.textTertiary }}>
              Used {tools.length} tool{tools.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        <div className="relative pl-6">
          <div
            className="absolute left-[10px] top-1 bottom-1 w-px"
            style={{ background: colors.timelineLine }}
          />

          <div className="space-y-3">
            {tools.map((tool) => {
              const isRunning = tool.toolStatus === 'running'
              const toolName = tool.toolName || 'Tool'
              const desc = getToolDescription(toolName, tool.toolInput)

              return (
                <div key={tool.id} className="relative">
                  <div
                    className="absolute -left-6 top-[1px] w-[20px] h-[20px] rounded-full flex items-center justify-center"
                    style={{
                      background: isRunning ? colors.toolRunningBg : colors.toolBg,
                      border: `1px solid ${isRunning ? colors.toolRunningBorder : colors.toolBorder}`,
                    }}
                  >
                    {isRunning
                      ? <SpinnerGap size={10} className="animate-spin" style={{ color: colors.statusRunning }} />
                      : <ToolIcon name={toolName} size={10} />
                    }
                  </div>

                  <div className="min-w-0">
                    <span
                      className="text-[12px] leading-[1.4] block truncate"
                      style={{ color: isRunning ? colors.textSecondary : colors.textTertiary }}
                    >
                      {desc}
                    </span>

                    {isRunning && (
                      <span className="text-[10px] mt-0.5 block" style={{ color: colors.textTertiary }}>
                        running…
                      </span>
                    )}

                    {!isRunning && <ToolBody tool={tool} />}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )

    if (skipMotion) return inner

    return (
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ type: 'spring', stiffness: 350, damping: 28, mass: 0.7, opacity: { duration: 0.15 } }}
      >
        {inner}
      </motion.div>
    )
  }

  // Collapsed state — summary text + chevron, no container
  const summary = toolSummary(tools)

  const inner = (
    <div
      className="flex items-start gap-1.5 cursor-pointer py-1.5 min-w-0"
      onClick={() => setExpanded(true)}
    >
      <CaretRight size={10} className="flex-shrink-0 mt-[2px]" style={{ color: colors.textTertiary }} />
      <span className="text-[11px] leading-[1.45] break-words min-w-0" style={{ color: colors.textTertiary }}>
        {summary}
      </span>
    </div>
  )

  if (skipMotion) return <div className="py-1">{inner}</div>

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28, mass: 0.5 }}
      className="py-1"
    >
      {inner}
    </motion.div>
  )
}

function ThinkingMessage({ message, skipMotion }: { message: Message; skipMotion?: boolean }) {
  const [expanded, setExpanded] = useState(true)
  const colors = useColors()

  const inner = (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        border: `1px solid ${colors.toolBorder}`,
        background: colors.surfaceHover,
      }}
    >
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
        onClick={() => setExpanded((v) => !v)}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        {expanded
          ? <CaretDown size={10} style={{ color: colors.textTertiary, flexShrink: 0 }} />
          : <CaretRight size={10} style={{ color: colors.textTertiary, flexShrink: 0 }} />
        }
        <Brain size={11} style={{ color: colors.textTertiary, flexShrink: 0 }} />
        <span className="text-[11px]" style={{ color: colors.textTertiary }}>Thinking</span>
      </button>
      {expanded && (
        <div
          className="px-3 pb-2 text-[11px] leading-[1.6] whitespace-pre-wrap font-mono"
          style={{
            color: colors.textTertiary,
            borderTop: `1px solid ${colors.toolBorder}`,
            paddingTop: 6,
            maxHeight: 300,
            overflowY: 'auto',
          }}
        >
          {message.content}
        </div>
      )}
    </div>
  )

  if (skipMotion) return <div className="py-2">{inner}</div>

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26, mass: 0.6 }}
      className="py-2"
    >
      {inner}
    </motion.div>
  )
}

function SystemMessage({ message, skipMotion }: { message: Message; skipMotion?: boolean }) {
  const isError = message.content.startsWith('Error:') || message.content.includes('unexpectedly')
  const colors = useColors()

  const inner = (
    <div
      className="text-[11px] leading-[1.5] px-2.5 py-1 rounded-lg inline-block whitespace-pre-wrap"
      style={{
        background: isError ? colors.statusErrorBg : colors.surfaceHover,
        color: isError ? colors.statusError : colors.textTertiary,
      }}
    >
      {message.content}
    </div>
  )

  if (skipMotion) return <div className="py-0.5">{inner}</div>

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28, mass: 0.5 }}
      className="py-0.5"
    >
      {inner}
    </motion.div>
  )
}


function ToolIcon({ name, size = 12 }: { name: string; size?: number }) {
  const colors = useColors()
  const ICONS: Record<string, React.ReactNode> = {
    Read: <FileText size={size} />,
    Edit: <PencilSimple size={size} />,
    MultiEdit: <PencilSimple size={size} />,
    NotebookEdit: <PencilSimple size={size} />,
    Write: <FileArrowUp size={size} />,
    Bash: <Terminal size={size} />,
    Glob: <FolderOpen size={size} />,
    Grep: <MagnifyingGlass size={size} />,
    WebSearch: <Globe size={size} />,
    WebFetch: <Globe size={size} />,
    Agent: <Robot size={size} />,
    Task: <Robot size={size} />,
    LS: <FolderOpen size={size} />,
    TodoWrite: <ListChecks size={size} />,
    ExitPlanMode: <ClipboardText size={size} />,
    Skill: <Sparkle size={size} />,
    AskUserQuestion: <Question size={size} />,
  }

  const icon = name.startsWith('mcp__') ? <Plugs size={size} /> : (ICONS[name] || <Wrench size={size} />)
  return (
    <span className="flex items-center" style={{ color: colors.textTertiary }}>
      {icon}
    </span>
  )
}
