import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import {
  Trash, Cpu, CurrencyDollar, Question, HardDrives, Sparkle, Brain, Lightning,
  ArrowsClockwise, Gauge, ShieldCheck, Gear, Stethoscope, Export, Copy, FastForward,
  ChartBar, GitBranch, FileText, ArrowCounterClockwise,
} from '@phosphor-icons/react'
import { usePopoverLayer } from './PopoverLayer'
import { useColors } from '../theme'

export interface SlashCommand {
  command: string
  description: string
  icon: React.ReactNode
  target?: 'local' | 'cli'
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/clear', description: 'Clear conversation history', icon: <Trash size={13} />, target: 'local' },
  { command: '/compact', description: 'Compact conversation context', icon: <ArrowsClockwise size={13} />, target: 'cli' },
  { command: '/config', description: 'Open settings', icon: <Gear size={13} />, target: 'cli' },
  { command: '/context', description: 'Show context usage info', icon: <Gauge size={13} />, target: 'cli' },
  { command: '/copy', description: 'Copy last response', icon: <Copy size={13} />, target: 'cli' },
  { command: '/cost', description: 'Show token usage and cost', icon: <CurrencyDollar size={13} />, target: 'local' },
  { command: '/diff', description: 'Show file changes', icon: <GitBranch size={13} />, target: 'cli' },
  { command: '/doctor', description: 'Diagnose installation', icon: <Stethoscope size={13} />, target: 'cli' },
  { command: '/effort', description: 'Set effort level', icon: <Lightning size={13} />, target: 'local' },
  { command: '/export', description: 'Export conversation', icon: <Export size={13} />, target: 'cli' },
  { command: '/fast', description: 'Toggle fast mode', icon: <FastForward size={13} />, target: 'cli' },
  { command: '/help', description: 'Show available commands', icon: <Question size={13} />, target: 'local' },
  { command: '/init', description: 'Initialize project CLAUDE.md', icon: <FileText size={13} />, target: 'cli' },
  { command: '/mcp', description: 'Show MCP server status', icon: <HardDrives size={13} />, target: 'local' },
  { command: '/memory', description: 'Edit CLAUDE.md memories', icon: <Brain size={13} />, target: 'cli' },
  { command: '/model', description: 'Show or switch model', icon: <Cpu size={13} />, target: 'local' },
  { command: '/permissions', description: 'View tool permissions', icon: <ShieldCheck size={13} />, target: 'cli' },
  { command: '/provider', description: 'Configure provider profiles', icon: <Gear size={13} />, target: 'cli' },
  { command: '/onboard-github', description: 'Setup GitHub Models access', icon: <ChartBar size={13} />, target: 'cli' },
  { command: '/tasks', description: 'Manage tasks and background jobs', icon: <ArrowsClockwise size={13} />, target: 'cli' },
  { command: '/desktop', description: 'Desktop integration commands', icon: <Cpu size={13} />, target: 'cli' },
  { command: '/mobile', description: 'Mobile integration commands', icon: <Cpu size={13} />, target: 'cli' },
  { command: '/rewind', description: 'Revert to checkpoint', icon: <ArrowCounterClockwise size={13} />, target: 'cli' },
  { command: '/skills', description: 'Show available skills', icon: <Sparkle size={13} />, target: 'local' },
  { command: '/status', description: 'Show session status', icon: <ChartBar size={13} />, target: 'cli' },
  { command: '/thinking', description: 'Toggle extended thinking', icon: <Brain size={13} />, target: 'local' },
  { command: '/usage', description: 'Show plan limits', icon: <CurrencyDollar size={13} />, target: 'cli' },
]

interface Props {
  filter: string
  selectedIndex: number
  onSelect: (cmd: SlashCommand) => void
  anchorRect: DOMRect | null
  extraCommands?: SlashCommand[]
}

export function getFilteredCommands(filter: string): SlashCommand[] {
  return getFilteredCommandsWithExtras(filter, [])
}

export function getFilteredCommandsWithExtras(filter: string, extraCommands: SlashCommand[]): SlashCommand[] {
  const q = filter.toLowerCase()
  const merged: SlashCommand[] = [...SLASH_COMMANDS]
  for (const cmd of extraCommands) {
    if (!merged.some((c) => c.command === cmd.command)) {
      merged.push(cmd)
    }
  }
  return merged.filter((c) => c.command.startsWith(q))
}

export function SlashCommandMenu({ filter, selectedIndex, onSelect, anchorRect, extraCommands = [] }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const popoverLayer = usePopoverLayer()
  const filtered = getFilteredCommandsWithExtras(filter, extraCommands)
  const colors = useColors()

  useEffect(() => {
    if (!listRef.current) return
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (filtered.length === 0 || !anchorRect || !popoverLayer) return null

  return createPortal(
    <motion.div
      data-clui-ui
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28, mass: 0.6 }}
      style={{
        position: 'fixed',
        bottom: window.innerHeight - anchorRect.top + 4,
        left: anchorRect.left + 12,
        right: window.innerWidth - anchorRect.right + 12,
        pointerEvents: 'auto',
      }}
    >
      <div
        ref={listRef}
        className="overflow-y-auto rounded-xl py-1"
        style={{
          maxHeight: 220,
          background: colors.popoverBg,
          backdropFilter: 'blur(20px)',
          border: `1px solid ${colors.popoverBorder}`,
          boxShadow: colors.popoverShadow,
        }}
      >
        {filtered.map((cmd, i) => {
          const isSelected = i === selectedIndex
          return (
            <button
              key={cmd.command}
              onClick={() => onSelect(cmd)}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors"
              style={{
                background: isSelected ? colors.accentLight : 'transparent',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = colors.accentLight
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  (e.currentTarget as HTMLElement).style.background = 'transparent'
                }
              }}
            >
              <span
                className="flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0"
                style={{
                  background: isSelected ? colors.accentSoft : colors.surfaceHover,
                  color: isSelected ? colors.accent : colors.textTertiary,
                }}
              >
                {cmd.icon}
              </span>
              <div className="min-w-0 flex-1">
                <span
                  className="text-[12px] font-mono font-medium"
                  style={{ color: isSelected ? colors.accent : colors.textPrimary }}
                >
                  {cmd.command}
                </span>
                <span
                  className="text-[11px] ml-2"
                  style={{ color: colors.textTertiary }}
                >
                  {cmd.description}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </motion.div>,
    popoverLayer,
  )
}
