import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { DotsThree, Bell, ArrowsOutSimple, Moon, Brain, Lightning, Scroll, Plugs, Plus, X, Terminal, GlobeSimple, CaretLeft, Trash, Robot } from '@phosphor-icons/react'
import { useThemeStore, type EffortLevel } from '../theme'
import { useSessionStore, MODELS_SUPPORTING_MAX_EFFORT, getEffectiveModelId } from '../stores/sessionStore'
import { usePopoverLayer } from './PopoverLayer'
import { useColors } from '../theme'

function RowToggle({
  checked,
  onChange,
  colors,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  colors: ReturnType<typeof useColors>
  label: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className="relative w-9 h-5 rounded-full transition-colors"
      style={{
        background: checked ? colors.accent : colors.surfaceSecondary,
        border: `1px solid ${checked ? colors.accent : colors.containerBorder}`,
      }}
    >
      <span
        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full transition-all"
        style={{
          left: checked ? 18 : 2,
          background: '#fff',
        }}
      />
    </button>
  )
}

function SegmentedControl({
  value,
  onChange,
  options,
  colors,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  colors: ReturnType<typeof useColors>
}) {
  return (
    <div
      className="flex rounded-lg overflow-hidden"
      style={{ background: colors.surfaceSecondary, gap: 2, padding: 2 }}
    >
      {options.map((opt) => {
        const active = opt.value === value
        const isMax = opt.value === 'max'
        const activeBg = isMax ? 'linear-gradient(135deg, #FF6B35, #FF8C42)' : colors.accent
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="flex-1 text-[11px] font-medium py-0.5 rounded-md transition-colors"
            style={{
              background: active ? activeBg : 'transparent',
              color: active ? (isMax ? '#fff' : colors.textOnAccent) : (isMax ? '#FF6B35' : colors.textTertiary),
              fontWeight: isMax ? 700 : undefined,
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/* ─── Settings popover ─── */

export function SettingsPopover() {
  const soundEnabled = useThemeStore((s) => s.soundEnabled)
  const setSoundEnabled = useThemeStore((s) => s.setSoundEnabled)
  const themeMode = useThemeStore((s) => s.themeMode)
  const setThemeMode = useThemeStore((s) => s.setThemeMode)
  const expandedUI = useThemeStore((s) => s.expandedUI)
  const setExpandedUI = useThemeStore((s) => s.setExpandedUI)
  const effort = useThemeStore((s) => s.effort)
  const setEffort = useThemeStore((s) => s.setEffort)
  const thinkingEnabled = useThemeStore((s) => s.thinkingEnabled)
  const setThinkingEnabled = useThemeStore((s) => s.setThinkingEnabled)
  const defaultProvider = useThemeStore((s) => s.defaultProvider)
  const setDefaultProvider = useThemeStore((s) => s.setDefaultProvider)
  const globalRules = useThemeStore((s) => s.globalRules)
  const rulesProfiles = useThemeStore((s) => s.rulesProfiles)
  const activeProfileId = useThemeStore((s) => s.activeProfileId)
  const setActiveProfile = useThemeStore((s) => s.setActiveProfile)
  const createProfile = useThemeStore((s) => s.createProfile)
  const updateProfileName = useThemeStore((s) => s.updateProfileName)
  const setRulesContent = useThemeStore((s) => s.setRulesContent)
  const deleteProfile = useThemeStore((s) => s.deleteProfile)
  const isExpanded = useSessionStore((s) => s.isExpanded)
  const preferredModel = useSessionStore((s) => s.preferredModel)
  const openRouter = useSessionStore((s) => s.openRouter)
  const setOpenRouterConfig = useSessionStore((s) => s.setOpenRouterConfig)
  const supportsMaxEffort = MODELS_SUPPORTING_MAX_EFFORT.has(getEffectiveModelId(preferredModel))
  const isCodex = useSessionStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    return tab?.provider === 'codex'
  })
  const popoverLayer = usePopoverLayer()
  const colors = useColors()

  const activeTab_ = useSessionStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    return tab
  })
  const mcpServers = activeTab_?.sessionMcpServers || []
  const showOpenRouterTab = defaultProvider === 'openclaude' || activeTab_?.provider === 'openclaude'

  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'settings' | 'openrouter' | 'rules' | 'mcp'>('settings')
  const [showNewInput, setShowNewInput] = useState(false)
  const [newName, setNewName] = useState('')
  const [newNameErr, setNewNameErr] = useState('')
  const [editName, setEditName] = useState('')
  const [renameErr, setRenameErr] = useState('')
  const isSwitchingProfileRef = useRef(false)
  const [mcpView, setMcpView] = useState<'list' | 'add'>('list')
  const [mcpType, setMcpType] = useState<'stdio' | 'http'>('stdio')
  const [mcpName, setMcpName] = useState('')
  const [mcpCommand, setMcpCommand] = useState('')
  const [mcpArgs, setMcpArgs] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')
  const [mcpEnv, setMcpEnv] = useState('')
  const [mcpAdding, setMcpAdding] = useState(false)
  const [mcpError, setMcpError] = useState('')
  const [mcpRemoving, setMcpRemoving] = useState<string | null>(null)
  const [orEnabled, setOrEnabled] = useState(openRouter.enabled)
  const [orApiKey, setOrApiKey] = useState(openRouter.apiKey)
  const [orBaseUrl, setOrBaseUrl] = useState(openRouter.baseUrl)
  const [orModel, setOrModel] = useState(openRouter.model)
  const [orHttpReferer, setOrHttpReferer] = useState(openRouter.httpReferer || '')
  const [orAppTitle, setOrAppTitle] = useState(openRouter.appTitle || '')
  const [orOpenClaudePath, setOrOpenClaudePath] = useState(openRouter.openClaudePath || '')
  const [orSaved, setOrSaved] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ right: number; top?: number; bottom?: number; maxHeight?: number }>({ right: 0 })

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const gap = 6
    const right = window.innerWidth - rect.right
    const estimatedHeight = 300

    if (rect.top < estimatedHeight + gap) {
      setPos({ top: rect.bottom + gap, right, maxHeight: undefined })
    } else {
      setPos({ bottom: window.innerHeight - rect.top + gap, right, maxHeight: undefined })
    }
  }, [isExpanded])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onResize = () => updatePos()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open, updatePos])

  useEffect(() => {
    if (!open || !triggerRef.current) return
    let raf = 0
    let lastRight = -1
    let lastAnchor = -1
    const check = () => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      const r = window.innerWidth - rect.right
      const a = isExpanded ? rect.bottom : rect.top
      if (r !== lastRight || a !== lastAnchor) {
        lastRight = r
        lastAnchor = a
        updatePos()
      }
      raf = requestAnimationFrame(check)
    }
    raf = requestAnimationFrame(check)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [open, expandedUI, isExpanded, updatePos])

  const handleToggle = () => {
    if (!open) updatePos()
    setOpen((o) => !o)
  }

  useEffect(() => {
    if (activeProfileId !== null) {
      const p = rulesProfiles.find((p) => p.id === activeProfileId)
      setEditName(p?.name ?? '')
    }
    setRenameErr('')
  }, [activeProfileId])

  useEffect(() => {
    setOrEnabled(openRouter.enabled)
    setOrApiKey(openRouter.apiKey)
    setOrBaseUrl(openRouter.baseUrl)
    setOrModel(openRouter.model)
    setOrHttpReferer(openRouter.httpReferer || '')
    setOrAppTitle(openRouter.appTitle || '')
    setOrOpenClaudePath(openRouter.openClaudePath || '')
  }, [openRouter])

  useEffect(() => {
    if (!showOpenRouterTab && activeTab === 'openrouter') {
      setActiveTab('settings')
    }
  }, [showOpenRouterTab, activeTab])

  const handleCreateProfile = () => {
    if (!newName.trim()) { setNewNameErr('Name cannot be empty'); return }
    const profile = createProfile(newName)
    if (!profile) { setNewNameErr('Name already exists'); return }
    setShowNewInput(false); setNewName(''); setNewNameErr('')
  }

  const handleNameBlur = () => {
    if (isSwitchingProfileRef.current) { isSwitchingProfileRef.current = false; return }
    if (!activeProfileId) return
    if (!editName.trim()) {
      setRenameErr('Name cannot be empty')
      const p = rulesProfiles.find((p) => p.id === activeProfileId)
      setEditName(p?.name ?? '')
      return
    }
    const ok = updateProfileName(activeProfileId, editName)
    if (!ok) {
      setRenameErr('Name already exists')
      const p = rulesProfiles.find((p) => p.id === activeProfileId)
      setEditName(p?.name ?? '')
    } else {
      setRenameErr('')
    }
  }

  const handleDeleteProfile = () => {
    if (activeProfileId) { deleteProfile(activeProfileId); setRenameErr('') }
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors"
        style={{ color: colors.textTertiary }}
        title="Settings"
      >
        <DotsThree size={16} weight="bold" />
      </button>

      {popoverLayer && open && createPortal(
        <motion.div
          ref={popoverRef}
          data-clui-ui
          initial={{ opacity: 0, y: 6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 400, damping: 28, mass: 0.6 }}
          className="rounded-xl"
          style={{
            position: 'fixed',
            ...(pos.top != null ? { top: pos.top } : {}),
            ...(pos.bottom != null ? { bottom: pos.bottom } : {}),
            right: pos.right,
            width: 320,
            maxHeight: 420,
            pointerEvents: 'auto',
            background: colors.popoverBg,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: colors.popoverShadow,
            border: `1px solid ${colors.popoverBorder}`,
            display: 'flex',
            flexDirection: 'column' as const,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: '100%' }}>
            <div
              className="flex flex-shrink-0"
              style={{ borderBottom: `1px solid ${colors.popoverBorder}` }}
            >
              {(['settings', ...(showOpenRouterTab ? ['openrouter'] as const : []), 'rules', 'mcp'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => { setActiveTab(tab); if (tab === 'mcp') { setMcpView('list'); setMcpError('') } }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-medium transition-colors"
                  style={{
                    color: activeTab === tab ? colors.textPrimary : colors.textTertiary,
                    background: 'transparent',
                    border: 'none',
                    borderBottom: activeTab === tab ? `2px solid ${colors.accent}` : '2px solid transparent',
                    cursor: 'pointer',
                    paddingBottom: 6,
                  }}
                >
                  {tab === 'settings' && <><Lightning size={10} />Settings</>}
                  {tab === 'openrouter' && <><GlobeSimple size={10} />OpenRouter</>}
                  {tab === 'rules' && <><Scroll size={10} />Rules</>}
                  {tab === 'mcp' && <><Plugs size={10} />MCP</>}
                </button>
              ))}
            </div>

            {activeTab === 'settings' && (
              <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
                <div className="p-3 flex flex-col gap-2.5">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <ArrowsOutSimple size={14} style={{ color: colors.textTertiary }} />
                        <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                          Full width
                        </div>
                      </div>
                      <RowToggle checked={expandedUI} onChange={(next) => setExpandedUI(next)} colors={colors} label="Toggle full width panel" />
                    </div>
                  </div>

                  <div style={{ height: 1, background: colors.popoverBorder }} />

                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Bell size={14} style={{ color: colors.textTertiary }} />
                        <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                          Notification sound
                        </div>
                      </div>
                      <RowToggle checked={soundEnabled} onChange={setSoundEnabled} colors={colors} label="Toggle notification sound" />
                    </div>
                  </div>

                  <div style={{ height: 1, background: colors.popoverBorder }} />

                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Moon size={14} style={{ color: colors.textTertiary }} />
                        <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                          Dark theme
                        </div>
                      </div>
                      <RowToggle checked={themeMode === 'dark'} onChange={(next) => setThemeMode(next ? 'dark' : 'light')} colors={colors} label="Toggle dark theme" />
                    </div>
                  </div>

                  <div style={{ height: 1, background: colors.popoverBorder }} />

                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Robot size={14} style={{ color: colors.textTertiary }} />
                        <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                          Default AI
                        </div>
                      </div>
                      <SegmentedControl
                        value={defaultProvider}
                        onChange={(v) => setDefaultProvider(v as 'claude' | 'openclaude' | 'codex')}
                        options={[
                          { value: 'claude', label: 'Claude' },
                          { value: 'openclaude', label: 'OpenClaude' },
                          { value: 'codex', label: 'Codex' },
                        ]}
                        colors={colors}
                      />
                    </div>
                  </div>

                  <div style={{ height: 1, background: colors.popoverBorder }} />

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <Lightning size={14} style={{ color: colors.textTertiary }} />
                      <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                        {isCodex ? 'Reasoning' : 'Effort'}
                      </div>
                    </div>
                    <SegmentedControl
                      value={isCodex
                        ? (effort === 'max' ? 'max' : effort)
                        : (effort === 'max' && !supportsMaxEffort ? 'high' : effort)
                      }
                      onChange={(v) => setEffort(v as EffortLevel)}
                      options={isCodex
                        ? [
                            { value: 'low', label: 'Low' },
                            { value: 'medium', label: 'Medium' },
                            { value: 'high', label: 'High' },
                            { value: 'max', label: 'Extra' },
                          ]
                        : [
                            { value: 'low', label: 'Low' },
                            { value: 'medium', label: 'Medium' },
                            { value: 'high', label: 'High' },
                            ...(supportsMaxEffort ? [{ value: 'max', label: 'Max' }] : []),
                          ]
                      }
                      colors={colors}
                    />
                  </div>

                  {!isCodex && (
                    <>
                      <div style={{ height: 1, background: colors.popoverBorder }} />

                      <div>
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <Brain size={14} style={{ color: colors.textTertiary }} />
                            <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>Thinking</div>
                          </div>
                          <RowToggle checked={thinkingEnabled} onChange={setThinkingEnabled} colors={colors} label="Toggle extended thinking" />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'openrouter' && showOpenRouterTab && (
              <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
                <div className="p-3 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <GlobeSimple size={14} style={{ color: colors.textTertiary }} />
                      <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                        OpenRouter
                      </div>
                    </div>
                    <RowToggle checked={orEnabled} onChange={setOrEnabled} colors={colors} label="Toggle OpenRouter integration" />
                  </div>

                  <input
                    value={orApiKey}
                    onChange={(e) => setOrApiKey(e.target.value)}
                    placeholder="API key"
                    type="password"
                    spellCheck={false}
                    className="w-full rounded-md"
                    style={{ background: colors.surfaceSecondary, border: `1px solid ${colors.containerBorder}`, color: colors.textPrimary, padding: '6px 9px', outline: 'none', fontFamily: 'inherit', fontSize: 11 }}
                  />

                  <input
                    value={orBaseUrl}
                    onChange={(e) => setOrBaseUrl(e.target.value)}
                    placeholder="https://openrouter.ai/api/v1"
                    spellCheck={false}
                    className="w-full rounded-md"
                    style={{ background: colors.surfaceSecondary, border: `1px solid ${colors.containerBorder}`, color: colors.textPrimary, padding: '6px 9px', outline: 'none', fontFamily: 'inherit', fontSize: 11 }}
                  />

                  <input
                    value={orModel}
                    onChange={(e) => setOrModel(e.target.value)}
                    placeholder="Model (ex: openai/gpt-4.1-mini)"
                    spellCheck={false}
                    className="w-full rounded-md"
                    style={{ background: colors.surfaceSecondary, border: `1px solid ${colors.containerBorder}`, color: colors.textPrimary, padding: '6px 9px', outline: 'none', fontFamily: 'inherit', fontSize: 11 }}
                  />

                  <input
                    value={orHttpReferer}
                    onChange={(e) => setOrHttpReferer(e.target.value)}
                    placeholder="HTTP Referer (optional)"
                    spellCheck={false}
                    className="w-full rounded-md"
                    style={{ background: colors.surfaceSecondary, border: `1px solid ${colors.containerBorder}`, color: colors.textPrimary, padding: '6px 9px', outline: 'none', fontFamily: 'inherit', fontSize: 11 }}
                  />

                  <input
                    value={orAppTitle}
                    onChange={(e) => setOrAppTitle(e.target.value)}
                    placeholder="App title (optional)"
                    spellCheck={false}
                    className="w-full rounded-md"
                    style={{ background: colors.surfaceSecondary, border: `1px solid ${colors.containerBorder}`, color: colors.textPrimary, padding: '6px 9px', outline: 'none', fontFamily: 'inherit', fontSize: 11 }}
                  />

                  <input
                    value={orOpenClaudePath}
                    onChange={(e) => setOrOpenClaudePath(e.target.value)}
                    placeholder="OpenClaude binary path (optional)"
                    spellCheck={false}
                    className="w-full rounded-md"
                    style={{ background: colors.surfaceSecondary, border: `1px solid ${colors.containerBorder}`, color: colors.textPrimary, padding: '6px 9px', outline: 'none', fontFamily: 'inherit', fontSize: 11 }}
                  />

                  <button
                    type="button"
                    onClick={() => {
                      setOpenRouterConfig({
                        enabled: orEnabled,
                        apiKey: orApiKey.trim(),
                        baseUrl: orBaseUrl.trim() || 'https://openrouter.ai/api/v1',
                        model: orModel.trim(),
                        httpReferer: orHttpReferer.trim(),
                        appTitle: orAppTitle.trim(),
                        openClaudePath: orOpenClaudePath.trim(),
                      })
                      setOrSaved(true)
                      setTimeout(() => setOrSaved(false), 1200)
                    }}
                    className="flex items-center justify-center gap-1 py-[6px] rounded-lg text-[10px] font-medium transition-colors"
                    style={{ background: colors.accent, color: colors.textOnAccent, border: 'none', cursor: 'pointer' }}
                  >
                    {orSaved ? 'Saved' : 'Save OpenRouter'}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'rules' && (
              <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
                <div className="p-3 flex flex-col gap-2">
                  <div className="text-[10px] leading-[1.5]" style={{ color: colors.textTertiary }}>
                    Applied as system prompt to every session across all directories.
                  </div>

                  <div className="flex flex-wrap gap-1 items-center">
                    <button
                      type="button"
                      onMouseDown={() => { isSwitchingProfileRef.current = true }}
                      onClick={() => { setActiveProfile(null); setRenameErr('') }}
                      className="text-[10px] px-2 py-0.5 rounded-md transition-colors"
                      style={{
                        background: activeProfileId === null ? colors.accent : colors.surfaceSecondary,
                        color: activeProfileId === null ? '#fff' : colors.textSecondary,
                        border: 'none',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      None
                    </button>
                    {rulesProfiles.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={() => { isSwitchingProfileRef.current = true }}
                        onClick={() => { setActiveProfile(p.id); setRenameErr('') }}
                        className="text-[10px] px-2 py-0.5 rounded-md transition-colors"
                        style={{
                          background: activeProfileId === p.id ? colors.accent : colors.surfaceSecondary,
                          color: activeProfileId === p.id ? '#fff' : colors.textSecondary,
                          border: 'none',
                          cursor: 'pointer',
                          flexShrink: 0,
                          maxWidth: 80,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={p.name}
                      >
                        {p.name}
                      </button>
                    ))}
                    {!showNewInput && (
                      <button
                        type="button"
                        onClick={() => { setShowNewInput(true); setNewName(''); setNewNameErr('') }}
                        className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md transition-colors"
                        style={{
                          background: 'none',
                          color: colors.textTertiary,
                          border: `1px dashed ${colors.containerBorder}`,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        <Plus size={9} />
                        New
                      </button>
                    )}
                  </div>

                  {showNewInput && (
                    <div className="flex gap-1 items-center">
                      <input
                        autoFocus
                        value={newName}
                        onChange={(e) => { setNewName(e.target.value); setNewNameErr('') }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateProfile()
                          if (e.key === 'Escape') { setShowNewInput(false); setNewName(''); setNewNameErr('') }
                        }}
                        placeholder="Profile name..."
                        className="flex-1 rounded-md"
                        style={{
                          background: colors.surfaceSecondary,
                          border: `1px solid ${newNameErr ? '#ef4444' : colors.containerBorder}`,
                          color: colors.textPrimary,
                          padding: '3px 7px',
                          outline: 'none',
                          fontSize: 11,
                          fontFamily: 'inherit',
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleCreateProfile}
                        className="text-[10px] px-2 py-0.5 rounded-md flex-shrink-0"
                        style={{ background: colors.accent, color: '#fff', border: 'none', cursor: 'pointer' }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowNewInput(false); setNewName(''); setNewNameErr('') }}
                        className="flex items-center justify-center flex-shrink-0"
                        style={{ background: 'none', color: colors.textTertiary, border: 'none', cursor: 'pointer', padding: 2 }}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  )}

                  {newNameErr && (
                    <div className="text-[10px]" style={{ color: '#ef4444' }}>{newNameErr}</div>
                  )}

                  {activeProfileId !== null && (
                    <div className="flex gap-1 items-center">
                      <input
                        value={editName}
                        onChange={(e) => { setEditName(e.target.value); setRenameErr('') }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        onBlur={handleNameBlur}
                        placeholder="Profile name..."
                        className="flex-1 rounded-md"
                        style={{
                          background: colors.surfaceSecondary,
                          border: `1px solid ${renameErr ? '#ef4444' : colors.containerBorder}`,
                          color: colors.textPrimary,
                          padding: '3px 7px',
                          outline: 'none',
                          fontSize: 11,
                          fontFamily: 'inherit',
                          fontWeight: 500,
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleDeleteProfile}
                        className="flex items-center justify-center flex-shrink-0 rounded transition-opacity"
                        style={{ background: 'none', color: '#c47060', border: 'none', cursor: 'pointer', padding: 3 }}
                        title="Delete profile"
                      >
                        <Trash size={12} />
                      </button>
                    </div>
                  )}

                  {renameErr && (
                    <div className="text-[10px]" style={{ color: '#ef4444' }}>{renameErr}</div>
                  )}

                  <textarea
                    value={globalRules}
                    onChange={(e) => setRulesContent(e.target.value)}
                    placeholder={activeProfileId !== null ? 'Rules content for this profile...' : 'Always respond in Portuguese. Be concise...'}
                    spellCheck={false}
                    className="w-full rounded-lg resize-none"
                    style={{
                      height: activeProfileId !== null ? 120 : 150,
                      background: colors.surfaceSecondary,
                      border: `1px solid ${colors.containerBorder}`,
                      color: colors.textPrimary,
                      padding: '7px 9px',
                      outline: 'none',
                      fontFamily: 'inherit',
                      fontSize: 11,
                      lineHeight: 1.6,
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = colors.inputFocusBorder }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = colors.containerBorder }}
                  />
                </div>
              </div>
            )}

            {activeTab === 'mcp' && mcpView === 'list' && (
              <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
                <div className="p-2.5 flex flex-col gap-1.5">
                  {mcpServers.length === 0 && (
                    <div className="text-[10px] text-center py-4" style={{ color: colors.textTertiary }}>
                      No MCP servers in this session.
                    </div>
                  )}
                  {mcpServers.map((s) => {
                    const isOk = s.status === 'connected'
                    const isBad = s.status.toLowerCase().includes('fail')
                    return (
                      <div
                        key={s.name}
                        className="flex items-center gap-2 px-2.5 py-[7px] rounded-lg group"
                        style={{ border: `1px solid ${colors.containerBorder}` }}
                      >
                        <span
                          className="flex-shrink-0 w-[6px] h-[6px] rounded-full"
                          style={{ background: isOk ? '#4ade80' : isBad ? '#ef4444' : colors.textTertiary }}
                        />
                        <span className="flex-1 text-[11px] truncate" style={{ color: colors.textPrimary }}>{s.name}</span>
                        <span className="text-[9px] flex-shrink-0" style={{ color: isOk ? colors.textTertiary : isBad ? '#ef4444' : colors.textTertiary }}>
                          {isOk ? 'on' : isBad ? 'err' : s.status}
                        </span>
                        <button
                          type="button"
                          className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-60 transition-opacity"
                          style={{ color: colors.textTertiary, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                          disabled={mcpRemoving === s.name}
                          onClick={async () => {
                            setMcpRemoving(s.name)
                            setMcpError('')
                            try {
                              const result = await window.clui.mcpRemove(s.name, 'user')
                              if (!result.ok) setMcpError(result.error || 'Failed')
                            } finally { setMcpRemoving(null) }
                          }}
                        >
                          <X size={9} />
                        </button>
                      </div>
                    )
                  })}
                  {mcpError && (
                    <div className="text-[9px] px-1" style={{ color: '#ef4444' }}>{mcpError}</div>
                  )}
                </div>
                <div className="px-2.5 pb-2.5 flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => { setMcpView('add'); setMcpError(''); setMcpName(''); setMcpCommand(''); setMcpArgs(''); setMcpUrl(''); setMcpEnv(''); setMcpType('stdio') }}
                    className="flex items-center justify-center gap-1.5 py-[5px] rounded-lg text-[10px] font-medium transition-colors"
                    style={{ border: `1px dashed ${colors.containerBorder}`, background: 'transparent', color: colors.textTertiary, cursor: 'pointer' }}
                  >
                    <Plus size={10} />
                    Add server
                  </button>
                  <div className="text-[9px] text-center" style={{ color: colors.textTertiary, opacity: 0.7 }}>
                    Restart session to apply changes.
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'mcp' && mcpView === 'add' && (
              <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
                <div className="p-2.5 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => { setMcpView('list'); setMcpError('') }}
                    className="flex items-center gap-0.5 text-[10px] self-start"
                    style={{ color: colors.textTertiary, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    <CaretLeft size={10} />
                    Back
                  </button>

                  <input
                    value={mcpName}
                    onChange={(e) => setMcpName(e.target.value)}
                    placeholder="Name"
                    spellCheck={false}
                    className="w-full rounded-md"
                    style={{ background: colors.surfaceSecondary, border: `1px solid ${colors.containerBorder}`, color: colors.textPrimary, padding: '5px 8px', outline: 'none', fontFamily: 'inherit', fontSize: 11 }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = colors.inputFocusBorder }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = colors.containerBorder }}
                  />

                  <div className="flex rounded-lg overflow-hidden" style={{ background: colors.surfaceSecondary, gap: 2, padding: 2 }}>
                    {(['stdio', 'http'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setMcpType(t)}
                        className="flex-1 flex items-center justify-center gap-1 text-[10px] font-medium py-0.5 rounded-md transition-colors"
                        style={{ background: mcpType === t ? colors.accent : 'transparent', color: mcpType === t ? colors.textOnAccent : colors.textTertiary, border: 'none', cursor: 'pointer' }}
                      >
                        {t === 'stdio' ? <><Terminal size={9} />stdio</> : <><GlobeSimple size={9} />http</>}
                      </button>
                    ))}
                  </div>

                  {mcpType === 'stdio' && (
                    <>
                      <input
                        value={mcpCommand}
                        onChange={(e) => setMcpCommand(e.target.value)}
                        placeholder="Command (e.g. npx)"
                        spellCheck={false}
                        className="w-full rounded-md"
                        style={{ background: colors.surfaceSecondary, border: `1px solid ${colors.containerBorder}`, color: colors.textPrimary, padding: '5px 8px', outline: 'none', fontFamily: 'inherit', fontSize: 11 }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = colors.inputFocusBorder }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = colors.containerBorder }}
                      />
                      <input
                        value={mcpArgs}
                        onChange={(e) => setMcpArgs(e.target.value)}
                        placeholder="Args (space-separated)"
                        spellCheck={false}
                        className="w-full rounded-md"
                        style={{ background: colors.surfaceSecondary, border: `1px solid ${colors.containerBorder}`, color: colors.textPrimary, padding: '5px 8px', outline: 'none', fontFamily: 'inherit', fontSize: 11 }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = colors.inputFocusBorder }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = colors.containerBorder }}
                      />
                    </>
                  )}

                  {mcpType === 'http' && (
                    <input
                      value={mcpUrl}
                      onChange={(e) => setMcpUrl(e.target.value)}
                      placeholder="URL"
                      spellCheck={false}
                      className="w-full rounded-md"
                      style={{ background: colors.surfaceSecondary, border: `1px solid ${colors.containerBorder}`, color: colors.textPrimary, padding: '5px 8px', outline: 'none', fontFamily: 'inherit', fontSize: 11 }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = colors.inputFocusBorder }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = colors.containerBorder }}
                    />
                  )}

                  <input
                    value={mcpEnv}
                    onChange={(e) => setMcpEnv(e.target.value)}
                    placeholder="Env vars (KEY=val KEY2=val2)"
                    spellCheck={false}
                    className="w-full rounded-md"
                    style={{ background: colors.surfaceSecondary, border: `1px solid ${colors.containerBorder}`, color: colors.textPrimary, padding: '5px 8px', outline: 'none', fontFamily: 'inherit', fontSize: 11 }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = colors.inputFocusBorder }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = colors.containerBorder }}
                  />

                  {mcpError && (
                    <div className="text-[9px]" style={{ color: '#ef4444' }}>{mcpError}</div>
                  )}

                  <button
                    type="button"
                    disabled={mcpAdding || !mcpName.trim() || (mcpType === 'stdio' ? !mcpCommand.trim() : !mcpUrl.trim())}
                    onClick={async () => {
                      setMcpAdding(true)
                      setMcpError('')
                      try {
                        const envObj: Record<string, string> = {}
                        if (mcpEnv.trim()) {
                          mcpEnv.trim().split(/\s+/).forEach((pair) => {
                            const eq = pair.indexOf('=')
                            if (eq > 0) envObj[pair.substring(0, eq)] = pair.substring(eq + 1)
                          })
                        }
                        let json: string
                        if (mcpType === 'stdio') {
                          const args = mcpArgs.trim() ? mcpArgs.trim().split(/\s+/) : []
                          json = JSON.stringify({ type: 'stdio', command: mcpCommand.trim(), args, ...(Object.keys(envObj).length > 0 ? { env: envObj } : {}) })
                        } else {
                          json = JSON.stringify({ type: 'http', url: mcpUrl.trim(), ...(Object.keys(envObj).length > 0 ? { headers: envObj } : {}) })
                        }
                        const result = await window.clui.mcpAdd(mcpName.trim(), json, 'user')
                        if (result.ok) {
                          setMcpView('list')
                          setMcpName(''); setMcpCommand(''); setMcpArgs(''); setMcpUrl(''); setMcpEnv('')
                        } else {
                          setMcpError(result.error || 'Failed to add')
                        }
                      } finally { setMcpAdding(false) }
                    }}
                    className="flex items-center justify-center gap-1 py-[5px] rounded-lg text-[10px] font-medium transition-colors"
                    style={{
                      background: (!mcpName.trim() || (mcpType === 'stdio' ? !mcpCommand.trim() : !mcpUrl.trim())) ? colors.surfaceSecondary : colors.accent,
                      color: (!mcpName.trim() || (mcpType === 'stdio' ? !mcpCommand.trim() : !mcpUrl.trim())) ? colors.textTertiary : colors.textOnAccent,
                      border: 'none',
                      cursor: mcpAdding ? 'wait' : 'pointer',
                      opacity: mcpAdding ? 0.6 : 1,
                    }}
                  >
                    {mcpAdding ? 'Adding...' : 'Add'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </motion.div>,
        popoverLayer,
      )}
    </>
  )
}
