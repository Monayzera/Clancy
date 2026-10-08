import { create } from 'zustand'
import type { AskUserQuestionAnswer, AskUserQuestionItem, TabStatus, NormalizedEvent, EnrichedError, Message, TabState, Attachment, CatalogPlugin, PluginStatus, Provider, OpenRouterConfig, AskUserQuestionPayload } from '../../shared/types'
import { hasUsageData, normalizeUsageData, usageToTokenUsage } from '../../shared/usage'
import { useThemeStore, type EffortLevel } from '../theme'

const notificationSrc = new URL('../../../resources/notification.mp3', import.meta.url).href

// ─── Known models ───

export const AVAILABLE_MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
] as const

export const CODEX_MODELS = [
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
  { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
] as const

export const DEFAULT_CODEX_MODEL_ID = CODEX_MODELS[0].id
type ModelOption = { id: string; label: string }

export type CodexReasoningLevel = 'low' | 'medium' | 'high' | 'xhigh'

export const MODELS_SUPPORTING_MAX_EFFORT = new Set(['claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6'])

export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-8': 1000000,
  'claude-opus-4-7': 1000000,
  'claude-opus-4-6': 1000000,
  'claude-sonnet-4-6': 1000000,
  'claude-haiku-4-5-20251001': 200000,
}

export function getModelContextWindow(modelId?: string | null): number {
  if (!modelId) return 200000
  if (MODEL_CONTEXT_WINDOWS[modelId]) return MODEL_CONTEXT_WINDOWS[modelId]
  for (const key of Object.keys(MODEL_CONTEXT_WINDOWS)) {
    if (modelId.includes(key)) return MODEL_CONTEXT_WINDOWS[key]
  }
  return 200000
}

export function getEffectiveModelId(preferredModel: string | null): string {
  return preferredModel ?? AVAILABLE_MODELS[0].id
}

export function getCodexModelOptions(currentModel?: string | null): ModelOption[] {
  if (!currentModel || CODEX_MODELS.some((model) => model.id === currentModel)) {
    return [...CODEX_MODELS]
  }
  return [...CODEX_MODELS, { id: currentModel, label: `${currentModel} (saved)` }]
}

const SESSION_SETTINGS_KEY = 'clui-session-settings'
const OPENROUTER_SETTINGS_KEY = 'clui-openrouter-settings'

const DEFAULT_OPENROUTER_CONFIG: OpenRouterConfig = {
  enabled: false,
  apiKey: '',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: '',
  httpReferer: '',
  appTitle: '',
  openClaudePath: '',
}

function loadSessionSettings(): { preferredModel: string | null; preferredCodexModel: string | null; permissionMode: 'ask' | 'auto' } {
  try {
    const raw = localStorage.getItem(SESSION_SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        preferredModel: typeof parsed.preferredModel === 'string' ? parsed.preferredModel : null,
        preferredCodexModel: typeof parsed.preferredCodexModel === 'string' ? parsed.preferredCodexModel : null,
        permissionMode: parsed.permissionMode === 'auto' ? 'auto' : 'ask',
      }
    }
  } catch {}
  return { preferredModel: null, preferredCodexModel: null, permissionMode: 'ask' }
}

function saveSessionSettings(s: { preferredModel: string | null; preferredCodexModel: string | null; permissionMode: 'ask' | 'auto' }): void {
  try { localStorage.setItem(SESSION_SETTINGS_KEY, JSON.stringify(s)) } catch {}
}

const savedSession = loadSessionSettings()

function loadOpenRouterConfig(): OpenRouterConfig {
  try {
    const raw = localStorage.getItem(OPENROUTER_SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        enabled: parsed.enabled === true,
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
        baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim() ? parsed.baseUrl : DEFAULT_OPENROUTER_CONFIG.baseUrl,
        model: typeof parsed.model === 'string' ? parsed.model : '',
        httpReferer: typeof parsed.httpReferer === 'string' ? parsed.httpReferer : '',
        appTitle: typeof parsed.appTitle === 'string' ? parsed.appTitle : '',
        openClaudePath: typeof parsed.openClaudePath === 'string' ? parsed.openClaudePath : '',
      }
    }
  } catch {}
  return { ...DEFAULT_OPENROUTER_CONFIG }
}

function saveOpenRouterConfig(config: OpenRouterConfig): void {
  try { localStorage.setItem(OPENROUTER_SETTINGS_KEY, JSON.stringify(config)) } catch {}
}

const savedOpenRouter = loadOpenRouterConfig()

// ─── Store ───

interface StaticInfo {
  version: string
  email: string | null
  subscriptionType: string | null
  projectPath: string
  homePath: string
}

interface State {
  tabs: TabState[]
  activeTabId: string
  /** Global expand/collapse — user-controlled, not per-tab */
  isExpanded: boolean
  /** Global info fetched on startup (not per-session) */
  staticInfo: StaticInfo | null
  preferredModel: string | null
  preferredCodexModel: string | null
  openRouter: OpenRouterConfig
  permissionMode: 'ask' | 'auto'

  // Marketplace state
  marketplaceOpen: boolean
  marketplaceCatalog: CatalogPlugin[]
  marketplaceLoading: boolean
  marketplaceError: string | null
  marketplaceInstalledNames: string[]
  marketplacePluginStates: Record<string, PluginStatus>
  marketplaceSearch: string
  marketplaceFilter: string

  // Actions
  initStaticInfo: () => Promise<void>
  setPreferredModel: (model: string | null, provider?: Provider) => void
  setOpenRouterConfig: (config: OpenRouterConfig) => void
  setPermissionMode: (mode: 'ask' | 'auto') => void
  createTab: (provider?: Provider) => Promise<string>
  switchProvider: () => void
  selectTab: (tabId: string) => void
  closeTab: (tabId: string) => void
  clearTab: () => void
  toggleExpanded: () => void
  toggleMarketplace: () => void
  closeMarketplace: () => void
  loadMarketplace: (forceRefresh?: boolean) => Promise<void>
  setMarketplaceSearch: (query: string) => void
  setMarketplaceFilter: (filter: string) => void
  installMarketplacePlugin: (plugin: CatalogPlugin) => Promise<void>
  uninstallMarketplacePlugin: (plugin: CatalogPlugin) => Promise<void>
  buildYourOwn: () => void
  resumeSession: (sessionId: string, title?: string, projectPath?: string, projectDir?: string, provider?: Provider) => Promise<string>
  addSystemMessage: (content: string) => void
  sendMessage: (prompt: string, projectPath?: string, opts?: { keepQuestions?: boolean }) => void
  respondPermission: (tabId: string, questionId: string, optionId: string) => void
  respondUserQuestion: (tabId: string, questionId: string, answers: AskUserQuestionAnswer[], selectedIds?: string[], otherText?: string, answerText?: string, cancelled?: boolean) => Promise<boolean>
  addDirectory: (dir: string) => void
  removeDirectory: (dir: string) => void
  setBaseDirectory: (dir: string) => void
  addAttachments: (attachments: Attachment[]) => void
  removeAttachment: (attachmentId: string) => void
  clearAttachments: () => void
  handleNormalizedEvent: (tabId: string, event: NormalizedEvent) => void
  handleStatusChange: (tabId: string, newStatus: string, oldStatus: string) => void
  handleError: (tabId: string, error: EnrichedError) => void
  handleRetryStatus: (tabId: string, status: { active: boolean; attempt: number; maxAttempts: number; reason: string; delayMs: number } | null) => void
}

let msgCounter = 0
const nextMsgId = () => `msg-${++msgCounter}`

function tryParseJson(input: string): unknown | null {
  try {
    return JSON.parse(input)
  } catch {
    return null
  }
}

function parseCompletedToolInput(input: string): unknown | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const direct = tryParseJson(trimmed)
  if (direct !== null) return direct
  const start = trimmed.search(/[\[{]/)
  if (start === -1) return null
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      stack.push('}')
    } else if (ch === '[') {
      stack.push(']')
    } else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return null
      if (stack.length === 0) return tryParseJson(trimmed.slice(start, i + 1))
    }
  }
  return null
}

function toQuestionOptions(raw: unknown): AskUserQuestionPayload['options'] {
  if (!Array.isArray(raw)) return []
  const seen = new Map<string, number>()
  const makeId = (value: unknown) => {
    const baseId = String(value)
    const count = seen.get(baseId) || 0
    seen.set(baseId, count + 1)
    return count === 0 ? baseId : `${baseId}-${count}`
  }
  return raw.flatMap((option, index) => {
    if (typeof option === 'string') {
      const label = option.trim()
      return label ? [{ id: makeId(`opt-${index}`), label }] : []
    }
    if (!option || typeof option !== 'object') return []
    const source = option as Record<string, unknown>
    const idValue = source.id ?? source.value ?? `opt-${index}`
    const labelValue = source.label ?? source.text ?? source.title ?? source.value ?? idValue
    const label = String(labelValue).trim()
    if (!label) return []
    const description = typeof source.description === 'string' ? source.description : undefined
    const preview = typeof source.preview === 'string' ? source.preview : undefined
    return [{ id: makeId(idValue), label, description, preview }]
  })
}

function boolFromQuestion(raw: Record<string, unknown>, keys: string[], fallback: boolean): boolean {
  for (const key of keys) {
    if (typeof raw[key] === 'boolean') return raw[key]
  }
  return fallback
}

function toAskUserQuestions(parsed: unknown, tool: Message): AskUserQuestionPayload[] {
  const source = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  const rawQuestions = Array.isArray(parsed)
    ? parsed
    : Array.isArray(source?.questions)
      ? source.questions
      : source
        ? [source]
        : []
  const baseId = tool.toolId || tool.id
  const questions = rawQuestions.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return []
    const q = raw as Record<string, unknown>
    const questionValue = q.question ?? q.prompt ?? q.text ?? q.message
    if (typeof questionValue !== 'string' || !questionValue.trim()) return []
    const header = typeof q.header === 'string'
      ? q.header
      : typeof q.title === 'string'
        ? q.title
        : undefined
    const id = `${baseId}-${index}`
    return [{
      id,
      question: questionValue.trim(),
      header,
      options: toQuestionOptions(q.options),
      multiSelect: boolFromQuestion(q, ['multiSelect', 'multi_select', 'multiple', 'multipleSelect'], false),
      allowOtherText: boolFromQuestion(q, ['allowOtherText', 'allow_other_text', 'allowCustom'], true),
    }]
  }) satisfies AskUserQuestionItem[]
  if (questions.length === 0) return []
  const first = questions[0]
  return [{
    questionId: baseId,
    toolUseId: tool.toolId,
    question: first.question,
    header: first.header,
    options: first.options,
    multiSelect: first.multiSelect,
    allowOtherText: first.allowOtherText,
    questions,
  }]
}

function appendAskUserQuestions(existing: AskUserQuestionPayload[], incoming: AskUserQuestionPayload[]): AskUserQuestionPayload[] {
  if (incoming.length === 0) return existing
  const seen = new Set(existing.map((q) => q.questionId))
  const next = incoming.filter((q) => {
    if (seen.has(q.questionId)) return false
    seen.add(q.questionId)
    return true
  })
  return next.length > 0 ? [...existing, ...next] : existing
}

function isAskUserQuestionName(name?: string): boolean {
  return (name || '').split(':').pop()!.replace(/[_-]/g, '').toLowerCase() === 'askuserquestion'
}

function findRunningToolIndex(messages: Message[], toolId?: string, toolIndex?: number): number {
  if (toolId) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'tool' && m.toolStatus === 'running' && m.toolId === toolId) return i
    }
  }
  if (typeof toolIndex === 'number') {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'tool' && m.toolStatus === 'running' && m.toolIndex === toolIndex) return i
    }
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'tool' && m.toolStatus === 'running') return i
  }
  return -1
}

function findLastUserIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i
  }
  return -1
}

function findLastAssistantIndex(messages: Message[], streamId?: string): number {
  const lastUserIdx = findLastUserIndex(messages)
  for (let i = messages.length - 1; i > lastUserIdx; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && !m.toolName) {
      if (streamId) {
        if (m.streamId === streamId) return i
        continue
      }
      if (m.streamId) continue
      return i
    }
    if (!streamId && (m.role === 'tool' || m.role === 'thinking')) break
  }
  return -1
}

function findFirstAssistantIndex(messages: Message[]): number {
  const lastUserIdx = findLastUserIndex(messages)
  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'assistant' && !m.toolName) return i
  }
  return -1
}

function findLastThinkingIndex(messages: Message[], streamId?: string): number {
  const lastUserIdx = findLastUserIndex(messages)
  for (let i = messages.length - 1; i > lastUserIdx; i--) {
    const m = messages[i]
    if (m.role === 'thinking') {
      if (streamId) {
        if (m.streamId === streamId) return i
        continue
      }
      if (m.streamId) continue
      return i
    }
    if (!streamId) break
  }
  return -1
}

function appendTextChunk(messages: Message[], text: string, streamId?: string, appendMode: 'stream' | 'block' = 'stream'): Message[] {
  const content = appendMode === 'block' && text.trim() ? text.trim() : text
  if (!content) return messages
  const existingIdx = findLastAssistantIndex(messages, streamId)
  if (existingIdx !== -1 && appendMode === 'stream') {
    const target = messages[existingIdx]
    return [
      ...messages.slice(0, existingIdx),
      { ...target, content: target.content + content },
      ...messages.slice(existingIdx + 1),
    ]
  }
  return [
    ...messages,
    { id: nextMsgId(), role: 'assistant' as const, content, streamId, timestamp: Date.now() },
  ]
}

function appendThinkingChunk(messages: Message[], thinking: string, streamId?: string, insertBeforeAssistant?: boolean): Message[] {
  if (!thinking) return messages
  const existingIdx = findLastThinkingIndex(messages, streamId)
  if (existingIdx !== -1) {
    const target = messages[existingIdx]
    return [
      ...messages.slice(0, existingIdx),
      { ...target, content: target.content + thinking },
      ...messages.slice(existingIdx + 1),
    ]
  }
  const message: Message = { id: nextMsgId(), role: 'thinking', content: thinking, streamId, timestamp: Date.now() }
  if (insertBeforeAssistant) {
    const assistantIdx = findFirstAssistantIndex(messages)
    if (assistantIdx !== -1) {
      return [
        ...messages.slice(0, assistantIdx),
        message,
        ...messages.slice(assistantIdx),
      ]
    }
  }
  return [...messages, message]
}

let _audioCtx: AudioContext | null = null
let _audioBuffer: AudioBuffer | null = null
let _audioInitPromise: Promise<void> | null = null

function _initAmplifiedAudio(): Promise<void> {
  if (_audioInitPromise) return _audioInitPromise
  _audioInitPromise = (async () => {
    try {
      _audioCtx = new AudioContext()
      const resp = await fetch(notificationSrc)
      const buf = await resp.arrayBuffer()
      _audioBuffer = await _audioCtx.decodeAudioData(buf)
    } catch {
      _audioCtx = null
      _audioBuffer = null
      _audioInitPromise = null
    }
  })()
  return _audioInitPromise
}

function _playAmplified(): void {
  try {
    if (!_audioCtx || !_audioBuffer) return
    if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {})
    const source = _audioCtx.createBufferSource()
    source.buffer = _audioBuffer
    const gain = _audioCtx.createGain()
    gain.gain.value = 2.0
    source.connect(gain)
    gain.connect(_audioCtx.destination)
    source.start(0)
  } catch {}
}

async function playNotificationIfHidden(): Promise<void> {
  if (!useThemeStore.getState().soundEnabled) return
  try {
    const visible = await window.clui.isVisible()
    if (!visible) {
      await _initAmplifiedAudio()
      _playAmplified()
    }
  } catch {}
}

// ─── Window visibility flag (kept in sync by App.tsx) ───
let _windowVisible = true
export function setWindowVisibility(visible: boolean): void {
  _windowVisible = visible
}

function pathBasename(p: string): string {
  if (!p) return ''
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''
}

function sendTaskNotification(tabId: string, tab: { title: string; workingDirectory: string }, durationMs: number, activeTabId: string): void {
  if (_windowVisible && tabId === activeTabId) return
  const dir = pathBasename(tab.workingDirectory)
  const hasTitle = tab.title && tab.title !== 'New Tab'
  const title = 'Claude Code'
  const secs = durationMs > 0 ? Math.round(durationMs / 1000) : 0
  const timeStr = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`
  let body = ''
  if (hasTitle) {
    body = secs > 0 ? `${tab.title}\nCompleted in ${timeStr}` : `${tab.title}\nTask completed`
  } else {
    body = secs > 0 ? `Task completed in ${timeStr}` : 'Task completed'
  }
  if (dir) body += ` | ${dir}`
  try { window.clui.notifyNative({ title, body }) } catch {}
}

function emptyTokenUsage(): TabState['tokenUsage'] {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, reasoning: 0, total: 0 }
}

function makeLocalTab(provider: Provider = 'claude'): TabState {
  return {
    id: crypto.randomUUID(),
    provider,
    claudeSessionId: null,
    status: 'idle',
    activeRequestId: null,
    hasUnread: false,
    currentActivity: '',
    permissionQueue: [],
    permissionDenied: null,
    askUserQuestions: [],
    attachments: [],
    messages: [],
    title: 'New Tab',
    lastResult: null,
    sessionModel: null,
    sessionTools: [],
    sessionMcpServers: [],
    sessionSkills: [],
    sessionVersion: null,
    queuedPrompts: [],
    workingDirectory: '~',
    hasChosenDirectory: false,
    additionalDirs: [],
    tokenUsage: emptyTokenUsage(),
    retryStatus: null,
  }
}

const initialTab = makeLocalTab(useThemeStore.getState().defaultProvider)

export const useSessionStore = create<State>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  isExpanded: false,
  staticInfo: null,
  preferredModel: savedSession.preferredModel,
  preferredCodexModel: savedSession.preferredCodexModel,
  openRouter: savedOpenRouter,
  permissionMode: savedSession.permissionMode,

  // Marketplace
  marketplaceOpen: false,
  marketplaceCatalog: [],
  marketplaceLoading: false,
  marketplaceError: null,
  marketplaceInstalledNames: [],
  marketplacePluginStates: {},
  marketplaceSearch: '',
  marketplaceFilter: 'All',

  initStaticInfo: async () => {
    try {
      const result = await window.clui.start()
      set({
        staticInfo: {
          version: result.version || 'unknown',
          email: result.auth?.email || null,
          subscriptionType: result.auth?.subscriptionType || null,
          projectPath: result.projectPath || '~',
          homePath: result.homePath || '~',
        },
      })
    } catch {}
  },

  setPreferredModel: (model, provider) => {
    const s = get()
    const activeTab = s.tabs.find((t) => t.id === s.activeTabId)
    const isCodex = provider === 'codex' || activeTab?.provider === 'codex'
    const isOpenClaude = provider === 'openclaude' || activeTab?.provider === 'openclaude'
    if (isCodex) {
      set({ preferredCodexModel: model })
      saveSessionSettings({ preferredModel: s.preferredModel, preferredCodexModel: model, permissionMode: s.permissionMode })
    } else if (isOpenClaude) {
      const next = { ...s.openRouter, model: model || s.openRouter.model }
      set({ openRouter: next })
      saveOpenRouterConfig(next)
    } else {
      set({ preferredModel: model })
      saveSessionSettings({ preferredModel: model, preferredCodexModel: s.preferredCodexModel, permissionMode: s.permissionMode })
      const supportsMax = MODELS_SUPPORTING_MAX_EFFORT.has(getEffectiveModelId(model))
      if (!supportsMax && useThemeStore.getState().effort === 'max') {
        useThemeStore.getState().setEffort('high')
      }
    }
  },

  setOpenRouterConfig: (config) => {
    set({ openRouter: config })
    saveOpenRouterConfig(config)
  },

  setPermissionMode: (mode) => {
    set({ permissionMode: mode })
    window.clui.setPermissionMode(mode)
    const s = get()
    saveSessionSettings({ preferredModel: s.preferredModel, preferredCodexModel: s.preferredCodexModel, permissionMode: mode })
  },

  createTab: async (provider?: Provider) => {
    const prov = provider || useThemeStore.getState().defaultProvider
    const homeDir = get().staticInfo?.homePath || '~'
    const { tabId } = await window.clui.createTab(prov)
    const tab: TabState = {
      ...makeLocalTab(prov),
      id: tabId,
      workingDirectory: homeDir,
    }
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    }))
    useThemeStore.getState().setActiveProvider(prov)
    if (prov === 'claude') {
      const rules = useThemeStore.getState().globalRules?.trim()
      window.clui.initSession(tabId, rules || undefined)
    }
    return tabId
  },

  switchProvider: () => {
    const s = get()
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    if (!tab) return
    if (tab.status === 'running' || tab.status === 'connecting') return
    const order: Provider[] = ['claude', 'openclaude', 'codex']
    const idx = order.indexOf(tab.provider)
    const newProvider = order[(idx + 1) % order.length]
    get().createTab(newProvider)
  },

  selectTab: (tabId) => {
    const s = get()
    if (tabId === s.activeTabId) {
      const willExpand = !s.isExpanded
      set((prev) => ({
        isExpanded: willExpand,
        marketplaceOpen: false,
        tabs: willExpand
          ? prev.tabs.map((t) => t.id === tabId ? { ...t, hasUnread: false } : t)
          : prev.tabs,
      }))
    } else {
      const targetTab = s.tabs.find((t) => t.id === tabId)
      if (targetTab) {
        useThemeStore.getState().setActiveProvider(targetTab.provider)
      }
      set((prev) => ({
        activeTabId: tabId,
        marketplaceOpen: false,
        tabs: prev.tabs.map((t) =>
          t.id === tabId ? { ...t, hasUnread: false } : t
        ),
      }))
    }
  },

  toggleExpanded: () => {
    const { activeTabId, isExpanded } = get()
    const willExpand = !isExpanded
    set((s) => ({
      isExpanded: willExpand,
      marketplaceOpen: false,
      // Expanding = reading: clear unread flag for the active tab
      tabs: willExpand
        ? s.tabs.map((t) => t.id === activeTabId ? { ...t, hasUnread: false } : t)
        : s.tabs,
    }))
  },

  toggleMarketplace: () => {
    const s = get()
    if (s.marketplaceOpen) {
      set({ marketplaceOpen: false })
    } else {
      set({ isExpanded: false, marketplaceOpen: true })
      get().loadMarketplace()
    }
  },

  closeMarketplace: () => {
    set({ marketplaceOpen: false })
  },

  loadMarketplace: async (forceRefresh) => {
    set({ marketplaceLoading: true, marketplaceError: null })
    try {
      const [catalog, installed] = await Promise.all([
        window.clui.fetchMarketplace(forceRefresh),
        window.clui.listInstalledPlugins(),
      ])
      if (catalog.error && catalog.plugins.length === 0) {
        set({ marketplaceError: catalog.error, marketplaceLoading: false })
        return
      }
      const installedSet = new Set(installed.map((n) => n.toLowerCase()))
      const pluginStates: Record<string, PluginStatus> = {}
      for (const p of catalog.plugins) {
        // For SKILL.md skills: match individual name against ~/.claude/skills/ dirs
        // For CLI plugins: match installName or "installName@marketplace" against installed_plugins.json
        const candidates = p.isSkillMd
          ? [p.installName]
          : [p.installName, `${p.installName}@${p.marketplace}`]
        const isInstalled = candidates.some((c) => installedSet.has(c.toLowerCase()))
        pluginStates[p.id] = isInstalled ? 'installed' : 'not_installed'
      }
      set({
        marketplaceCatalog: catalog.plugins,
        marketplaceInstalledNames: installed,
        marketplacePluginStates: pluginStates,
        marketplaceLoading: false,
      })
    } catch (err: unknown) {
      set({
        marketplaceError: err instanceof Error ? err.message : String(err),
        marketplaceLoading: false,
      })
    }
  },

  setMarketplaceSearch: (query) => {
    set({ marketplaceSearch: query })
  },

  setMarketplaceFilter: (filter) => {
    set({ marketplaceFilter: filter })
  },

  installMarketplacePlugin: async (plugin) => {
    set((s) => ({
      marketplacePluginStates: { ...s.marketplacePluginStates, [plugin.id]: 'installing' },
    }))
    const result = await window.clui.installPlugin(plugin.repo, plugin.installName, plugin.marketplace, plugin.sourcePath, plugin.isSkillMd)
    if (result.ok) {
      set((s) => ({
        marketplacePluginStates: { ...s.marketplacePluginStates, [plugin.id]: 'installed' as PluginStatus },
        marketplaceInstalledNames: [...s.marketplaceInstalledNames, plugin.installName],
      }))
    } else {
      set((s) => ({
        marketplacePluginStates: { ...s.marketplacePluginStates, [plugin.id]: 'failed' },
      }))
    }
  },

  uninstallMarketplacePlugin: async (plugin) => {
    const result = await window.clui.uninstallPlugin(plugin.installName)
    if (result.ok) {
      set((s) => ({
        marketplacePluginStates: { ...s.marketplacePluginStates, [plugin.id]: 'not_installed' as PluginStatus },
        marketplaceInstalledNames: s.marketplaceInstalledNames.filter((n) => n !== plugin.installName),
      }))
    }
  },

  buildYourOwn: () => {
    set({ marketplaceOpen: false, isExpanded: true })
    // Small delay to let the UI transition
    setTimeout(() => {
      get().sendMessage('Help me create a new Claude Code skill')
    }, 100)
  },

  closeTab: (tabId) => {
    window.clui.closeTab(tabId).catch(() => {})

    const s = get()
    const remaining = s.tabs.filter((t) => t.id !== tabId)

    if (s.activeTabId === tabId) {
      if (remaining.length === 0) {
        const defProv = useThemeStore.getState().defaultProvider
        const newTab = makeLocalTab(defProv)
        const localId = newTab.id
        set({ tabs: [newTab], activeTabId: localId })
        useThemeStore.getState().setActiveProvider(defProv)
        window.clui.createTab(defProv).then(({ tabId }) => {
          set((s) => ({
            tabs: s.tabs.map((t) => t.id === localId ? { ...t, id: tabId } : t),
            activeTabId: s.activeTabId === localId ? tabId : s.activeTabId,
          }))
          if (defProv === 'claude') {
            const rules = useThemeStore.getState().globalRules?.trim()
            window.clui.initSession(tabId, rules || undefined)
          }
        }).catch(() => {})
        return
      }
      const closedIndex = s.tabs.findIndex((t) => t.id === tabId)
      const newActive = remaining[Math.min(closedIndex, remaining.length - 1)]
      useThemeStore.getState().setActiveProvider(newActive.provider)
      set({ tabs: remaining, activeTabId: newActive.id })
    } else {
      set({ tabs: remaining })
    }
  },

  clearTab: () => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, messages: [], lastResult: null, currentActivity: '', permissionQueue: [], permissionDenied: null, askUserQuestions: [], queuedPrompts: [], tokenUsage: emptyTokenUsage() }
          : t
      ),
    }))
  },

  resumeSession: async (sessionId, title, projectPath, projectDir, provider) => {
    const prov = provider || 'claude'
    const resolvedDir = projectPath
      ? null
      : projectDir
        ? await window.clui.resolveProjectDir(projectDir).catch(() => null) || null
        : await window.clui.resolveSessionDir(sessionId).catch(() => null) || null
    const defaultDir = projectPath || resolvedDir || get().staticInfo?.homePath || '~'
    const { tabId } = await window.clui.createTab(prov)

    const history = await window.clui.loadSession(sessionId, projectPath, projectDir).catch(() => [])
    const messages: Message[] = history.map((m) => ({
      id: nextMsgId(),
      role: m.role as Message['role'],
      content: m.content,
      toolName: m.toolName,
      toolInput: m.toolInput,
      toolStatus: m.toolName ? 'completed' as const : undefined,
      timestamp: m.timestamp,
    }))

    const tab: TabState = {
      ...makeLocalTab(prov),
      id: tabId,
      claudeSessionId: sessionId,
      title: title || 'Resumed Session',
      workingDirectory: defaultDir,
      hasChosenDirectory: !!(projectPath || resolvedDir),
      messages,
    }
    useThemeStore.getState().setActiveProvider(prov)
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
      isExpanded: true,
    }))
    return tabId
  },

  addSystemMessage: (content) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              messages: [
                ...t.messages,
                { id: nextMsgId(), role: 'system' as const, content, timestamp: Date.now() },
              ],
            }
          : t
      ),
    }))
  },

  // ─── Permission response ───

  respondPermission: (tabId, questionId, optionId) => {
    window.clui.respondPermission(tabId, questionId, optionId)
      .then((success: boolean) => {
        if (!success) return
        set((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.id !== tabId) return t
            const remaining = t.permissionQueue.filter((p) => p.questionId !== questionId)
            return {
              ...t,
              permissionQueue: remaining,
              currentActivity: remaining.length > 0
                ? `Waiting for permission: ${remaining[0].toolTitle}`
                : 'Working...',
            }
          }),
        }))
      })
      .catch(() => {})
  },

  // ─── Ask User Question response ───

  respondUserQuestion: async (tabId, questionId, answers, selectedIds = [], otherText, answerText, cancelled = false) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? { ...t, askUserQuestions: t.askUserQuestions.filter((q) => q.questionId !== questionId) }
          : t
      ),
    }))
    try {
      await window.clui.respondUserQuestion({ tabId, questionId, selectedIds, otherText, answerText, answers, cancelled })
    } catch {}
    if (cancelled) return true
    const formatted = answers
      .map((a) => {
        const value = a.answerText || a.selectedLabels.join(', ') || a.otherText || ''
        return value ? `"${a.question}"="${value}"` : ''
      })
      .filter(Boolean)
      .join(', ')
    const prompt = formatted
      ? `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`
      : (answerText || '')
    if (prompt.trim()) get().sendMessage(prompt, undefined, { keepQuestions: true })
    return true
  },

  // ─── Directory management ───

  addDirectory: (dir) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              additionalDirs: t.additionalDirs.includes(dir)
                ? t.additionalDirs
                : [...t.additionalDirs, dir],
            }
          : t
      ),
    }))
  },

  removeDirectory: (dir) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, additionalDirs: t.additionalDirs.filter((d) => d !== dir) }
          : t
      ),
    }))
  },

  setBaseDirectory: (dir) => {
    const { activeTabId } = get()
    window.clui.resetTabSession(activeTabId)
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              workingDirectory: dir,
              hasChosenDirectory: true,
              claudeSessionId: null,
              additionalDirs: [],
              tokenUsage: emptyTokenUsage(),
            }
          : t
      ),
    }))
  },

  // ─── Attachment management ───

  addAttachments: (attachments) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, attachments: [...t.attachments, ...attachments] }
          : t
      ),
    }))
  },

  removeAttachment: (attachmentId) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, attachments: t.attachments.filter((a) => a.id !== attachmentId) }
          : t
      ),
    }))
  },

  clearAttachments: () => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId ? { ...t, attachments: [] } : t
      ),
    }))
  },

  // ─── Send ───

  sendMessage: (prompt, projectPath, opts) => {
    const { activeTabId, tabs, staticInfo } = get()
    const tab = tabs.find((t) => t.id === activeTabId)
    // Use explicitly chosen directory, otherwise fall back to user home
    const resolvedPath = projectPath || (tab?.hasChosenDirectory ? tab.workingDirectory : (staticInfo?.homePath || tab?.workingDirectory || '~'))
    if (!tab) return

    if (tab.status === 'connecting') return

    const isBusy = tab.status === 'running'
    const requestId = crypto.randomUUID()

    let fullPrompt = prompt
    if (tab.attachments.length > 0) {
      const attachmentCtx = tab.attachments
        .map((a) => `[Attached ${a.type}: ${a.path}]`)
        .join('\n')
      fullPrompt = `${attachmentCtx}\n\n${prompt}`
    }

    const title = tab.messages.length === 0
      ? (prompt.length > 30 ? prompt.substring(0, 27) + '...' : prompt)
      : tab.title

    if (isBusy) {
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== activeTabId) return t
          return {
            ...t,
            title,
            attachments: [],
            queuedPrompts: [...t.queuedPrompts, prompt],
            messages: [
              ...t.messages,
              { id: nextMsgId(), role: 'user' as const, content: prompt, timestamp: Date.now(), attachments: t.attachments.length > 0 ? [...t.attachments] : undefined },
            ],
          }
        }),
      }))
    } else {
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== activeTabId) return t
          const withEffectiveBase = t.hasChosenDirectory
            ? t
            : { ...t, hasChosenDirectory: true, workingDirectory: resolvedPath }
          return {
            ...withEffectiveBase,
            status: 'connecting' as TabStatus,
            activeRequestId: requestId,
            currentActivity: prompt.trim() === '/compact' ? 'Compacting...' : (tab.claudeSessionId ? 'Thinking...' : 'Starting...'),
            title,
            attachments: [],
            queuedPrompts: [],
            permissionQueue: [],
            permissionDenied: null,
            askUserQuestions: opts?.keepQuestions ? withEffectiveBase.askUserQuestions : [],
            messages: [
              ...withEffectiveBase.messages,
              { id: nextMsgId(), role: 'user' as const, content: prompt, timestamp: Date.now(), attachments: t.attachments.length > 0 ? [...t.attachments] : undefined },
            ],
          }
        }),
      }))
    }

    const { preferredModel, preferredCodexModel, openRouter } = get()
    const { effort, thinkingEnabled, globalRules } = useThemeStore.getState()
    const isCodexTab = tab.provider === 'codex'
    const isOpenClaudeTab = tab.provider === 'openclaude'
    const activeModel = isCodexTab
      ? preferredCodexModel
      : isOpenClaudeTab
        ? (openRouter.model || preferredModel)
        : preferredModel
    const effectiveEffort: EffortLevel = (effort === 'max' && !isCodexTab && !MODELS_SUPPORTING_MAX_EFFORT.has(getEffectiveModelId(preferredModel)))
      ? 'high'
      : effort
    const runOptions = {
      prompt: fullPrompt,
      projectPath: resolvedPath,
      provider: tab.provider,
      sessionId: tab.claudeSessionId || undefined,
      model: activeModel || undefined,
      addDirs: tab.additionalDirs.length > 0 ? tab.additionalDirs : undefined,
      effort: effectiveEffort !== 'medium' ? effectiveEffort : undefined,
      thinking: isCodexTab ? undefined : (thinkingEnabled ? 'adaptive' : 'disabled') as 'adaptive' | 'disabled',
      systemPrompt: isCodexTab ? undefined : (globalRules.trim() || undefined),
      openRouter: isOpenClaudeTab ? openRouter : undefined,
    }

    window.clui.prompt(activeTabId, requestId, runOptions).catch((err: Error) => {
      get().handleError(activeTabId, {
        message: err.message,
        stderrTail: [],
        exitCode: null,
        elapsedMs: 0,
        toolCallCount: 0,
      })
    })
  },

  // ─── Event handlers ───

  handleNormalizedEvent: (tabId, event) => {
    set((s) => {
      const { activeTabId } = s
      const tabs = s.tabs.map((tab) => {
        if (tab.id !== tabId) return tab
        const updated = { ...tab }

        switch (event.type) {
          case 'session_init':
            updated.claudeSessionId = event.sessionId
            updated.sessionModel = event.model
            updated.sessionTools = event.tools
            updated.sessionMcpServers = event.mcpServers
            updated.sessionSkills = event.skills
            updated.sessionVersion = event.version
            // Don't change status/activity for warmup inits — they're invisible
            if (!event.isWarmup) {
              updated.status = 'running'
              updated.currentActivity = 'Thinking...'
              // Move the first queued prompt into the timeline (it's now being processed)
              if (updated.queuedPrompts.length > 0) {
                const [nextPrompt, ...rest] = updated.queuedPrompts
                updated.queuedPrompts = rest
                updated.messages = [
                  ...updated.messages,
                  { id: nextMsgId(), role: 'user' as const, content: nextPrompt, timestamp: Date.now() },
                ]
              }
            }
            break

          case 'thinking_chunk': {
            if (updated.status === 'completed') break
            updated.messages = appendThinkingChunk(updated.messages, event.thinking, event.streamId, event.insertBeforeAssistant)
            break
          }

          case 'text_chunk': {
            if (updated.status === 'completed') break
            updated.currentActivity = 'Writing...'
            updated.messages = appendTextChunk(updated.messages, event.text, event.streamId, event.appendMode)
            break
          }

          case 'tool_call':
            updated.currentActivity = `Running ${event.toolName}...`
            updated.messages = [
              ...updated.messages,
              {
                id: nextMsgId(),
                role: 'tool',
                content: '',
                toolName: event.toolName,
                toolId: event.toolId,
                toolIndex: event.index,
                toolInput: '',
                toolStatus: 'running',
                timestamp: Date.now(),
              },
            ]
            break

          case 'tool_call_update': {
            const msgs = [...updated.messages]
            const toolIdx = findRunningToolIndex(msgs, event.toolId, event.index)
            if (toolIdx !== -1) {
              const tool = msgs[toolIdx]
              msgs[toolIdx] = {
                ...tool,
                toolInput: event.updateMode === 'replace' ? event.partialInput : (tool.toolInput || '') + event.partialInput,
              }
            }
            updated.messages = msgs
            break
          }

          case 'tool_call_complete': {
            const msgs2 = [...updated.messages]
            const toolIdx = findRunningToolIndex(msgs2, event.toolId, event.index)
            if (toolIdx !== -1) {
              const runningTool = msgs2[toolIdx]
              msgs2[toolIdx] = { ...runningTool, toolStatus: 'completed' }
              if (isAskUserQuestionName(runningTool.toolName) && runningTool.toolInput) {
                const parsed = parseCompletedToolInput(runningTool.toolInput)
                const questions = parsed ? toAskUserQuestions(parsed, runningTool) : []
                if (questions.length > 0) {
                  updated.askUserQuestions = appendAskUserQuestions(updated.askUserQuestions, questions)
                  updated.currentActivity = 'Waiting for response...'
                }
              }
            }
            updated.messages = msgs2
            break
          }

          case 'tool_result': {
            const msgs3 = [...updated.messages]
            let idx3 = -1
            for (let i = msgs3.length - 1; i >= 0; i--) {
              const m = msgs3[i]
              if (m.role === 'tool' && m.toolId && m.toolId === event.toolUseId) { idx3 = i; break }
            }
            if (idx3 !== -1) {
              const t = msgs3[idx3]
              msgs3[idx3] = {
                ...t,
                toolResult: event.content,
                toolStatus: event.isError ? 'error' : (t.toolStatus === 'running' ? 'completed' : t.toolStatus),
              }
              updated.messages = msgs3
            }
            break
          }

          case 'task_update': {
            if (event.message?.content) {
              const lastUserIdx = (() => {
                for (let i = updated.messages.length - 1; i >= 0; i--) {
                  if (updated.messages[i].role === 'user') return i
                }
                return -1
              })()
              const hasStreamedText = updated.messages
                .slice(lastUserIdx + 1)
                .some((m) => m.role === 'assistant' && !m.toolName)

              if (!hasStreamedText) {
                const textContent = event.message.content
                  .filter((b) => b.type === 'text' && b.text)
                  .map((b) => b.text!)
                  .join('')
                if (textContent) {
                  updated.messages = [
                    ...updated.messages,
                    { id: nextMsgId(), role: 'assistant' as const, content: textContent, timestamp: Date.now() },
                  ]
                }
              }

              // ── Tool card deduplication (unchanged) ──
              for (const [blockIndex, block] of event.message.content.entries()) {
                if (block.type === 'tool_use' && block.name) {
                  const exists = updated.messages.find(
                    (m) => m.role === 'tool' && (
                      block.id
                        ? m.toolId === block.id
                        : m.toolName === block.name && !m.content
                    )
                  )
                  if (!exists) {
                    updated.messages = [
                      ...updated.messages,
                      {
                        id: nextMsgId(),
                        role: 'tool',
                        content: '',
                        toolName: block.name,
                        toolId: block.id,
                        toolIndex: blockIndex,
                        toolInput: JSON.stringify(block.input, null, 2),
                        toolStatus: 'completed',
                        timestamp: Date.now(),
                      },
                    ]
                  }
                }
              }
            }
            break
          }

          case 'task_complete':
            updated.status = 'completed'
            updated.activeRequestId = null
            updated.currentActivity = ''
            updated.permissionQueue = []
            updated.messages = updated.messages.map((m) =>
              m.role === 'tool' && m.toolStatus === 'running' ? { ...m, toolStatus: 'completed' as const } : m
            )
            updated.lastResult = {
              totalCostUsd: event.costUsd,
              durationMs: event.durationMs,
              numTurns: event.numTurns,
              usage: normalizeUsageData(event.usage),
              sessionId: event.sessionId,
            }
            if (hasUsageData(event.usage)) {
              const usage = normalizeUsageData(event.usage)
              const delta = usageToTokenUsage(usage)
              updated.tokenUsage = {
                input: delta.input,
                output: (updated.tokenUsage?.output || 0) + delta.output,
                cacheRead: delta.cacheRead,
                cacheCreation: delta.cacheCreation,
                reasoning: (updated.tokenUsage?.reasoning || 0) + delta.reasoning,
                total: delta.total || (delta.input + delta.output),
              }
            }
            // ── Final text fallback ──
            // If neither text_chunks nor task_update text produced an assistant message,
            // use event.result (the CLI's assembled final output) as last resort.
            if (event.result) {
              const lastUserIdx2 = (() => {
                for (let i = updated.messages.length - 1; i >= 0; i--) {
                  if (updated.messages[i].role === 'user') return i
                }
                return -1
              })()
              const hasAnyText = updated.messages
                .slice(lastUserIdx2 + 1)
                .some((m) => m.role === 'assistant' && !m.toolName)
              if (!hasAnyText) {
                updated.messages = [
                  ...updated.messages,
                  { id: nextMsgId(), role: 'assistant' as const, content: event.result, streamId: `${event.sessionId || tabId}-result`, timestamp: Date.now() },
                ]
              }
            }
            // Mark as unread unless the user is actively viewing this tab
            // (active tab with card expanded). A collapsed active tab still
            // counts as "unread" — the user hasn't seen the response yet.
            if (tabId !== activeTabId || !s.isExpanded) {
              updated.hasUnread = true
            }
            if (event.permissionDenials && event.permissionDenials.length > 0 && s.permissionMode !== 'auto') {
              updated.permissionDenied = { tools: event.permissionDenials }
            } else {
              updated.permissionDenied = null
            }
            // Play notification sound if window is hidden
            playNotificationIfHidden()
            // Show system notification (hidden window OR background tab)
            sendTaskNotification(tabId, updated, event.durationMs || 0, activeTabId)
            break

          case 'error':
            updated.status = 'failed'
            updated.activeRequestId = null
            updated.currentActivity = ''
            updated.permissionQueue = []
            updated.askUserQuestions = []
            updated.permissionDenied = null
            updated.messages = [
              ...updated.messages.map((m) =>
                m.role === 'tool' && m.toolStatus === 'running' ? { ...m, toolStatus: 'error' as const } : m
              ),
              { id: nextMsgId(), role: 'system', content: `Error: ${event.message}`, timestamp: Date.now() },
            ]
            break

          case 'session_dead':
            updated.status = 'dead'
            updated.activeRequestId = null
            updated.currentActivity = ''
            updated.permissionQueue = []
            updated.askUserQuestions = []
            updated.permissionDenied = null
            updated.messages = [
              ...updated.messages.map((m) =>
                m.role === 'tool' && m.toolStatus === 'running' ? { ...m, toolStatus: 'error' as const } : m
              ),
              {
                id: nextMsgId(),
                role: 'system',
                content: `Session ended unexpectedly (exit ${event.exitCode})`,
                timestamp: Date.now(),
              },
            ]
            break

          case 'permission_request': {
            const newReq: import('../../shared/types').PermissionRequest = {
              questionId: event.questionId,
              toolTitle: event.toolName,
              toolDescription: event.toolDescription,
              toolInput: event.toolInput,
              options: event.options.map((o) => ({
                optionId: o.id,
                kind: o.kind,
                label: o.label,
              })),
            }
            updated.permissionQueue = [...updated.permissionQueue, newReq]
            updated.currentActivity = `Waiting for permission: ${event.toolName}`
            break
          }

          case 'ask_user_question': {
            const questions = event.questions && event.questions.length > 0
              ? event.questions
              : [{
                  id: event.questionId,
                  question: event.question,
                  header: event.header,
                  options: event.options.map((o) => ({
                    id: o.id,
                    label: o.label,
                    description: o.description,
                    preview: o.preview,
                  })),
                  multiSelect: event.multiSelect,
                  allowOtherText: event.allowOtherText ?? true,
                }]
            const first = questions[0]
            const q: AskUserQuestionPayload = {
              questionId: event.questionId,
              toolUseId: event.toolUseId,
              question: first.question,
              header: first.header,
              options: first.options,
              multiSelect: first.multiSelect,
              allowOtherText: first.allowOtherText,
              questions,
              validationError: event.validationError,
            }
            updated.askUserQuestions = appendAskUserQuestions(updated.askUserQuestions, [q])
            updated.currentActivity = `Waiting for response...`
            break
          }

          case 'rate_limit':
            if (event.status !== 'allowed') {
              updated.messages = [
                ...updated.messages,
                {
                  id: nextMsgId(),
                  role: 'system',
                  content: `Rate limited (${event.rateLimitType}). Resets at ${new Date(event.resetsAt).toLocaleTimeString()}.`,
                  timestamp: Date.now(),
                },
              ]
            }
            break

          case 'compact_complete': {
            const freed = event.clearedTokens >= 1000
              ? `${Math.round(event.clearedTokens / 1000)}k`
              : String(event.clearedTokens)
            updated.currentActivity = 'Thinking...'
            updated.messages = [
              ...updated.messages,
              { id: nextMsgId(), role: 'system' as const, content: `Context compacted — ${freed} tokens freed`, timestamp: Date.now() },
            ]
            break
          }
        }

        return updated
      })

      return { tabs }
    })
  },

  handleStatusChange: (tabId, newStatus) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              status: newStatus as TabStatus,
              ...(newStatus === 'idle' ? { currentActivity: '', permissionQueue: [] as import('../../shared/types').PermissionRequest[], askUserQuestions: [] as AskUserQuestionPayload[], permissionDenied: null } : {}),
            }
          : t
      ),
    }))
  },

  handleError: (tabId, error) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t

        // Deduplicate: skip if the last message is already an error for this failure
        const lastMsg = t.messages[t.messages.length - 1]
        const alreadyHasError = lastMsg?.role === 'system' && lastMsg.content.startsWith('Error:')

        return {
          ...t,
          status: 'failed' as TabStatus,
          activeRequestId: null,
          currentActivity: '',
          permissionQueue: [],
          messages: alreadyHasError
            ? t.messages
            : [
                ...t.messages,
                {
                  id: nextMsgId(),
                  role: 'system' as const,
                  content: `Error: ${error.message}${error.stderrTail.length > 0 ? '\n\n' + error.stderrTail.slice(-5).join('\n') : ''}`,
                  timestamp: Date.now(),
                },
              ],
        }
      }),
    }))
  },

  handleRetryStatus: (tabId, status) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t
        if (status) {
          return { ...t, retryStatus: status, currentActivity: status.active ? `Reconnecting... (attempt ${status.attempt + 1}/${status.maxAttempts})` : t.currentActivity }
        }
        return { ...t, retryStatus: null }
      }),
    }))
  },
}))

export function useActiveTab() {
  return useSessionStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
}
