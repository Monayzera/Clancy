import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type { AskUserQuestionAnswer, RunOptions, NormalizedEvent, HealthReport, EnrichedError, Attachment, SessionMeta, CatalogPlugin, SessionLoadMessage, CodexQuota } from '../shared/types'

export interface CluiAPI {
  // ─── Request-response (renderer → main) ───
  start(): Promise<{ version: string; auth: { email?: string; subscriptionType?: string; authMethod?: string }; mcpServers: string[]; projectPath: string; homePath: string }>
  createTab(provider?: string): Promise<{ tabId: string }>
  prompt(tabId: string, requestId: string, options: RunOptions): Promise<void>
  cancel(requestId: string): Promise<boolean>
  stopTab(tabId: string): Promise<boolean>
  interruptAndSend(tabId: string, requestId: string, options: RunOptions): Promise<void>
  retry(tabId: string, requestId: string, options: RunOptions): Promise<void>
  status(): Promise<HealthReport>
  tabHealth(): Promise<HealthReport>
  closeTab(tabId: string): Promise<void>
  selectDirectory(): Promise<string | null>
  openExternal(url: string): Promise<boolean>
  openInTerminal(sessionId: string | null, projectPath?: string): Promise<boolean>
  attachFiles(): Promise<Attachment[] | null>
  takeScreenshot(): Promise<Attachment | null>
  pasteImage(dataUrl: string): Promise<Attachment | null>
  transcribeAudio(audioBase64: string): Promise<{ error: string | null; transcript: string | null }>
  getDiagnostics(): Promise<any>
  respondPermission(tabId: string, questionId: string, optionId: string): Promise<boolean>
  respondUserQuestion(payload: { tabId: string; questionId: string; selectedIds?: string[]; otherText?: string; answerText?: string; answers?: AskUserQuestionAnswer[]; cancelled?: boolean }): Promise<boolean>
  initSession(tabId: string, systemPrompt?: string): void
  resetTabSession(tabId: string): void
  listSessions(projectPath?: string, provider?: string): Promise<SessionMeta[]>
  loadSession(sessionId: string, projectPath?: string, projectDir?: string): Promise<SessionLoadMessage[]>
  resolveProjectDir(projectDir: string): Promise<string>
  resolveSessionDir(sessionId: string): Promise<string>
  codexQuota(): Promise<CodexQuota>
  fetchMarketplace(forceRefresh?: boolean): Promise<{ plugins: CatalogPlugin[]; error: string | null }>
  listInstalledPlugins(): Promise<string[]>
  installPlugin(repo: string, pluginName: string, marketplace: string, sourcePath?: string, isSkillMd?: boolean): Promise<{ ok: boolean; error?: string }>
  uninstallPlugin(pluginName: string): Promise<{ ok: boolean; error?: string }>
  mcpAdd(name: string, json: string, scope: string): Promise<{ ok: boolean; error?: string }>
  mcpRemove(name: string, scope: string): Promise<{ ok: boolean; error?: string }>
  setPermissionMode(mode: string): void
  getTheme(): Promise<{ isDark: boolean }>
  onThemeChange(callback: (isDark: boolean) => void): () => void

  // ─── Window management ───
  resizeHeight(height: number): void
  setWindowWidth(width: number): void
  animateHeight(from: number, to: number, durationMs: number): Promise<void>
  hideWindow(): void
  isVisible(): Promise<boolean>
  /** OS-level click-through for transparent window regions */
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void

  // ─── Event listeners (main → renderer) ───
  onEvent(callback: (tabId: string, event: NormalizedEvent) => void): () => void
  onTabStatusChange(callback: (tabId: string, newStatus: string, oldStatus: string) => void): () => void
  onError(callback: (tabId: string, error: EnrichedError) => void): () => void
  onSkillStatus(callback: (status: { name: string; state: string; error?: string; reason?: string }) => void): () => void
  onRetryStatus(callback: (tabId: string, status: { active: boolean; attempt: number; maxAttempts: number; reason: string; delayMs: number }) => void): () => void
  onCodexQuotaUpdate(callback: (quota: CodexQuota) => void): () => void
  onWindowShown(callback: () => void): () => void
  onWindowWillHide(callback: () => void): () => void
  notifyNative(payload: { title: string; body: string }): void
}

const api: CluiAPI = {
  // ─── Request-response ───
  start: () => ipcRenderer.invoke(IPC.START),
  createTab: (provider?: string) => ipcRenderer.invoke(IPC.CREATE_TAB, provider),
  prompt: (tabId, requestId, options) => ipcRenderer.invoke(IPC.PROMPT, { tabId, requestId, options }),
  cancel: (requestId) => ipcRenderer.invoke(IPC.CANCEL, requestId),
  stopTab: (tabId) => ipcRenderer.invoke(IPC.STOP_TAB, tabId),
  interruptAndSend: (tabId, requestId, options) => ipcRenderer.invoke(IPC.INTERRUPT_AND_SEND, { tabId, requestId, options }),
  retry: (tabId, requestId, options) => ipcRenderer.invoke(IPC.RETRY, { tabId, requestId, options }),
  status: () => ipcRenderer.invoke(IPC.STATUS),
  tabHealth: () => ipcRenderer.invoke(IPC.TAB_HEALTH),
  closeTab: (tabId) => ipcRenderer.invoke(IPC.CLOSE_TAB, tabId),
  selectDirectory: () => ipcRenderer.invoke(IPC.SELECT_DIRECTORY),
  openExternal: (url) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),
  openInTerminal: (sessionId, projectPath) => ipcRenderer.invoke(IPC.OPEN_IN_TERMINAL, { sessionId, projectPath }),
  attachFiles: () => ipcRenderer.invoke(IPC.ATTACH_FILES),
  takeScreenshot: () => ipcRenderer.invoke(IPC.TAKE_SCREENSHOT),
  pasteImage: (dataUrl) => ipcRenderer.invoke(IPC.PASTE_IMAGE, dataUrl),
  transcribeAudio: (audioBase64) => ipcRenderer.invoke(IPC.TRANSCRIBE_AUDIO, audioBase64),
  getDiagnostics: () => ipcRenderer.invoke(IPC.GET_DIAGNOSTICS),
  respondPermission: (tabId, questionId, optionId) =>
    ipcRenderer.invoke(IPC.RESPOND_PERMISSION, { tabId, questionId, optionId }),
  respondUserQuestion: (payload) =>
    ipcRenderer.invoke(IPC.RESPOND_USER_QUESTION, payload),
  initSession: (tabId, systemPrompt) => ipcRenderer.send(IPC.INIT_SESSION, tabId, systemPrompt),
  resetTabSession: (tabId) => ipcRenderer.send(IPC.RESET_TAB_SESSION, tabId),
  listSessions: (projectPath?: string, provider?: string) => ipcRenderer.invoke(IPC.LIST_SESSIONS, projectPath, provider),
  loadSession: (sessionId: string, projectPath?: string, projectDir?: string) => ipcRenderer.invoke(IPC.LOAD_SESSION, { sessionId, projectPath, projectDir }),
  resolveProjectDir: (projectDir: string) => ipcRenderer.invoke(IPC.RESOLVE_PROJECT_DIR, projectDir),
  resolveSessionDir: (sessionId: string) => ipcRenderer.invoke(IPC.RESOLVE_SESSION_DIR, sessionId),
  codexQuota: () => ipcRenderer.invoke(IPC.CODEX_QUOTA),
  fetchMarketplace: (forceRefresh) => ipcRenderer.invoke(IPC.MARKETPLACE_FETCH, { forceRefresh }),
  listInstalledPlugins: () => ipcRenderer.invoke(IPC.MARKETPLACE_INSTALLED),
  installPlugin: (repo, pluginName, marketplace, sourcePath, isSkillMd) =>
    ipcRenderer.invoke(IPC.MARKETPLACE_INSTALL, { repo, pluginName, marketplace, sourcePath, isSkillMd }),
  uninstallPlugin: (pluginName) =>
    ipcRenderer.invoke(IPC.MARKETPLACE_UNINSTALL, { pluginName }),
  mcpAdd: (name, json, scope) => ipcRenderer.invoke(IPC.MCP_ADD, { name, json, scope }),
  mcpRemove: (name, scope) => ipcRenderer.invoke(IPC.MCP_REMOVE, { name, scope }),
  setPermissionMode: (mode) => ipcRenderer.send(IPC.SET_PERMISSION_MODE, mode),
  getTheme: () => ipcRenderer.invoke(IPC.GET_THEME),
  onThemeChange: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, isDark: boolean) => callback(isDark)
    ipcRenderer.on(IPC.THEME_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC.THEME_CHANGED, handler)
  },

  // ─── Window management ───
  resizeHeight: (height) => ipcRenderer.send(IPC.RESIZE_HEIGHT, height),
  animateHeight: (from, to, durationMs) =>
    ipcRenderer.invoke(IPC.ANIMATE_HEIGHT, { from, to, durationMs }),
  hideWindow: () => ipcRenderer.send(IPC.HIDE_WINDOW),
  isVisible: () => ipcRenderer.invoke(IPC.IS_VISIBLE),
  setIgnoreMouseEvents: (ignore, options) =>
    ipcRenderer.send(IPC.SET_IGNORE_MOUSE_EVENTS, ignore, options || {}),
  setWindowWidth: (width) => ipcRenderer.send(IPC.SET_WINDOW_WIDTH, width),

  // ─── Event listeners ───
  onEvent: (callback) => {
    const channels = [
      IPC.TEXT_CHUNK, IPC.TOOL_CALL, IPC.TOOL_CALL_UPDATE,
      IPC.TOOL_CALL_COMPLETE, IPC.TASK_UPDATE, IPC.TASK_COMPLETE,
      IPC.SESSION_DEAD, IPC.SESSION_INIT, IPC.ERROR, IPC.RATE_LIMIT,
    ]
    // Single unified handler — all normalized events come through one channel
    const handler = (_e: Electron.IpcRendererEvent, tabId: string, event: NormalizedEvent) => callback(tabId, event)
    ipcRenderer.on('clui:normalized-event', handler)
    return () => ipcRenderer.removeListener('clui:normalized-event', handler)
  },

  onTabStatusChange: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, tabId: string, newStatus: string, oldStatus: string) =>
      callback(tabId, newStatus, oldStatus)
    ipcRenderer.on('clui:tab-status-change', handler)
    return () => ipcRenderer.removeListener('clui:tab-status-change', handler)
  },

  onError: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, tabId: string, error: EnrichedError) =>
      callback(tabId, error)
    ipcRenderer.on('clui:enriched-error', handler)
    return () => ipcRenderer.removeListener('clui:enriched-error', handler)
  },

  onSkillStatus: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, status: any) => callback(status)
    ipcRenderer.on(IPC.SKILL_STATUS, handler)
    return () => ipcRenderer.removeListener(IPC.SKILL_STATUS, handler)
  },

  onRetryStatus: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, tabId: string, status: { active: boolean; attempt: number; maxAttempts: number; reason: string; delayMs: number }) => callback(tabId, status)
    ipcRenderer.on('clui:retry-status', handler)
    return () => ipcRenderer.removeListener('clui:retry-status', handler)
  },

  onCodexQuotaUpdate: (callback: (quota: CodexQuota) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, quota: CodexQuota) => callback(quota)
    ipcRenderer.on('clui:codex-quota-update', handler)
    return () => ipcRenderer.removeListener('clui:codex-quota-update', handler)
  },

  onWindowShown: (callback) => {
    const handler = () => callback()
    ipcRenderer.on(IPC.WINDOW_SHOWN, handler)
    return () => ipcRenderer.removeListener(IPC.WINDOW_SHOWN, handler)
  },

  onWindowWillHide: (callback) => {
    const handler = () => callback()
    ipcRenderer.on(IPC.WINDOW_WILL_HIDE, handler)
    return () => ipcRenderer.removeListener(IPC.WINDOW_WILL_HIDE, handler)
  },

  notifyNative: (payload) => ipcRenderer.send(IPC.NOTIFY_NATIVE, payload),
}

contextBridge.exposeInMainWorld('clui', api)
