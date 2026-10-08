import type { AskUserQuestionAnswer, AskUserQuestionItem, NormalizedEvent } from '../../shared/types'

type RawRecord = Record<string, unknown>

export interface AskUserQuestionResolvePayload {
  tabId: string
  questionId: string
  requestId?: string
  selectedIds?: string[]
  otherText?: string
  answerText?: string
  answers?: AskUserQuestionAnswer[]
  cancelled?: boolean
}

export interface ResolvedAskUserQuestion {
  toolUseId?: string
  content: string
  answers: Record<string, string>
  annotations?: Record<string, { preview?: string; notes?: string }>
}

interface PendingAskUserQuestion {
  tabId: string
  requestId?: string
  groupId: string
  toolUseId?: string
  questions: AskUserQuestionItem[]
  validationError?: string
}

const OTHER_OPTION_IDS = new Set(['__other__', '__custom__'])

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RawRecord : null
}

function parseJsonLike(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function boolValue(source: RawRecord, keys: string[], fallback: boolean): boolean {
  for (const key of keys) {
    if (typeof source[key] === 'boolean') return source[key]
  }
  return fallback
}

function makeStableId(base: string, seen: Map<string, number>): string {
  const safeBase = base.trim() || 'option'
  const count = seen.get(safeBase) || 0
  seen.set(safeBase, count + 1)
  return count === 0 ? safeBase : `${safeBase}-${count}`
}

function validateHtmlPreview(preview: string | undefined, previewFormat: string): string | null {
  if (previewFormat !== 'html') return null
  if (preview === undefined) return null
  if (/<\s*(html|body|!doctype)\b/i.test(preview)) {
    return 'preview must be an HTML fragment'
  }
  if (/<\s*(script|style)\b/i.test(preview)) {
    return 'preview must not contain script or style tags'
  }
  if (!/<[a-z][^>]*>/i.test(preview)) {
    return 'preview must contain HTML'
  }
  return null
}

function normalizeOptions(raw: unknown, previewFormat: string): { options: AskUserQuestionItem['options']; error?: string } {
  if (!Array.isArray(raw)) return { options: [], error: 'questions must have 2-4 options' }
  const seenIds = new Map<string, number>()
  const seenLabels = new Set<string>()
  const options: AskUserQuestionItem['options'] = []
  let error = ''

  for (let index = 0; index < raw.length; index++) {
    const option = raw[index]
    if (typeof option === 'string') {
      const label = option.trim()
      if (!label) continue
      if (seenLabels.has(label)) error ||= 'option labels must be unique'
      seenLabels.add(label)
      options.push({ id: makeStableId(`opt-${index}`, seenIds), label })
      continue
    }

    const record = asRecord(option)
    if (!record) continue
    const idValue = record.id ?? record.value ?? `opt-${index}`
    const label = textValue(record.label ?? record.text ?? record.title ?? record.value ?? idValue)
    if (!label) continue
    if (seenLabels.has(label)) error ||= 'option labels must be unique'
    seenLabels.add(label)
    const preview = textValue(record.preview) || undefined
    const previewError = validateHtmlPreview(preview, previewFormat)
    if (previewError) error ||= `option "${label}" ${previewError}`
    options.push({
      id: makeStableId(String(idValue), seenIds),
      label,
      description: textValue(record.description) || undefined,
      preview,
    })
  }

  if (options.length > 4) {
    error ||= 'questions can have at most 4 options'
    return { options: options.slice(0, 4), error }
  }
  if (options.length < 2) {
    error ||= 'questions must have at least 2 options'
  }

  return { options, error: error || undefined }
}

export function normalizeAskUserQuestionToolInput(input: unknown, toolUseId?: string): NormalizedEvent | null {
  const parsed = parseJsonLike(input)
  const source = asRecord(parsed)
  const rawQuestions = Array.isArray(parsed)
    ? parsed
    : Array.isArray(source?.questions)
      ? source.questions
      : source
        ? [source]
        : []

  const questions: AskUserQuestionItem[] = []
  const seenQuestionTexts = new Set<string>()
  let validationError = ''

  if (rawQuestions.length > 4) {
    validationError ||= 'AskUserQuestion supports at most 4 questions'
  }

  for (let index = 0; index < rawQuestions.length && index < 4; index++) {
    const rawQuestion = asRecord(rawQuestions[index])
    if (!rawQuestion) continue
    const questionText = textValue(rawQuestion.question ?? rawQuestion.prompt ?? rawQuestion.text ?? rawQuestion.message)
    if (!questionText) continue
    if (seenQuestionTexts.has(questionText)) validationError ||= 'question texts must be unique'
    seenQuestionTexts.add(questionText)
    const previewFormat = textValue(rawQuestion.previewFormat ?? source?.previewFormat)
    const normalizedOptions = normalizeOptions(rawQuestion.options, previewFormat)
    if (normalizedOptions.error) validationError ||= normalizedOptions.error
    questions.push({
      id: `${toolUseId || 'ask-user-question'}-${index}`,
      question: questionText,
      header: textValue(rawQuestion.header ?? rawQuestion.title) || undefined,
      options: normalizedOptions.options,
      multiSelect: boolValue(rawQuestion, ['multiSelect', 'multi_select', 'multiple', 'multipleSelect'], false),
      allowOtherText: true,
    })
  }

  if (questions.length === 0) return null

  const first = questions[0]
  return {
    type: 'ask_user_question',
    questionId: toolUseId || first.id,
    toolUseId,
    question: first.question,
    header: first.header,
    options: first.options,
    multiSelect: first.multiSelect,
    allowOtherText: first.allowOtherText,
    questions,
    validationError: validationError || undefined,
  }
}

function sanitizeAnswerText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function answerTextFromPayload(question: AskUserQuestionItem, answer: AskUserQuestionAnswer): string {
  const selected = answer.selectedIds.flatMap((id) => {
    if (OTHER_OPTION_IDS.has(id)) return []
    const option = question.options.find((o) => o.id === id)
    return option ? [option.label] : []
  })
  const other = sanitizeAnswerText(answer.otherText || '')
  const usesOther = answer.selectedIds.some((id) => OTHER_OPTION_IDS.has(id))
  const merged = [...selected, ...(usesOther && other ? [other] : [])].join(', ')
  return sanitizeAnswerText(merged)
}

function normalizeAnswer(question: AskUserQuestionItem, rawAnswer: AskUserQuestionAnswer): AskUserQuestionAnswer {
  const validOptionIds = new Set(question.options.map((option) => option.id))
  const selectedIds = (Array.isArray(rawAnswer.selectedIds) ? rawAnswer.selectedIds : [])
    .filter((id) => typeof id === 'string' && (validOptionIds.has(id) || OTHER_OPTION_IDS.has(id)))
  const selectedLabels = selectedIds.flatMap((id) => {
    if (OTHER_OPTION_IDS.has(id)) return []
    const option = question.options.find((candidate) => candidate.id === id)
    return option ? [option.label] : []
  })
  const otherText = sanitizeAnswerText(rawAnswer.otherText || '')
  const effectiveIds = selectedIds.length > 0
    ? selectedIds
    : otherText
      ? ['__other__']
      : []
  const selectedText = selectedLabels.length > 0 ? selectedLabels.join(', ') : otherText
  return {
    questionId: question.id,
    question: question.question,
    selectedIds: question.multiSelect ? effectiveIds : effectiveIds.slice(0, 1),
    selectedLabels,
    otherText: otherText || undefined,
    answerText: selectedText,
  }
}

function annotationForAnswer(question: AskUserQuestionItem, answer: AskUserQuestionAnswer): { preview?: string; notes?: string } | null {
  const selectedOption = answer.selectedIds
    .filter((id) => !OTHER_OPTION_IDS.has(id))
    .map((id) => question.options.find((option) => option.id === id))
    .find((option) => option?.preview)
  const hasNormalSelection = answer.selectedIds.some((id) => !OTHER_OPTION_IDS.has(id))
  const notes = hasNormalSelection ? sanitizeAnswerText(answer.otherText || '') : ''
  if (!selectedOption?.preview && !notes) return null
  return {
    ...(selectedOption?.preview ? { preview: selectedOption.preview } : {}),
    ...(notes ? { notes } : {}),
  }
}

function escapeResultValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function formatAskUserQuestionResult(questions: AskUserQuestionItem[], answers: AskUserQuestionAnswer[]): ResolvedAskUserQuestion {
  const byQuestionId = new Map(answers.map((answer) => [answer.questionId, answer]))
  const mapped: Record<string, string> = {}
  const annotations: Record<string, { preview?: string; notes?: string }> = {}
  const parts: string[] = []

  for (const question of questions) {
    const rawAnswer = byQuestionId.get(question.id)
    if (!rawAnswer) {
      throw new Error(`Missing answer for "${question.question}"`)
    }
    const answer = normalizeAnswer(question, rawAnswer)
    const answerText = answerTextFromPayload(question, answer)
    if (!answerText) {
      throw new Error(`Empty answer for "${question.question}"`)
    }
    mapped[question.question] = answerText
    const annotation = annotationForAnswer(question, answer)
    if (annotation) annotations[question.question] = annotation
    const part = [`"${escapeResultValue(question.question)}"="${escapeResultValue(answerText)}"`]
    if (annotation?.preview) part.push(`selected preview:\n${annotation.preview}`)
    if (annotation?.notes) part.push(`user notes: ${annotation.notes}`)
    parts.push(part.join(' '))
  }

  return {
    content: `User has answered your questions: ${parts.join(', ')}. You can now continue with the user's answers in mind.`,
    answers: mapped,
    ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
  }
}

export class NativeAskUserQuestionHarness {
  private pending = new Map<string, PendingAskUserQuestion>()

  register(tabId: string, requestId: string | undefined, event: Extract<NormalizedEvent, { type: 'ask_user_question' }>): void {
    const questions = event.questions && event.questions.length > 0
      ? event.questions
      : [{
          id: event.questionId,
          question: event.question,
          header: event.header,
          options: event.options,
          multiSelect: event.multiSelect,
          allowOtherText: event.allowOtherText ?? true,
        }]
    this.pending.set(this.key(tabId, event.questionId), {
      tabId,
      requestId,
      groupId: event.questionId,
      toolUseId: event.toolUseId,
      questions,
      validationError: event.validationError,
    })
  }

  resolve(payload: AskUserQuestionResolvePayload): ResolvedAskUserQuestion | null {
    const pending = this.pending.get(this.key(payload.tabId, payload.questionId))
    if (!pending) return null
    if (pending.requestId && payload.requestId !== pending.requestId) return null
    if (payload.cancelled) {
      return {
        toolUseId: pending.toolUseId,
        content: 'User declined to answer questions.',
        answers: {},
      }
    }
    if (pending.validationError) throw new Error(pending.validationError)
    const answers = payload.answers && payload.answers.length > 0
      ? payload.answers
      : this.legacyAnswers(pending.questions, payload)
    const result = formatAskUserQuestionResult(pending.questions, answers)
    return { ...result, toolUseId: pending.toolUseId }
  }

  complete(tabId: string, questionId: string): void {
    this.pending.delete(this.key(tabId, questionId))
  }

  clearTab(tabId: string): void {
    for (const [key, pending] of this.pending) {
      if (pending.tabId === tabId) this.pending.delete(key)
    }
  }

  clearRequest(requestId: string): void {
    for (const [key, pending] of this.pending) {
      if (pending.requestId === requestId) this.pending.delete(key)
    }
  }

  private legacyAnswers(questions: AskUserQuestionItem[], payload: AskUserQuestionResolvePayload): AskUserQuestionAnswer[] {
    const first = questions[0]
    if (!first) return []
    const selectedIds = payload.selectedIds || []
    const selectedLabels = selectedIds.flatMap((id) => {
      if (OTHER_OPTION_IDS.has(id)) return []
      const option = first.options.find((o) => o.id === id)
      return option ? [option.label] : []
    })
    return [{
      questionId: first.id,
      question: first.question,
      selectedIds,
      selectedLabels,
      otherText: payload.otherText,
      answerText: payload.answerText || [...selectedLabels, payload.otherText || ''].filter(Boolean).join(', '),
    }]
  }

  private key(tabId: string, questionId: string): string {
    return `${tabId}:${questionId}`
  }
}
