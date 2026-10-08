import React, { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowUpRight, CaretLeft, CaretRight, Check, PencilSimple, Question, WarningCircle, X } from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { useColors } from '../theme'
import type { AskUserQuestionAnswer, AskUserQuestionItem, AskUserQuestionPayload } from '../../shared/types'

interface Props {
  tabId: string
  question: AskUserQuestionPayload
  queueLength?: number
}

type DraftAnswer = {
  selectedIds: string[]
  otherText: string
}

const OTHER_ID = '__other__'
const CUSTOM_ID = '__custom__'

function normalizeQuestions(payload: AskUserQuestionPayload): AskUserQuestionItem[] {
  if (payload.questions && payload.questions.length > 0) return payload.questions
  return [{
    id: payload.questionId,
    question: payload.question,
    header: payload.header,
    options: payload.options,
    multiSelect: payload.multiSelect,
    allowOtherText: payload.allowOtherText,
  }]
}

function getDraft(drafts: Record<string, DraftAnswer>, id: string): DraftAnswer {
  return drafts[id] || { selectedIds: [], otherText: '' }
}

function isOtherId(id: string): boolean {
  return id === OTHER_ID || id === CUSTOM_ID
}

export function AskUserQuestionCard({ tabId, question, queueLength = 1 }: Props) {
  const respondUserQuestion = useSessionStore((s) => s.respondUserQuestion)
  const colors = useColors()
  const questions = normalizeQuestions(question)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, DraftAnswer>>({})
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null)

  const current = questions[Math.min(currentIndex, questions.length - 1)]
  const draft = current ? getDraft(drafts, current.id) : { selectedIds: [], otherText: '' }
  const isLast = currentIndex >= questions.length - 1
  const hasValidationError = !!question.validationError

  useEffect(() => {
    setCurrentIndex(0)
    setDrafts({})
    setSending(false)
    setError('')
    setActivePreviewId(null)
  }, [question.questionId])

  const selectedLabelsFor = useCallback((item: AskUserQuestionItem, answer: DraftAnswer): string[] => {
    return answer.selectedIds.flatMap((id) => {
      if (isOtherId(id)) return []
      const option = item.options.find((opt) => opt.id === id)
      return option ? [option.label] : []
    })
  }, [])

  const answerTextFor = useCallback((item: AskUserQuestionItem, answer: DraftAnswer): string => {
    const labels = selectedLabelsFor(item, answer)
    const other = answer.selectedIds.some(isOtherId) ? answer.otherText.trim() : ''
    return [...labels, ...(other ? [other] : [])].join(', ').trim()
  }, [selectedLabelsFor])

  const isAnswered = useCallback((item: AskUserQuestionItem): boolean => {
    const answer = getDraft(drafts, item.id)
    return answerTextFor(item, answer).length > 0
  }, [answerTextFor, drafts])

  const allAnswered = !hasValidationError && questions.length > 0 && questions.every((item) => isAnswered(item))

  const updateDraft = useCallback((id: string, updater: (draft: DraftAnswer) => DraftAnswer) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: updater(getDraft(prev, id)),
    }))
    setError('')
  }, [])

  const toggleOption = useCallback((optionId: string) => {
    if (!current || sending) return
    updateDraft(current.id, (prev) => {
      if (current.multiSelect) {
        const selectedIds = prev.selectedIds.includes(optionId)
          ? prev.selectedIds.filter((id) => id !== optionId)
          : [...prev.selectedIds, optionId]
        return { ...prev, selectedIds }
      }
      return {
        selectedIds: prev.selectedIds[0] === optionId ? [] : [optionId],
        otherText: isOtherId(optionId) ? prev.otherText : '',
      }
    })
    setActivePreviewId(optionId)
  }, [current, sending, updateDraft])

  const setOtherText = useCallback((value: string) => {
    if (!current || sending) return
    updateDraft(current.id, (prev) => {
      const selectedIds = current.multiSelect
        ? value.trim()
          ? prev.selectedIds.includes(OTHER_ID)
            ? prev.selectedIds
            : [...prev.selectedIds, OTHER_ID]
          : prev.selectedIds.filter((id) => !isOtherId(id))
        : value.trim()
          ? [OTHER_ID]
          : prev.selectedIds.filter((id) => !isOtherId(id))
      return { selectedIds, otherText: value }
    })
  }, [current, sending, updateDraft])

  const goPrevious = useCallback(() => {
    setCurrentIndex((value) => Math.max(0, value - 1))
    setError('')
    setActivePreviewId(null)
  }, [])

  const goNext = useCallback(() => {
    if (!current || hasValidationError) return
    if (!isAnswered(current)) {
      setError('Choose an option or write an answer.')
      return
    }
    setCurrentIndex((value) => Math.min(questions.length - 1, value + 1))
    setError('')
    setActivePreviewId(null)
  }, [current, hasValidationError, isAnswered, questions.length])

  const buildAnswers = useCallback((): AskUserQuestionAnswer[] => {
    return questions.map((item) => {
      const answer = getDraft(drafts, item.id)
      const selectedLabels = selectedLabelsFor(item, answer)
      const otherText = answer.selectedIds.some(isOtherId) ? answer.otherText.trim() : ''
      return {
        questionId: item.id,
        question: item.question,
        selectedIds: answer.selectedIds,
        selectedLabels,
        otherText: otherText || undefined,
        answerText: answerTextFor(item, answer),
      }
    })
  }, [answerTextFor, drafts, questions, selectedLabelsFor])

  const handleConfirm = useCallback(async () => {
    if (sending || !current || hasValidationError) return
    if (!allAnswered) {
      const missingIndex = questions.findIndex((item) => !isAnswered(item))
      setCurrentIndex(Math.max(0, missingIndex))
      setError('Answer every question before sending.')
      return
    }

    setSending(true)
    setError('')
    const answers = buildAnswers()
    const success = await respondUserQuestion(tabId, question.questionId, answers)
    if (!success) {
      setSending(false)
      setError('Could not send this answer. Try again.')
    }
  }, [allAnswered, buildAnswers, current, hasValidationError, isAnswered, question.questionId, questions, respondUserQuestion, sending, tabId])

  const handleCancel = useCallback(async () => {
    if (sending) return
    setSending(true)
    setError('')
    const success = await respondUserQuestion(tabId, question.questionId, [], undefined, undefined, undefined, true)
    if (!success) {
      setSending(false)
      setError('Could not cancel this question. Try again.')
    }
  }, [question.questionId, respondUserQuestion, sending, tabId])

  if (!current) return null

  const activePreview = (activePreviewId
    ? current.options.find((opt) => opt.id === activePreviewId)?.preview
    : undefined) || current.options.find((opt) => draft.selectedIds.includes(opt.id))?.preview
  const canMoveNext = !hasValidationError && isAnswered(current)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 350, damping: 26, mass: 0.7 }}
      className="mx-4 mt-2 mb-2"
    >
      <div
        style={{
          background: colors.containerBg,
          border: `1px solid ${colors.accentSoft}`,
          borderRadius: 12,
          boxShadow: `0 4px 20px ${colors.accentSoft}`,
        }}
        className="overflow-hidden"
      >
        <div
          className="flex items-center justify-between gap-2 px-3 py-1.5"
          style={{
            background: colors.accentLight,
            borderBottom: `1px solid ${colors.accentBorder}`,
          }}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <Question size={12} style={{ color: colors.accent }} />
            <span className="text-[11px] font-semibold truncate" style={{ color: colors.accent }}>
              {current.header || question.header || 'Question'}
            </span>
          </div>
          {questions.length > 1 && (
            <span className="text-[10px] tabular-nums" style={{ color: colors.textTertiary }}>
              {currentIndex + 1}/{questions.length}
            </span>
          )}
        </div>

        <div className="px-3 py-2.5">
          <p className="text-[12px] leading-[1.5] mb-2" style={{ color: colors.textPrimary }}>
            {current.question}
          </p>

          {question.validationError && (
            <div
              className="flex items-center gap-1.5 text-[10px] px-2 py-1.5 rounded-md mb-2"
              style={{ color: '#b45309', background: 'rgba(245, 158, 11, 0.12)' }}
            >
              <WarningCircle size={12} />
              <span>{question.validationError}</span>
            </div>
          )}

          {current.options.length > 0 && (
            <div className="flex flex-col gap-1.5 mb-2">
              {current.options.map((opt) => {
                const isSelected = draft.selectedIds.includes(opt.id)

                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => toggleOption(opt.id)}
                    onFocus={() => setActivePreviewId(opt.id)}
                    onMouseEnter={() => setActivePreviewId(opt.id)}
                    disabled={sending}
                    aria-pressed={isSelected}
                    className="text-[11px] font-medium px-3 py-2 rounded-lg text-left transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: isSelected ? `${colors.accent}20` : colors.surfaceHover,
                      color: isSelected ? colors.accent : colors.textPrimary,
                      border: `1px solid ${isSelected ? colors.accent + '60' : colors.toolBorder + '60'}`,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="flex-shrink-0 w-3.5 h-3.5 rounded flex items-center justify-center"
                        style={{
                          border: `1.5px solid ${isSelected ? colors.accent : colors.textTertiary}`,
                          background: isSelected ? colors.accent : 'transparent',
                        }}
                      >
                        {isSelected && <Check size={9} weight="bold" color="#fff" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{opt.label}</div>
                        {opt.description && (
                          <div className="text-[10px] mt-0.5 leading-[1.35]" style={{ color: colors.textTertiary }}>
                            {opt.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {current.allowOtherText && (
            <div className="mb-2">
              <label className="flex items-center gap-1.5 text-[10px] mb-1" style={{ color: colors.textTertiary }}>
                <PencilSimple size={11} />
                Other
              </label>
              <textarea
                value={draft.otherText}
                onChange={(e) => setOtherText(e.target.value)}
                onFocus={() => setActivePreviewId(null)}
                disabled={sending}
                placeholder="Type your response..."
                rows={2}
                className="w-full text-[11px] px-2.5 py-2 rounded-lg resize-none outline-none disabled:opacity-40"
                style={{
                  background: colors.codeBg,
                  color: colors.textPrimary,
                  border: `1px solid ${draft.otherText.trim() ? colors.accent + '66' : colors.toolBorder}`,
                }}
              />
            </div>
          )}

          {activePreview && (
            <pre
              className="text-[10px] leading-[1.45] whitespace-pre-wrap rounded-lg p-2 mb-2 max-h-28 overflow-auto"
              style={{
                color: colors.textSecondary,
                background: colors.codeBg,
                border: `1px solid ${colors.toolBorder}`,
              }}
            >
              {activePreview}
            </pre>
          )}

          {error && (
            <div className="text-[10px] mb-2" style={{ color: '#ef4444' }}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-between mt-3 gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCancel}
                disabled={sending}
                aria-label="Cancel question"
                className="w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                style={{ background: colors.surfaceHover, color: colors.textSecondary, border: `1px solid ${colors.toolBorder}` }}
              >
                <X size={12} weight="bold" />
              </button>
              {questions.length > 1 && (
                <button
                  type="button"
                  onClick={goPrevious}
                  disabled={currentIndex === 0 || sending}
                  aria-label="Previous question"
                  className="w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                  style={{ background: colors.surfaceHover, color: colors.textSecondary, border: `1px solid ${colors.toolBorder}` }}
                >
                  <CaretLeft size={12} weight="bold" />
                </button>
              )}
              {queueLength > 1 && (
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full"
                  style={{
                    background: colors.accentLight,
                    color: colors.accent,
                  }}
                >
                  +{queueLength - 1} more
                </span>
              )}
            </div>

            {!isLast ? (
              <button
                type="button"
                onClick={goNext}
                disabled={!canMoveNext || sending}
                className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-full transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: canMoveNext ? colors.accent : colors.surfaceHover,
                  color: canMoveNext ? '#fff' : colors.textTertiary,
                  border: 'none',
                }}
              >
                Next
                <CaretRight size={11} weight="bold" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!allAnswered || sending}
                className="flex items-center gap-1.5 text-[11px] font-medium px-4 py-1.5 rounded-full transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: allAnswered ? colors.accent : colors.surfaceHover,
                  color: allAnswered ? '#fff' : colors.textTertiary,
                  border: 'none',
                  boxShadow: allAnswered ? `0 2px 8px ${colors.accent}40` : 'none',
                }}
              >
                <ArrowUpRight size={11} weight="bold" />
                {sending ? 'Sending...' : 'Confirm'}
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
