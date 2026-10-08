import type {
  ClaudeEvent,
  NormalizedEvent,
  StreamEvent,
  InitEvent,
  AssistantEvent,
  ResultEvent,
  RateLimitEvent,
  PermissionEvent,
  ContentDelta,
} from '../../shared/types'
import { hasUsageData, normalizeUsageData } from '../../shared/usage'
import { normalizeAskUserQuestionToolInput } from '../native-harness/ask-user-question'
import { getNativeToolNames } from '../native-harness/tool-registry'

export interface NormalizerState {
  blockToolIds: Map<number, string>
}

export function createNormalizerState(): NormalizerState {
  return { blockToolIds: new Map() }
}

export function normalize(raw: ClaudeEvent, state?: NormalizerState): NormalizedEvent[] {
  switch (raw.type) {
    case 'system':
      return normalizeSystem(raw as InitEvent)

    case 'stream_event':
      return normalizeStreamEvent(raw as StreamEvent, state)

    case 'assistant':
      return normalizeAssistant(raw as AssistantEvent)

    case 'user':
      return normalizeUser(raw as any)

    case 'result':
      return normalizeResult(raw as ResultEvent)

    case 'rate_limit_event':
      return normalizeRateLimit(raw as RateLimitEvent)

    case 'permission_request':
      return normalizePermission(raw as PermissionEvent)

    default:
      return []
  }
}

function normalizeUser(event: any): NormalizedEvent[] {
  const content = event?.message?.content
  if (!Array.isArray(content)) return []
  const out: NormalizedEvent[] = []
  for (const block of content) {
    if (!block || block.type !== 'tool_result') continue
    const toolUseId = block.tool_use_id || ''
    if (!toolUseId) continue
    out.push({
      type: 'tool_result',
      toolUseId,
      content: stringifyToolResultContent(block.content),
      isError: block.is_error === true,
    })
  }
  return out
}

function stringifyToolResultContent(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b: any) => {
        if (typeof b === 'string') return b
        if (b?.type === 'text' && typeof b.text === 'string') return b.text
        if (b?.type === 'image') return '[image]'
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content === null || content === undefined) return ''
  try { return JSON.stringify(content) } catch { return String(content) }
}

function normalizeSystem(event: InitEvent): NormalizedEvent[] {
  if (event.subtype !== 'init') return []

  return [{
    type: 'session_init',
    sessionId: event.session_id,
    tools: [...new Set([...(event.tools || []), ...getNativeToolNames()])],
    model: event.model || 'unknown',
    mcpServers: event.mcp_servers || [],
    skills: event.skills || [],
    version: event.claude_code_version || 'unknown',
  }]
}

function normalizeStreamEvent(event: StreamEvent, state?: NormalizerState): NormalizedEvent[] {
  const sub = event.event
  if (!sub) return []

  switch (sub.type) {
    case 'content_block_start': {
      if (sub.content_block.type === 'tool_use') {
        const toolCall: NormalizedEvent = {
          type: 'tool_call',
          toolName: sub.content_block.name || 'unknown',
          toolId: sub.content_block.id || '',
          index: sub.index,
        }
        if (state && sub.content_block.id) state.blockToolIds.set(sub.index, sub.content_block.id)
        if (isAskUserQuestionTool(sub.content_block)) {
          const event = normalizeAskUserQuestionToolInput(sub.content_block.input, sub.content_block.id || '')
          return event ? [toolCall, event] : [toolCall]
        }
        return [toolCall]
      }
      // text block start — no event needed, text comes via deltas
      return []
    }

    case 'content_block_delta': {
      const delta = sub.delta as ContentDelta
      if (delta.type === 'text_delta') {
        return [{ type: 'text_chunk', text: delta.text }]
      }
      if (delta.type === 'input_json_delta') {
        return [{
          type: 'tool_call_update',
          toolId: state?.blockToolIds.get(sub.index) || '',
          partialInput: delta.partial_json,
          index: sub.index,
        }]
      }
      if (delta.type === 'thinking_delta') {
        return [{ type: 'thinking_chunk', thinking: delta.thinking }]
      }
      return []
    }

    case 'content_block_stop': {
      return [{
        type: 'tool_call_complete',
        index: sub.index,
        toolId: state?.blockToolIds.get(sub.index),
      }]
    }

    case 'message_start':
      if (state) state.blockToolIds.clear()
      return []

    case 'message_stop':
      return []

    case 'message_delta': {
      const md = sub as { type: 'message_delta'; delta: { stop_reason: string | null }; usage?: Record<string, unknown>; context_management?: { applied_edits?: Array<{ cleared_input_tokens?: number }> } }
      if (md.context_management?.applied_edits && md.context_management.applied_edits.length > 0) {
        const cleared = md.context_management.applied_edits.reduce((sum, e) => sum + (e.cleared_input_tokens || 0), 0)
        if (cleared > 0) {
          return [{ type: 'compact_complete', clearedTokens: cleared }]
        }
      }
      return []
    }

    default:
      return []
  }
}

function normalizeAssistant(event: AssistantEvent): NormalizedEvent[] {
  return [{
    type: 'task_update',
    message: event.message,
  }]
}

function normalizeResult(event: ResultEvent): NormalizedEvent[] {
  if (event.is_error || event.subtype === 'error') {
    return [{
      type: 'error',
      message: event.result || 'Unknown error',
      isError: true,
      sessionId: event.session_id,
    }]
  }

  const denials = Array.isArray((event as any).permission_denials)
    ? (event as any).permission_denials.map((d: any) => ({
        toolName: d.tool_name || '',
        toolUseId: d.tool_use_id || '',
      }))
    : undefined

  return [{
    type: 'task_complete',
    result: event.result || '',
    costUsd: event.total_cost_usd || 0,
    durationMs: event.duration_ms || 0,
    numTurns: event.num_turns || 0,
    usage: normalizeUsageData(event.usage),
    sessionId: event.session_id,
    ...(denials && denials.length > 0 ? { permissionDenials: denials } : {}),
  }]
}

function normalizeRateLimit(event: RateLimitEvent): NormalizedEvent[] {
  const info = event.rate_limit_info
  if (!info) return []

  return [{
    type: 'rate_limit',
    status: info.status,
    resetsAt: info.resetsAt,
    rateLimitType: info.rateLimitType,
  }]
}

function normalizePermission(event: PermissionEvent): NormalizedEvent[] {
  return [{
    type: 'permission_request',
    questionId: event.question_id,
    toolName: event.tool?.name || 'unknown',
    toolDescription: event.tool?.description,
    toolInput: event.tool?.input,
    options: (event.options || []).map((o) => ({
      id: o.id,
      label: o.label,
      kind: o.kind,
    })),
  }]
}

function getCodexToolName(item: any): string {
  return item.tool || item.name || item.tool_name || item.function?.name || 'unknown'
}

function isAskUserQuestionTool(item: any): boolean {
  const name = getCodexToolName(item).split(':').pop() || ''
  return name.replace(/[_-]/g, '').toLowerCase() === 'askuserquestion'
}

function parseJsonLike(value: any): any {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function normalizeAskUserQuestionOptions(raw: any): Array<{ id: string; label: string; description?: string }> {
  if (!Array.isArray(raw)) return []
  const seen = new Map<string, number>()
  const makeId = (value: unknown) => {
    const baseId = String(value)
    const count = seen.get(baseId) || 0
    seen.set(baseId, count + 1)
    return count === 0 ? baseId : `${baseId}-${count}`
  }
  return raw
    .map((option, index) => {
      if (typeof option === 'string') {
        const label = option.trim()
        return label ? { id: makeId(`opt-${index}`), label } : null
      }
      if (!option || typeof option !== 'object') return null
      const idValue = option.id ?? option.value ?? `opt-${index}`
      const labelValue = option.label ?? option.text ?? option.title ?? option.value ?? idValue
      const label = String(labelValue).trim()
      if (!label) return null
      const description = typeof option.description === 'string' ? option.description : undefined
      return { id: makeId(idValue), label, description }
    })
    .filter((option): option is { id: string; label: string; description?: string } => !!option)
}

function normalizeAskUserQuestionPayload(input: any, toolId: string): NormalizedEvent[] {
  const parsed = parseJsonLike(input)
  if (!parsed) return []
  const rawQuestions = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.questions)
      ? parsed.questions
      : [parsed]

  return rawQuestions.flatMap((question: any, index: number) => {
    if (!question || typeof question !== 'object') return []
    const questionText = question.question ?? question.prompt ?? question.text ?? question.message
    if (typeof questionText !== 'string' || !questionText.trim()) return []
    const header = typeof question.header === 'string'
      ? question.header
      : typeof question.title === 'string'
        ? question.title
        : undefined
    const allowOtherText = typeof question.allowOtherText === 'boolean'
      ? question.allowOtherText
      : typeof question.allow_other_text === 'boolean'
        ? question.allow_other_text
        : typeof question.allowCustom === 'boolean'
          ? question.allowCustom
          : true
    return [{
      type: 'ask_user_question',
      questionId: `${toolId || 'codex-question'}-${index}`,
      question: questionText.trim(),
      header,
      options: normalizeAskUserQuestionOptions(question.options),
      multiSelect: !!(question.multiSelect ?? question.multi_select ?? question.multiple ?? question.multipleSelect),
      allowOtherText,
    }]
  })
}

export function normalizeCodex(raw: any): NormalizedEvent[] {
  const evt = raw?.type === 'event_msg' && raw?.payload
    ? raw.payload
    : raw

  if (!evt || !evt.type) return []

  switch (evt.type) {
    case 'thread.started':
      return [{
        type: 'session_init',
        sessionId: evt.thread_id || '',
        tools: [],
        model: 'codex',
        mcpServers: [],
        skills: [],
        version: 'codex',
      }]

    case 'turn.started':
      return []

    case 'turn.completed': {
      const usage = normalizeUsageData(evt.usage || evt.token_usage || evt.info?.last_token_usage)
      return [{
        type: 'task_complete',
        result: '',
        costUsd: 0,
        durationMs: 0,
        numTurns: 1,
        usage,
        sessionId: evt.thread_id || '',
      }]
    }

    case 'task_complete':
      return [{
        type: 'task_complete',
        result: evt.last_agent_message || evt.result || '',
        costUsd: evt.total_cost_usd || 0,
        durationMs: evt.duration_ms || 0,
        numTurns: evt.num_turns || 1,
        usage: normalizeUsageData(evt.usage || evt.token_usage || evt.info?.last_token_usage),
        sessionId: evt.thread_id || evt.session_id || '',
      }]

    case 'turn.failed':
      return [{
        type: 'error',
        message: evt.error?.message || 'Codex turn failed',
        isError: true,
        sessionId: evt.thread_id || '',
      }]

    case 'error': {
      if (evt.message && evt.message.startsWith('Reconnecting')) return []
      return [{
        type: 'error',
        message: evt.message || 'Unknown Codex error',
        isError: true,
      }]
    }

    case 'token_count': {
      const events: NormalizedEvent[] = []
      if (evt.rate_limits) {
        events.push({
          type: 'codex_rate_limits',
          rateLimits: evt.rate_limits,
        })
      }
      const usage = normalizeUsageData(evt.info?.last_token_usage)
      if (hasUsageData(usage)) {
        events.push({
          type: 'usage',
          usage,
        })
      }
      if (events.length > 0) {
        return events
      }
      return []
    }

    case 'turn_aborted':
      return [{
        type: 'error',
        message: evt.reason || 'Codex turn aborted',
        isError: true,
        sessionId: evt.thread_id || '',
      }]

    case 'message':
    case 'user_message': {
      const text = typeof evt.content === 'string'
        ? evt.content
        : Array.isArray(evt.content)
          ? evt.content
              .filter((block: any) => block?.type === 'output_text' || block?.type === 'text')
              .map((block: any) => block.text || block.content || '')
              .join('')
          : ''
      if (evt.role === 'assistant' && text) {
        return [{
          type: 'text_chunk',
          text,
          streamId: evt.id || evt.message_id,
          appendMode: 'block',
        }]
      }
      return []
    }

    case 'item.started': {
      const item = evt.item
      if (!item) return []
      return normalizeCodexItemStarted(item)
    }

    case 'item.updated': {
      const item = evt.item
      if (!item) return []
      return normalizeCodexItemUpdated(item)
    }

    case 'item.completed': {
      const item = evt.item
      if (!item) return []
      return normalizeCodexItemCompleted(item)
    }

    default:
      return []
  }
}

function isApplyPatch(command: string): boolean {
  return /apply_patch\s/.test(command) || command.trimStart().startsWith('apply_patch')
}

function isCatWrite(command: string): boolean {
  return /cat\s*>{1,2}\s*\S/.test(command)
}

function parseCatWrite(command: string): { filePath: string; content: string } | null {
  const catMatch = command.match(/cat\s*>{1,2}\s*(\S+)\s*<<-?\s*'?([A-Za-z_][A-Za-z0-9_]*)'?/)
  if (!catMatch) return null
  const filePath = catMatch[1].replace(/^["']|["']$/g, '')
  const marker = catMatch[2]
  const matchEnd = catMatch.index! + catMatch[0].length
  const contentStart = command.indexOf('\n', matchEnd)
  if (contentStart === -1) return null
  const rest = command.substring(contentStart + 1)
  const endPattern = new RegExp(`^${marker}$`, 'm')
  const endMatch = rest.match(endPattern)
  if (!endMatch || endMatch.index === undefined) return null
  const content = rest.substring(0, endMatch.index).replace(/\n$/, '')
  if (!content) return null
  return { filePath, content }
}

function isFileWrite(command: string): boolean {
  return isApplyPatch(command) || isCatWrite(command)
}

function parseApplyPatch(command: string): { filePath: string; oldStr: string; newStr: string } | null {
  const patchStart = command.indexOf('*** Begin Patch')
  const patchEnd = command.indexOf('*** End Patch')
  if (patchStart === -1 || patchEnd === -1) return null
  const patchBody = command.substring(patchStart, patchEnd)
  const lines = patchBody.split('\n')
  let filePath = ''
  const oldLines: string[] = []
  const newLines: string[] = []
  let inHunk = false

  for (const line of lines) {
    if (line.startsWith('--- a/') || line.startsWith('--- ')) {
      filePath = line.replace(/^---\s+a\//, '').replace(/^---\s+/, '').trim()
    } else if (line.startsWith('+++ ')) {
      if (!filePath) filePath = line.replace(/^[+]+\s+b\//, '').replace(/^[+]+\s+/, '').trim()
    } else if (line.startsWith('@@')) {
      inHunk = true
    } else if (inHunk) {
      if (line.startsWith('-')) {
        oldLines.push(line.substring(1))
      } else if (line.startsWith('+')) {
        newLines.push(line.substring(1))
      } else if (line.startsWith(' ')) {
        oldLines.push(line.substring(1))
        newLines.push(line.substring(1))
      }
    }
  }
  if (oldLines.length === 0 && newLines.length === 0) return null
  return { filePath, oldStr: oldLines.join('\n'), newStr: newLines.join('\n') }
}

function normalizeCodexItemStarted(item: any): NormalizedEvent[] {
  switch (item.type) {
    case 'command_execution': {
      const cmd = item.command || ''
      if (isApplyPatch(cmd)) {
        return [{ type: 'tool_call', toolName: 'Edit', toolId: item.id || '', index: 0 }]
      }
      if (isCatWrite(cmd)) {
        return [{ type: 'tool_call', toolName: 'Write', toolId: item.id || '', index: 0 }]
      }
      return [{ type: 'tool_call', toolName: 'Bash', toolId: item.id || '', index: 0 }]
    }

    case 'file_change': {
      const changes = Array.isArray(item.changes) ? item.changes : []
      const first = changes[0]
      if (!first) return []
      const isCreate = first.kind === 'create'
      return [{ type: 'tool_call', toolName: isCreate ? 'Write' : 'Edit', toolId: item.id || '', index: 0 }]
    }

    case 'mcp_tool_call':
      if (isAskUserQuestionTool(item)) {
        const event = normalizeAskUserQuestionToolInput(item.arguments ?? item.input ?? item.params, item.id || '')
        return event ? [event] : []
      }
      return [{ type: 'tool_call', toolName: `${item.server || 'mcp'}:${getCodexToolName(item)}`, toolId: item.id || '', index: 0 }]

    case 'web_search':
      return [{ type: 'tool_call', toolName: 'WebSearch', toolId: item.id || '', index: 0 }]

    default:
      return []
  }
}

function normalizeCodexItemUpdated(item: any): NormalizedEvent[] {
  switch (item.type) {
    case 'command_execution': {
      const cmd = item.command || ''
      if (isFileWrite(cmd)) return []
      if (item.aggregated_output) {
        return [{ type: 'tool_call_update', toolId: item.id || '', partialInput: item.aggregated_output, updateMode: 'replace' }]
      }
      return []
    }

    case 'agent_message': {
      if (item.text) {
        return [{ type: 'text_chunk', text: item.text, streamId: item.id || item.message_id, appendMode: 'block' }]
      }
      return []
    }

    default:
      return []
  }
}

function normalizeCodexItemCompleted(item: any): NormalizedEvent[] {
  switch (item.type) {
    case 'agent_message':
      if (item.text) {
        return [{ type: 'text_chunk', text: item.text, streamId: item.id || item.message_id, appendMode: 'block' }]
      }
      return []

    case 'reasoning':
      if (item.text) {
        return [{ type: 'thinking_chunk', thinking: item.text, streamId: item.id || item.message_id, insertBeforeAssistant: true }]
      }
      return []

    case 'command_execution': {
      const events: NormalizedEvent[] = []
      const input = item.command || ''
      if (isApplyPatch(input)) {
        const parsed = parseApplyPatch(input)
        if (parsed) {
          const json = JSON.stringify({ file_path: parsed.filePath, old_string: parsed.oldStr, new_string: parsed.newStr })
          events.push({ type: 'tool_call_update', toolId: item.id || '', partialInput: json })
        }
      } else if (isCatWrite(input)) {
        const parsed = parseCatWrite(input)
        if (parsed) {
          const json = JSON.stringify({ file_path: parsed.filePath, content: parsed.content })
          events.push({ type: 'tool_call_update', toolId: item.id || '', partialInput: json })
        }
      } else if (input) {
        events.push({ type: 'tool_call_update', toolId: item.id || '', partialInput: input, updateMode: 'replace' })
      }
      if (item.aggregated_output) {
        events.push({ type: 'tool_result', toolUseId: item.id || '', content: String(item.aggregated_output), isError: typeof item.exit_code === 'number' ? item.exit_code !== 0 : false })
      }
      events.push({ type: 'tool_call_complete', index: 0, toolId: item.id || '' })
      return events
    }

    case 'file_change': {
      const events: NormalizedEvent[] = []
      const changes = Array.isArray(item.changes) ? item.changes : []
      const first = changes[0]
      if (first && first.path) {
        const isCreate = first.kind === 'create'
        const json = isCreate
          ? JSON.stringify({ file_path: first.path, content: '' })
          : JSON.stringify({ file_path: first.path, old_string: '', new_string: '' })
        events.push({ type: 'tool_call_update', toolId: item.id || '', partialInput: json })
      }
      events.push({ type: 'tool_call_complete', index: 0, toolId: item.id || '' })
      return events
    }

    case 'mcp_tool_call': {
      if (isAskUserQuestionTool(item)) {
        const event = normalizeAskUserQuestionToolInput(item.arguments ?? item.input ?? item.params, item.id || '')
        return event ? [event] : []
      }
      const events: NormalizedEvent[] = []
      if (item.arguments) {
        events.push({
          type: 'tool_call_update',
          toolId: item.id || '',
          partialInput: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments, null, 2),
        })
      }
      events.push({ type: 'tool_call_complete', index: 0, toolId: item.id || '' })
      return events
    }

    case 'web_search': {
      const events: NormalizedEvent[] = []
      if (item.query) {
        events.push({ type: 'tool_call_update', toolId: item.id || '', partialInput: item.query })
      }
      events.push({ type: 'tool_call_complete', index: 0, toolId: item.id || '' })
      return events
    }

    case 'todo_list': {
      const entries = Array.isArray(item.items) ? item.items : []
      const text = entries.map((e: any) => `${e.completed ? '[x]' : '[ ]'} ${e.text || ''}`).join('\n')
      if (text) {
        return [{ type: 'text_chunk', text: '\n' + text + '\n' }]
      }
      return []
    }

    case 'error':
      return [{
        type: 'error',
        message: item.message || 'Codex item error',
        isError: true,
      }]

    default:
      return []
  }
}
