import React, { useState, useMemo } from 'react'
import { useColors } from '../theme'

type DiffOp = { type: 'equal' | 'add' | 'remove'; line: string }
type Hunk = { label?: string; ops: DiffOp[]; replaceAll?: boolean }
type DiffModel = { filePath: string; isNewFile: boolean; hunks: Hunk[] }

const MAX_LINES = 6000
const PREVIEW_LINES = 40

function toLines(text: string): string[] {
  const norm = text.replace(/\r\n/g, '\n')
  const lines = norm.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function basename(p?: string): string {
  if (!p) return ''
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : p
}

function allAdd(text: string): DiffOp[] {
  if (text === '') return []
  return toLines(text).map((line) => ({ type: 'add' as const, line }))
}

function computeDiff(oldText: string, newText: string): DiffOp[] {
  if (oldText === newText) return toLines(oldText).map((line) => ({ type: 'equal' as const, line }))
  const a = toLines(oldText)
  const b = toLines(newText)
  const n = a.length
  const m = b.length
  if (n + m > MAX_LINES) {
    return [
      ...a.map((line) => ({ type: 'remove' as const, line })),
      ...b.map((line) => ({ type: 'add' as const, line })),
    ]
  }
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'equal', line: a[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'remove', line: a[i] }); i++ }
    else { out.push({ type: 'add', line: b[j] }); j++ }
  }
  while (i < n) out.push({ type: 'remove', line: a[i++] })
  while (j < m) out.push({ type: 'add', line: b[j++] })
  return out
}

function parseModel(toolName: string, toolInput: string): DiffModel | null {
  let parsed: any
  try { parsed = JSON.parse(toolInput) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const filePath = typeof parsed.file_path === 'string'
    ? parsed.file_path
    : typeof parsed.notebook_path === 'string'
      ? parsed.notebook_path
      : ''

  if (toolName === 'Edit') {
    if (typeof parsed.old_string !== 'string' || typeof parsed.new_string !== 'string') return null
    return {
      filePath,
      isNewFile: false,
      hunks: [{ ops: computeDiff(parsed.old_string, parsed.new_string), replaceAll: parsed.replace_all === true }],
    }
  }

  if (toolName === 'MultiEdit') {
    if (!Array.isArray(parsed.edits)) return null
    const hunks: Hunk[] = []
    parsed.edits.forEach((e: any, idx: number) => {
      if (!e || typeof e.old_string !== 'string' || typeof e.new_string !== 'string') return
      hunks.push({
        label: `Edit ${idx + 1} of ${parsed.edits.length}`,
        ops: computeDiff(e.old_string, e.new_string),
        replaceAll: e.replace_all === true,
      })
    })
    if (hunks.length === 0) return null
    return { filePath, isNewFile: false, hunks }
  }

  if (toolName === 'Write') {
    if (typeof parsed.content !== 'string') return null
    return { filePath, isNewFile: true, hunks: [{ ops: allAdd(parsed.content) }] }
  }

  if (toolName === 'NotebookEdit') {
    const source = typeof parsed.new_source === 'string'
      ? parsed.new_source
      : typeof parsed.source === 'string'
        ? parsed.source
        : typeof parsed.content === 'string'
          ? parsed.content
          : null
    const mode = typeof parsed.edit_mode === 'string' ? parsed.edit_mode : 'replace'
    if (mode === 'delete') return { filePath, isNewFile: false, hunks: [{ ops: [{ type: 'remove', line: '(cell deleted)' }] }] }
    if (source === null) return null
    return { filePath, isNewFile: false, hunks: [{ ops: allAdd(source) }] }
  }

  return null
}

export function DiffViewer({ toolName, toolInput }: { toolName: string; toolInput: string }) {
  const [showAll, setShowAll] = useState(false)
  const colors = useColors()
  const model = useMemo(() => parseModel(toolName, toolInput), [toolName, toolInput])
  if (!model) return null

  let added = 0
  let removed = 0
  for (const h of model.hunks) {
    for (const op of h.ops) {
      if (op.type === 'add') added++
      else if (op.type === 'remove') removed++
    }
  }

  const totalRows = model.hunks.reduce((s, h) => s + h.ops.length, 0)
  const isEmpty = totalRows === 0
  const truncated = !showAll && totalRows > PREVIEW_LINES
  const fileLabel = basename(model.filePath)
  const hasReplaceAll = model.hunks.some((h) => h.replaceAll)

  let budget = showAll ? Infinity : PREVIEW_LINES

  return (
    <div className="mt-1.5 rounded-md overflow-hidden" style={{ border: `1px solid ${colors.toolBorder}` }}>
      <div className="flex items-center gap-2 px-2 py-[3px]" style={{ background: colors.surfaceHover }}>
        {fileLabel && (
          <span className="text-[10px] font-mono truncate" style={{ color: colors.textSecondary, maxWidth: 200 }} title={model.filePath}>
            {fileLabel}
          </span>
        )}
        {model.isNewFile && (
          <span className="text-[9px] px-1 py-[1px] rounded" style={{ background: colors.statusCompleteBg, color: colors.statusComplete }}>
            new file
          </span>
        )}
        {hasReplaceAll && (
          <span className="text-[9px] px-1 py-[1px] rounded" style={{ background: colors.accentLight, color: colors.accent }}>
            all occurrences
          </span>
        )}
        <span className="flex-1" />
        {added > 0 && (
          <span className="text-[10px] font-mono font-medium" style={{ color: colors.statusComplete }}>+{added}</span>
        )}
        {removed > 0 && (
          <span className="text-[10px] font-mono font-medium" style={{ color: colors.statusError }}>-{removed}</span>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${colors.toolBorder}`, overflowX: 'auto' }}>
        {isEmpty && (
          <div className="font-mono text-[11px] px-2 py-1" style={{ color: colors.textTertiary }}>
            (empty file)
          </div>
        )}
        {model.hunks.map((hunk, hi) => {
          if (!showAll && budget <= 0) return null
          const rows: React.ReactNode[] = []
          if (hunk.label && hunk.ops.length > 0) {
            rows.push(
              <div
                key={`l-${hi}`}
                className="font-mono text-[10px] px-2 py-[2px]"
                style={{ background: colors.surfaceHover, color: colors.textTertiary, borderTop: hi > 0 ? `1px solid ${colors.toolBorder}` : undefined }}
              >
                {hunk.label}
              </div>
            )
          }
          for (let k = 0; k < hunk.ops.length; k++) {
            if (!showAll && budget <= 0) break
            const op = hunk.ops[k]
            budget--
            rows.push(
              <div
                key={`${hi}-${k}`}
                className="font-mono text-[11px] leading-[1.6] flex items-start gap-1.5 px-2"
                style={{
                  background: op.type === 'add' ? colors.statusCompleteBg : op.type === 'remove' ? colors.statusErrorBg : 'transparent',
                  whiteSpace: 'pre',
                  minHeight: 18,
                }}
              >
                <span
                  className="flex-shrink-0 font-bold select-none"
                  style={{ color: op.type === 'add' ? colors.statusComplete : op.type === 'remove' ? colors.statusError : colors.textMuted, width: 10 }}
                >
                  {op.type === 'add' ? '+' : op.type === 'remove' ? '-' : ' '}
                </span>
                <span style={{ color: op.type === 'equal' ? colors.textTertiary : colors.textSecondary }}>
                  {op.line || ' '}
                </span>
              </div>
            )
          }
          return <React.Fragment key={hi}>{rows}</React.Fragment>
        })}

        {truncated && (
          <div
            className="px-2 py-1 text-[10px] cursor-pointer text-center"
            style={{ color: colors.textTertiary, background: colors.surfaceHover, borderTop: `1px solid ${colors.toolBorder}` }}
            onClick={() => setShowAll(true)}
          >
            Show {totalRows - PREVIEW_LINES} more line{totalRows - PREVIEW_LINES > 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  )
}
