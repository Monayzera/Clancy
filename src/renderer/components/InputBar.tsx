import React, { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Microphone, ArrowUp, SpinnerGap, X, Check, Square } from '@phosphor-icons/react'
import { useSessionStore, useActiveTab, AVAILABLE_MODELS, DEFAULT_CODEX_MODEL_ID, MODELS_SUPPORTING_MAX_EFFORT, getCodexModelOptions, getEffectiveModelId } from '../stores/sessionStore'
import { AttachmentChips } from './AttachmentChips'
import { SlashCommandMenu, getFilteredCommandsWithExtras, SLASH_COMMANDS, type SlashCommand } from './SlashCommandMenu'
import { useColors, useThemeStore, type EffortLevel } from '../theme'
import { normalizeUsageData } from '../../shared/usage'

const INPUT_MIN_HEIGHT = 20
const INPUT_MAX_HEIGHT = 140
const MULTILINE_ENTER_HEIGHT = 52
const MULTILINE_EXIT_HEIGHT = 50
const INLINE_CONTROLS_RESERVED_WIDTH = 104


type VoiceState = 'idle' | 'recording' | 'transcribing'

/**
 * InputBar renders inside a glass-surface rounded-full pill provided by App.tsx.
 * It provides: textarea + mic/send buttons. Attachment chips render above when present.
 */
export function InputBar() {
  const [input, setInput] = useState('')
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [slashFilter, setSlashFilter] = useState<string | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [isMultiLine, setIsMultiLine] = useState(false)
  const [sendPulse, setSendPulse] = useState(false)
  const sendPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLTextAreaElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const sendMessage = useSessionStore((s) => s.sendMessage)
  const clearTab = useSessionStore((s) => s.clearTab)
  const addSystemMessage = useSessionStore((s) => s.addSystemMessage)
  const addAttachments = useSessionStore((s) => s.addAttachments)
  const removeAttachment = useSessionStore((s) => s.removeAttachment)

  const setPreferredModel = useSessionStore((s) => s.setPreferredModel)
  const staticInfo = useSessionStore((s) => s.staticInfo)
  const preferredModel = useSessionStore((s) => s.preferredModel)
  const preferredCodexModel = useSessionStore((s) => s.preferredCodexModel)
  const openRouter = useSessionStore((s) => s.openRouter)
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const tab = useActiveTab()
  const effort = useThemeStore((s) => s.effort)
  const setEffort = useThemeStore((s) => s.setEffort)
  const thinkingEnabled = useThemeStore((s) => s.thinkingEnabled)
  const setThinkingEnabled = useThemeStore((s) => s.setThinkingEnabled)
  const colors = useColors()
  const isBusy = tab?.status === 'running' || tab?.status === 'connecting'
  const isConnecting = tab?.status === 'connecting'
  const hasContent = input.trim().length > 0 || (tab?.attachments?.length ?? 0) > 0
  const canSend = !!tab && !isConnecting && hasContent
  const attachments = tab?.attachments || []
  const showSlashMenu = slashFilter !== null && !isConnecting
  const sessionSkills = tab?.sessionSkills
  const skillCommands: SlashCommand[] = useMemo(() => (sessionSkills || []).map((skill) => ({
    command: `/${skill}`,
    description: `Run skill: ${skill}`,
    icon: <span className="text-[11px]">✦</span>,
  })), [sessionSkills])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [activeTabId])

  // Focus textarea when window is shown (shortcut toggle, screenshot return)
  useEffect(() => {
    const unsub = window.clui.onWindowShown(() => {
      textareaRef.current?.focus()
    })
    return unsub
  }, [])

  const measureInlineHeight = useCallback((value: string): number => {
    if (typeof document === 'undefined') return 0
    if (!measureRef.current) {
      const m = document.createElement('textarea')
      m.setAttribute('aria-hidden', 'true')
      m.tabIndex = -1
      m.style.position = 'absolute'
      m.style.top = '-99999px'
      m.style.left = '0'
      m.style.height = '0'
      m.style.minHeight = '0'
      m.style.overflow = 'hidden'
      m.style.visibility = 'hidden'
      m.style.pointerEvents = 'none'
      m.style.zIndex = '-1'
      m.style.resize = 'none'
      m.style.border = '0'
      m.style.outline = '0'
      m.style.boxSizing = 'border-box'
      document.body.appendChild(m)
      measureRef.current = m
    }

    const m = measureRef.current
    const hostWidth = wrapperRef.current?.clientWidth ?? 0
    const inlineWidth = Math.max(120, hostWidth - INLINE_CONTROLS_RESERVED_WIDTH)
    m.style.width = `${inlineWidth}px`
    m.style.fontSize = '14px'
    m.style.lineHeight = '20px'
    m.style.paddingTop = '15px'
    m.style.paddingBottom = '15px'
    m.style.paddingLeft = '0'
    m.style.paddingRight = '0'

    const computed = textareaRef.current ? window.getComputedStyle(textareaRef.current) : null
    if (computed) {
      m.style.fontFamily = computed.fontFamily
      m.style.letterSpacing = computed.letterSpacing
      m.style.fontWeight = computed.fontWeight
    }

    m.value = value || ' '
    return m.scrollHeight
  }, [])

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = `${INPUT_MIN_HEIGHT}px`
    const naturalHeight = el.scrollHeight
    const clampedHeight = Math.min(naturalHeight, INPUT_MAX_HEIGHT)
    el.style.height = `${clampedHeight}px`
    el.style.overflowY = naturalHeight > INPUT_MAX_HEIGHT ? 'auto' : 'hidden'
    if (naturalHeight <= INPUT_MAX_HEIGHT) {
      el.scrollTop = 0
    }
    // Decide multiline mode against fixed inline-width measurement to avoid
    // expand/collapse bounce when layout switches between modes.
    const inlineHeight = measureInlineHeight(input)
    setIsMultiLine((prev) => {
      if (!prev) return inlineHeight > MULTILINE_ENTER_HEIGHT
      return inlineHeight > MULTILINE_EXIT_HEIGHT
    })
  }, [input, measureInlineHeight])

  useLayoutEffect(() => { autoResize() }, [input, isMultiLine, autoResize])

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
      if (measureRef.current) {
        measureRef.current.remove()
        measureRef.current = null
      }
      if (sendPulseTimerRef.current) clearTimeout(sendPulseTimerRef.current)
    }
  }, [])

  // ─── Slash command detection ───
  const updateSlashFilter = useCallback((value: string) => {
    const match = value.match(/^(\/[a-zA-Z-]*)$/)
    if (match) {
      setSlashFilter(match[1])
      setSlashIndex(0)
    } else {
      setSlashFilter(null)
    }
  }, [])

  // ─── Handle slash commands ───
  const executeCommand = useCallback((cmd: SlashCommand) => {
    switch (cmd.command) {
      case '/clear':
        clearTab()
        addSystemMessage('Conversation cleared.')
        break
      case '/cost': {
        if (tab?.lastResult) {
          const r = tab.lastResult
          const parts = [`$${r.totalCostUsd.toFixed(4)}`, `${(r.durationMs / 1000).toFixed(1)}s`, `${r.numTurns} turn${r.numTurns !== 1 ? 's' : ''}`]
          const usage = normalizeUsageData(r.usage)
          if (usage.input_tokens || usage.output_tokens) {
            parts.push(`${(usage.input_tokens || 0).toLocaleString()} in / ${(usage.output_tokens || 0).toLocaleString()} out`)
          }
          if (usage.cache_read_input_tokens || usage.cache_creation_input_tokens) {
            parts.push(`${(usage.cache_read_input_tokens || 0).toLocaleString()} cache read / ${(usage.cache_creation_input_tokens || 0).toLocaleString()} cache write`)
          }
          if (usage.reasoning_output_tokens) {
            parts.push(`${usage.reasoning_output_tokens.toLocaleString()} reasoning`)
          }
          if (usage.total_tokens) {
            parts.push(`${usage.total_tokens.toLocaleString()} total`)
          }
          addSystemMessage(parts.join(' · '))
        } else {
          addSystemMessage('No cost data yet — send a message first.')
        }
        break
      }
      case '/model': {
        if (tab?.provider === 'openclaude') {
          const current = openRouter.model?.trim() || 'not configured'
          addSystemMessage(`OpenRouter model: ${current}\n\nConfigure in Settings → OpenRouter.`)
          break
        }
        const models = tab?.provider === 'codex' ? getCodexModelOptions(preferredCodexModel || tab?.sessionModel || null) : AVAILABLE_MODELS
        const model = tab?.sessionModel || null
        const version = tab?.sessionVersion || staticInfo?.version || null
        const current = tab?.provider === 'codex'
          ? (preferredCodexModel || model || DEFAULT_CODEX_MODEL_ID)
          : (preferredModel || model || 'default')
        const hasPreferred = tab?.provider === 'codex' ? !!preferredCodexModel : !!preferredModel
        const lines = models.map((m) => {
          const active = m.id === current || (!hasPreferred && m.id === model)
          return `  ${active ? '\u25CF' : '\u25CB'} ${m.label} (${m.id})`
        })
        const header = version ? `Claude Code ${version}` : 'Claude Code'
        addSystemMessage(`${header}\n\n${lines.join('\n')}\n\nSwitch model: type /model <name>\n  e.g. /model sonnet`)
        break
      }
      case '/mcp': {
        if (tab?.sessionMcpServers && tab.sessionMcpServers.length > 0) {
          const lines = tab.sessionMcpServers.map((s) => {
            const icon = s.status === 'connected' ? '\u2713' : s.status === 'failed' ? '\u2717' : '\u25CB'
            return `  ${icon} ${s.name} — ${s.status}`
          })
          addSystemMessage(`MCP Servers (${tab.sessionMcpServers.length}):\n${lines.join('\n')}`)
        } else if (tab?.claudeSessionId) {
          addSystemMessage('No MCP servers connected in this session.')
        } else {
          addSystemMessage('No MCP data yet — send a message to start a session.')
        }
        break
      }
      case '/skills': {
        if (tab?.sessionSkills && tab.sessionSkills.length > 0) {
          const lines = tab.sessionSkills.map((s) => `/${s}`)
          addSystemMessage(`Available skills (${tab.sessionSkills.length}):\n${lines.join('\n')}`)
        } else if (tab?.claudeSessionId) {
          addSystemMessage('No skills available in this session.')
        } else {
          addSystemMessage('No session metadata yet — send a message first.')
        }
        break
      }
      case '/effort': {
        const isOpus = MODELS_SUPPORTING_MAX_EFFORT.has(getEffectiveModelId(preferredModel))
        const effortOpts = isOpus ? 'low, medium, high, max' : 'low, medium, high'
        addSystemMessage(`Effort: ${effort}\n\nSet with: /effort ${effortOpts}`)
        break
      }
      case '/thinking':
        setThinkingEnabled(!thinkingEnabled)
        addSystemMessage(`Thinking ${!thinkingEnabled ? 'enabled' : 'disabled'}`)
        break
      case '/help': {
        const lines = SLASH_COMMANDS.map((c) => `${c.command} — ${c.description}`)
        addSystemMessage(lines.join('\n'))
        break
      }
    }
  }, [tab, clearTab, addSystemMessage, staticInfo, preferredModel, preferredCodexModel, openRouter.model, effort, thinkingEnabled, setThinkingEnabled])

  const sendCliCommand = useCallback((command: string) => {
    if (!tab?.claudeSessionId) {
      addSystemMessage('No active session. Send a message first.')
      return
    }
    setInput('')
    setSlashFilter(null)
    sendMessage(command)
  }, [tab?.claudeSessionId, sendMessage, addSystemMessage])

  const handleSlashSelect = useCallback((cmd: SlashCommand) => {
    const isSkillCommand = !!tab?.sessionSkills?.includes(cmd.command.replace(/^\//, ''))
    if (isSkillCommand) {
      setInput(`${cmd.command} `)
      setSlashFilter(null)
      requestAnimationFrame(() => textareaRef.current?.focus())
      return
    }
    if (cmd.target === 'cli') {
      sendCliCommand(cmd.command)
      return
    }
    setInput('')
    setSlashFilter(null)
    executeCommand(cmd)
  }, [executeCommand, sendCliCommand, tab?.sessionSkills])

  // ─── Send ───
  const handleSend = useCallback(() => {
    if (showSlashMenu) {
      const filtered = getFilteredCommandsWithExtras(slashFilter!, skillCommands)
      if (filtered.length > 0) {
        handleSlashSelect(filtered[slashIndex])
        return
      }
    }
    const prompt = input.trim()
    const modelMatch = prompt.match(/^\/model\s+(\S+)/i)
    if (modelMatch) {
      const isCodexTab = tab?.provider === 'codex'
      const isOpenClaudeTab = tab?.provider === 'openclaude'
      if (isOpenClaudeTab) {
        setInput('')
        setSlashFilter(null)
        sendMessage(prompt)
        return
      }
      const query = modelMatch[1].toLowerCase()
      const models = isCodexTab ? getCodexModelOptions(preferredCodexModel || tab?.sessionModel || null) : AVAILABLE_MODELS
      const match = models.find((m: { id: string; label: string }) =>
        m.id.toLowerCase().includes(query) || m.label.toLowerCase().includes(query)
      )
      if (match) {
        setPreferredModel(match.id, isCodexTab ? 'codex' : 'claude')
        setInput('')
        setSlashFilter(null)
        addSystemMessage(`Model switched to ${match.label} (${match.id})`)
      } else {
        setInput('')
        setSlashFilter(null)
        addSystemMessage(`Unknown model "${modelMatch[1]}".`)
      }
      return
    }
    const effortMatch = prompt.match(/^\/effort\s+(\S+)/i)
    if (effortMatch) {
      const val = effortMatch[1].toLowerCase() as EffortLevel
      const isOpus = MODELS_SUPPORTING_MAX_EFFORT.has(getEffectiveModelId(preferredModel))
      const validEfforts = isOpus ? ['low', 'medium', 'high', 'max'] : ['low', 'medium', 'high']
      if (validEfforts.includes(val)) {
        setEffort(val)
        setInput('')
        setSlashFilter(null)
        addSystemMessage(`Effort set to ${val}`)
      } else {
        setInput('')
        setSlashFilter(null)
        addSystemMessage(`Unknown effort "${effortMatch[1]}". Available: ${validEfforts.join(', ')}`)
      }
      return
    }
    const thinkingMatch = prompt.match(/^\/thinking\s+(\S+)/i)
    if (thinkingMatch) {
      const val = thinkingMatch[1].toLowerCase()
      if (val === 'on' || val === 'enabled') {
        setThinkingEnabled(true)
        setInput('')
        setSlashFilter(null)
        addSystemMessage('Thinking enabled')
      } else if (val === 'off' || val === 'disabled') {
        setThinkingEnabled(false)
        setInput('')
        setSlashFilter(null)
        addSystemMessage('Thinking disabled')
      } else {
        setInput('')
        setSlashFilter(null)
        addSystemMessage(`Unknown value "${thinkingMatch[1]}". Use: /thinking on or /thinking off`)
      }
      return
    }
    if (prompt.startsWith('/')) {
      const cmdName = prompt.split(/\s/)[0].toLowerCase()
      const knownCmd = SLASH_COMMANDS.find((c) => c.command === cmdName)
      if (knownCmd?.target === 'cli') {
        sendCliCommand(prompt)
        return
      }
    }
    if (!prompt && attachments.length === 0) return
    if (isConnecting) return
    setInput('')
    setSlashFilter(null)
    if (textareaRef.current) {
      textareaRef.current.style.height = `${INPUT_MIN_HEIGHT}px`
    }
    setSendPulse(true)
    if (sendPulseTimerRef.current) clearTimeout(sendPulseTimerRef.current)
    sendPulseTimerRef.current = setTimeout(() => setSendPulse(false), 500)
    sendMessage(prompt || 'See attached files')
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [input, isBusy, sendMessage, sendCliCommand, attachments.length, showSlashMenu, slashFilter, slashIndex, handleSlashSelect, setEffort, setThinkingEnabled])

  // ─── Keyboard ───
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSlashMenu) {
      const filtered = getFilteredCommandsWithExtras(slashFilter!, skillCommands)
      if (filtered.length === 0) { if (e.key === 'Escape') { e.preventDefault(); setSlashFilter(null) }; return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex((i) => (i + 1) % filtered.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex((i) => (i - 1 + filtered.length) % filtered.length); return }
      if (e.key === 'Tab') {
        e.preventDefault()
        const selected = filtered[Math.min(slashIndex, filtered.length - 1)]
        setInput(selected.command + ' ')
        setSlashFilter(null)
        requestAnimationFrame(() => textareaRef.current?.focus())
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); setSlashFilter(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSend() }
    if (e.key === 'Escape' && !showSlashMenu) { window.clui.hideWindow() }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInput(value)
    updateSlashFilter(value)
  }

  // ─── Paste image ───
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (!blob) return
        const reader = new FileReader()
        reader.onload = async () => {
          const dataUrl = reader.result as string
          const attachment = await window.clui.pasteImage(dataUrl)
          if (attachment) addAttachments([attachment])
        }
        reader.readAsDataURL(blob)
        return
      }
    }
  }, [addAttachments])

  // ─── Voice ───
  const cancelledRef = useRef(false)

  const stopRecording = useCallback(() => {
    cancelledRef.current = false
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
  }, [])

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
  }, [])

  const startRecording = useCallback(async () => {
    setVoiceError(null)
    chunksRef.current = []
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setVoiceError('Microphone permission denied.')
      return
    }
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
    const recorder = new MediaRecorder(stream, { mimeType })
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      if (cancelledRef.current) { cancelledRef.current = false; setVoiceState('idle'); return }
      if (chunksRef.current.length === 0) { setVoiceState('idle'); return }
      setVoiceState('transcribing')
      try {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        const wavBase64 = await blobToWavBase64(blob)
        const result = await window.clui.transcribeAudio(wavBase64)
        if (result.error) setVoiceError(result.error)
        else if (result.transcript) setInput((prev) => (prev ? `${prev} ${result.transcript}` : result.transcript!))
      } catch (err: any) { setVoiceError(`Voice failed: ${err.message}`) }
      finally { setVoiceState('idle') }
    }
    recorder.onerror = () => { stream.getTracks().forEach((t) => t.stop()); setVoiceError('Recording failed.'); setVoiceState('idle') }
    mediaRecorderRef.current = recorder
    setVoiceState('recording')
    recorder.start()
  }, [])

  const handleVoiceToggle = useCallback(() => {
    if (voiceState === 'recording') stopRecording()
    else if (voiceState === 'idle') void startRecording()
  }, [voiceState, startRecording, stopRecording])

  const hasAttachments = attachments.length > 0

  return (
    <div ref={wrapperRef} data-clui-ui className={`flex flex-col w-full relative ${sendPulse ? 'animate-send-pulse' : ''}`}>
      {/* Slash command menu */}
      <AnimatePresence>
        {showSlashMenu && (
          <SlashCommandMenu
            filter={slashFilter!}
            selectedIndex={slashIndex}
            onSelect={handleSlashSelect}
            anchorRect={wrapperRef.current?.getBoundingClientRect() ?? null}
            extraCommands={skillCommands}
          />
        )}
      </AnimatePresence>

      {/* Attachment chips — renders inside the pill, above textarea */}
      {hasAttachments && (
        <div style={{ paddingTop: 6, marginLeft: -6 }}>
          <AttachmentChips attachments={attachments} onRemove={removeAttachment} />
        </div>
      )}

      {/* Single-line: inline controls. Multi-line: controls in bottom row */}
      <div className="w-full" style={{ minHeight: 50 }}>
        {isMultiLine ? (
          <div className="w-full">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                isConnecting
                  ? 'Initializing...'
                  : voiceState === 'recording'
                    ? 'Recording... ✓ to confirm, ✕ to cancel'
                    : voiceState === 'transcribing'
                      ? 'Transcribing...'
                      : isBusy
                        ? 'Type to queue a message...'
                        : 'Ask Claude Code anything...'
              }
              rows={1}
              className="w-full bg-transparent resize-none"
              style={{
                fontSize: 14,
                lineHeight: '20px',
                color: colors.textPrimary,
                minHeight: 20,
                maxHeight: INPUT_MAX_HEIGHT,
                paddingTop: 11,
                paddingBottom: 2,
              }}
            />

            <div className="flex items-center justify-end gap-1" style={{ marginTop: 0, paddingBottom: 4 }}>
              <VoiceButtons
                voiceState={voiceState}
                isConnecting={isConnecting}
                colors={colors}
                onToggle={handleVoiceToggle}
                onCancel={cancelRecording}
                onStop={stopRecording}
              />
              <AnimatePresence>
                {isBusy && voiceState !== 'recording' && (
                  <motion.div key="stop" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.1 }}>
                    <motion.button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => activeTabId && window.clui.stopTab(activeTabId)}
                      className="w-9 h-9 rounded-full flex items-center justify-center"
                      style={{ background: colors.stopBg, color: '#fff' }}
                      title="Stop generating"
                      whileHover={{ scale: 1.08 }}
                      whileTap={{ scale: 0.9 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                    >
                      <Square size={13} weight="fill" />
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
              <AnimatePresence>
                {canSend && voiceState !== 'recording' && (
                  <motion.div key="send" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.1 }}>
                    <motion.button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleSend}
                      className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
                      style={{ background: colors.sendBg, color: colors.textOnAccent }}
                      title={isBusy ? 'Queue message' : 'Send (Enter)'}
                      whileHover={{ scale: 1.08 }}
                      whileTap={{ scale: 0.9 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                    >
                      <ArrowUp size={16} weight="bold" />
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        ) : (
          <div className="flex items-center w-full" style={{ minHeight: 50 }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                isConnecting
                  ? 'Initializing...'
                  : voiceState === 'recording'
                    ? 'Recording... ✓ to confirm, ✕ to cancel'
                    : voiceState === 'transcribing'
                      ? 'Transcribing...'
                      : isBusy
                        ? 'Type to queue a message...'
                        : 'Ask Claude Code anything...'
              }
              rows={1}
              className="flex-1 bg-transparent resize-none"
              style={{
                fontSize: 14,
                lineHeight: '20px',
                color: colors.textPrimary,
                minHeight: 20,
                maxHeight: INPUT_MAX_HEIGHT,
                paddingTop: 15,
                paddingBottom: 15,
              }}
            />

            <div className="flex items-center gap-1 shrink-0 ml-2">
              <VoiceButtons
                voiceState={voiceState}
                isConnecting={isConnecting}
                colors={colors}
                onToggle={handleVoiceToggle}
                onCancel={cancelRecording}
                onStop={stopRecording}
              />
              <AnimatePresence>
                {isBusy && voiceState !== 'recording' && (
                  <motion.div key="stop" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.1 }}>
                    <motion.button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => activeTabId && window.clui.stopTab(activeTabId)}
                      className="w-9 h-9 rounded-full flex items-center justify-center"
                      style={{ background: colors.stopBg, color: '#fff' }}
                      title="Stop generating"
                      whileHover={{ scale: 1.08 }}
                      whileTap={{ scale: 0.9 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                    >
                      <Square size={13} weight="fill" />
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
              <AnimatePresence>
                {canSend && voiceState !== 'recording' && (
                  <motion.div key="send" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.1 }}>
                    <motion.button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleSend}
                      className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
                      style={{ background: colors.sendBg, color: colors.textOnAccent }}
                      title={isBusy ? 'Queue message' : 'Send (Enter)'}
                      whileHover={{ scale: 1.08 }}
                      whileTap={{ scale: 0.9 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                    >
                      <ArrowUp size={16} weight="bold" />
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      {/* Voice error */}
      {voiceError && (
        <div className="px-1 pb-2 text-[11px]" style={{ color: colors.statusError }}>
          {voiceError}
        </div>
      )}
    </div>
  )
}

// ─── Voice Buttons (extracted to avoid duplication) ───

function VoiceButtons({ voiceState, isConnecting, colors, onToggle, onCancel, onStop }: {
  voiceState: VoiceState
  isConnecting: boolean
  colors: ReturnType<typeof useColors>
  onToggle: () => void
  onCancel: () => void
  onStop: () => void
}) {
  return (
    <AnimatePresence mode="wait">
      {voiceState === 'recording' ? (
        <motion.div
          key="voice-controls"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.12 }}
          className="flex items-center gap-1"
        >
          <motion.button
            onMouseDown={(e) => e.preventDefault()}
            onClick={onCancel}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
            style={{ background: colors.surfaceHover, color: colors.textTertiary }}
            title="Cancel recording"
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.9 }}
          >
            <X size={15} weight="bold" />
          </motion.button>
          <motion.button
            onMouseDown={(e) => e.preventDefault()}
            onClick={onStop}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
            style={{ background: colors.accent, color: colors.textOnAccent }}
            title="Confirm recording"
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.9 }}
          >
            <Check size={15} weight="bold" />
          </motion.button>
        </motion.div>
      ) : voiceState === 'transcribing' ? (
        <motion.div key="transcribing" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.1 }}>
          <button
            disabled
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: colors.micBg, color: colors.micColor }}
          >
            <SpinnerGap size={16} className="animate-spin" />
          </button>
        </motion.div>
      ) : (
        <motion.div key="mic" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.1 }}>
          <motion.button
            onMouseDown={(e) => e.preventDefault()}
            onClick={onToggle}
            disabled={isConnecting}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
            style={{
              background: colors.micBg,
              color: isConnecting ? colors.micDisabled : colors.micColor,
            }}
            title="Voice input"
            whileHover={isConnecting ? {} : { scale: 1.08 }}
            whileTap={isConnecting ? {} : { scale: 0.9 }}
          >
            <Microphone size={16} />
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Audio conversion: WebM blob → WAV base64 ───

async function blobToWavBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer()
  const audioCtx = new AudioContext()
  const decoded = await audioCtx.decodeAudioData(arrayBuffer)
  audioCtx.close()
  const mono = mixToMono(decoded)
  const inputRms = rmsLevel(mono)
  if (inputRms < 0.003) {
    throw new Error('No voice detected. Check microphone permission and speak closer to the mic.')
  }
  const resampled = resampleLinear(mono, decoded.sampleRate, 16000)
  const normalized = normalizePcm(resampled)
  const wavBuffer = encodeWav(normalized, 16000)
  return bufferToBase64(wavBuffer)
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer
  if (numberOfChannels <= 1) return buffer.getChannelData(0)

  const mono = new Float32Array(length)
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const channel = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) mono[i] += channel[i]
  }
  const inv = 1 / numberOfChannels
  for (let i = 0; i < length; i++) mono[i] *= inv
  return mono
}

function resampleLinear(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input
  const ratio = inRate / outRate
  const outLength = Math.max(1, Math.floor(input.length / ratio))
  const output = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const t = pos - i0
    output[i] = input[i0] * (1 - t) + input[i1] * t
  }
  return output
}

function normalizePcm(samples: Float32Array): Float32Array {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > peak) peak = a
  }
  if (peak < 1e-4 || peak > 0.95) return samples

  const gain = Math.min(0.95 / peak, 8)
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain
  return out
}

function rmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sumSq = 0
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i]
  return Math.sqrt(sumSq / samples.length)
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numSamples = samples.length
  const buffer = new ArrayBuffer(44 + numSamples * 2)
  const view = new DataView(buffer)
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + numSamples * 2, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, numSamples * 2, true)
  let offset = 44
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    offset += 2
  }
  return buffer
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}
