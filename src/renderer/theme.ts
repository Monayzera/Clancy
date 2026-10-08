/**
 * CLUI Design Tokens — Dual theme (dark + light)
 * Colors derived from ChatCN oklch system and design-fixed.html reference.
 */
import { create } from 'zustand'
import type { GlassTone } from '../shared/types'

// ─── Color palettes ───

const darkColors = {
  // Container (glass surfaces)
  containerBg: '#242422',
  containerBgCollapsed: '#21211e',
  containerBorder: '#3b3b36',
  containerShadow: '0 8px 28px rgba(0, 0, 0, 0.35), 0 1px 6px rgba(0, 0, 0, 0.25)',
  cardShadow: '0 2px 8px rgba(0,0,0,0.35)',
  cardShadowCollapsed: '0 2px 6px rgba(0,0,0,0.4)',

  // Surface layers
  surfacePrimary: '#353530',
  surfaceSecondary: '#42423d',
  surfaceHover: 'rgba(255, 255, 255, 0.05)',
  surfaceActive: 'rgba(255, 255, 255, 0.08)',

  // Input
  inputBg: 'transparent',
  inputBorder: '#3b3b36',
  inputFocusBorder: 'rgba(217, 119, 87, 0.4)',
  inputPillBg: '#2a2a27',

  // Text
  textPrimary: '#ccc9c0',
  textSecondary: '#c0bdb2',
  textTertiary: '#76766e',
  textMuted: '#353530',

  // Accent — orange
  accent: '#d97757',
  accentLight: 'rgba(217, 119, 87, 0.1)',
  accentSoft: 'rgba(217, 119, 87, 0.15)',

  // Status dots
  statusIdle: '#8a8a80',
  statusRunning: '#d97757',
  statusRunningBg: 'rgba(217, 119, 87, 0.1)',
  statusComplete: '#7aac8c',
  statusCompleteBg: 'rgba(122, 172, 140, 0.1)',
  statusError: '#c47060',
  statusErrorBg: 'rgba(196, 112, 96, 0.08)',
  statusDead: '#c47060',
  statusPermission: '#d97757',
  statusPermissionGlow: 'rgba(217, 119, 87, 0.4)',

  // Tab
  tabActive: '#353530',
  tabActiveBorder: '#4a4a45',
  tabInactive: 'transparent',
  tabHover: 'rgba(255, 255, 255, 0.05)',

  // User message bubble
  userBubble: '#353530',
  userBubbleBorder: '#4a4a45',
  userBubbleText: '#ccc9c0',

  // Tool card
  toolBg: '#353530',
  toolBorder: '#4a4a45',
  toolRunningBorder: 'rgba(217, 119, 87, 0.3)',
  toolRunningBg: 'rgba(217, 119, 87, 0.05)',

  // Timeline
  timelineLine: '#353530',
  timelineNode: 'rgba(217, 119, 87, 0.2)',
  timelineNodeActive: '#d97757',

  // Scrollbar
  scrollThumb: 'rgba(255, 255, 255, 0.15)',
  scrollThumbHover: 'rgba(255, 255, 255, 0.25)',

  // Stop button
  stopBg: '#ef4444',
  stopHover: '#dc2626',

  // Send button
  sendBg: '#d97757',
  sendHover: '#c96442',
  sendDisabled: 'rgba(217, 119, 87, 0.3)',

  // Popover
  popoverBg: '#292927',
  popoverBorder: '#3b3b36',
  popoverShadow: '0 4px 20px rgba(0,0,0,0.3), 0 1px 4px rgba(0,0,0,0.2)',

  // Code block
  codeBg: '#1a1a18',

  // Mic button
  micBg: '#353530',
  micColor: '#c0bdb2',
  micDisabled: '#42423d',

  // Placeholder
  placeholder: '#6b6b60',

  // Disabled button color
  btnDisabled: '#42423d',

  // Text on accent backgrounds
  textOnAccent: '#ffffff',

  // Button hover (CSS-only stack buttons)
  btnHoverColor: '#c0bdb2',
  btnHoverBg: '#302f2d',

  // Accent border variants (replaces hex-alpha concatenation antipattern)
  accentBorder: 'rgba(217, 119, 87, 0.19)',
  accentBorderMedium: 'rgba(217, 119, 87, 0.25)',

  // Permission card (amber)
  permissionBorder: 'rgba(245, 158, 11, 0.3)',
  permissionShadow: '0 2px 12px rgba(245, 158, 11, 0.08)',
  permissionHeaderBg: 'rgba(245, 158, 11, 0.06)',
  permissionHeaderBorder: 'rgba(245, 158, 11, 0.12)',

  // Permission allow (green)
  permissionAllowBg: 'rgba(34, 197, 94, 0.1)',
  permissionAllowHoverBg: 'rgba(34, 197, 94, 0.22)',
  permissionAllowBorder: 'rgba(34, 197, 94, 0.25)',

  // Permission deny (red)
  permissionDenyBg: 'rgba(239, 68, 68, 0.08)',
  permissionDenyHoverBg: 'rgba(239, 68, 68, 0.18)',
  permissionDenyBorder: 'rgba(239, 68, 68, 0.22)',

  // Permission denied card
  permissionDeniedBorder: 'rgba(196, 112, 96, 0.3)',
  permissionDeniedHeaderBorder: 'rgba(196, 112, 96, 0.12)',
} as const

const lightColors = {
  // Container (glass surfaces)
  containerBg: '#f9f8f5',
  containerBgCollapsed: '#f4f2ed',
  containerBorder: '#dddad2',
  containerShadow: '0 8px 28px rgba(0, 0, 0, 0.08), 0 1px 6px rgba(0, 0, 0, 0.04)',
  cardShadow: '0 2px 8px rgba(0,0,0,0.06)',
  cardShadowCollapsed: '0 2px 6px rgba(0,0,0,0.08)',

  // Surface layers
  surfacePrimary: '#edeae0',
  surfaceSecondary: '#dddad2',
  surfaceHover: 'rgba(0, 0, 0, 0.04)',
  surfaceActive: 'rgba(0, 0, 0, 0.06)',

  // Input
  inputBg: 'transparent',
  inputBorder: '#dddad2',
  inputFocusBorder: 'rgba(217, 119, 87, 0.4)',
  inputPillBg: '#ffffff',

  // Text
  textPrimary: '#3c3929',
  textSecondary: '#5a5749',
  textTertiary: '#8a8a80',
  textMuted: '#dddad2',

  // Accent — orange (same)
  accent: '#d97757',
  accentLight: 'rgba(217, 119, 87, 0.1)',
  accentSoft: 'rgba(217, 119, 87, 0.12)',

  // Status dots
  statusIdle: '#8a8a80',
  statusRunning: '#d97757',
  statusRunningBg: 'rgba(217, 119, 87, 0.1)',
  statusComplete: '#5a9e6f',
  statusCompleteBg: 'rgba(90, 158, 111, 0.1)',
  statusError: '#c47060',
  statusErrorBg: 'rgba(196, 112, 96, 0.06)',
  statusDead: '#c47060',
  statusPermission: '#d97757',
  statusPermissionGlow: 'rgba(217, 119, 87, 0.3)',

  // Tab
  tabActive: '#edeae0',
  tabActiveBorder: '#dddad2',
  tabInactive: 'transparent',
  tabHover: 'rgba(0, 0, 0, 0.04)',

  // User message bubble
  userBubble: '#edeae0',
  userBubbleBorder: '#dddad2',
  userBubbleText: '#3c3929',

  // Tool card
  toolBg: '#edeae0',
  toolBorder: '#dddad2',
  toolRunningBorder: 'rgba(217, 119, 87, 0.3)',
  toolRunningBg: 'rgba(217, 119, 87, 0.05)',

  // Timeline
  timelineLine: '#dddad2',
  timelineNode: 'rgba(217, 119, 87, 0.2)',
  timelineNodeActive: '#d97757',

  // Scrollbar
  scrollThumb: 'rgba(0, 0, 0, 0.1)',
  scrollThumbHover: 'rgba(0, 0, 0, 0.18)',

  // Stop button
  stopBg: '#ef4444',
  stopHover: '#dc2626',

  // Send button
  sendBg: '#d97757',
  sendHover: '#c96442',
  sendDisabled: 'rgba(217, 119, 87, 0.3)',

  // Popover
  popoverBg: '#f9f8f5',
  popoverBorder: '#dddad2',
  popoverShadow: '0 4px 20px rgba(0,0,0,0.1), 0 1px 4px rgba(0,0,0,0.06)',

  // Code block
  codeBg: '#f0eee8',

  // Mic button
  micBg: '#edeae0',
  micColor: '#5a5749',
  micDisabled: '#c8c5bc',

  // Placeholder
  placeholder: '#b0ada4',

  // Disabled button color
  btnDisabled: '#c8c5bc',

  // Text on accent backgrounds
  textOnAccent: '#ffffff',

  // Button hover (CSS-only stack buttons)
  btnHoverColor: '#3c3929',
  btnHoverBg: '#edeae0',

  // Accent border variants (replaces hex-alpha concatenation antipattern)
  accentBorder: 'rgba(217, 119, 87, 0.19)',
  accentBorderMedium: 'rgba(217, 119, 87, 0.25)',

  // Permission card (amber)
  permissionBorder: 'rgba(245, 158, 11, 0.3)',
  permissionShadow: '0 2px 12px rgba(245, 158, 11, 0.08)',
  permissionHeaderBg: 'rgba(245, 158, 11, 0.06)',
  permissionHeaderBorder: 'rgba(245, 158, 11, 0.12)',

  // Permission allow (green)
  permissionAllowBg: 'rgba(34, 197, 94, 0.1)',
  permissionAllowHoverBg: 'rgba(34, 197, 94, 0.22)',
  permissionAllowBorder: 'rgba(34, 197, 94, 0.25)',

  // Permission deny (red)
  permissionDenyBg: 'rgba(239, 68, 68, 0.08)',
  permissionDenyHoverBg: 'rgba(239, 68, 68, 0.18)',
  permissionDenyBorder: 'rgba(239, 68, 68, 0.22)',

  // Permission denied card
  permissionDeniedBorder: 'rgba(196, 112, 96, 0.3)',
  permissionDeniedHeaderBorder: 'rgba(196, 112, 96, 0.12)',
} as const

const codexDarkColors = {
  ...darkColors,
  containerBg: '#1a1a1a',
  containerBgCollapsed: '#191919',
  containerBorder: '#404040',
  containerShadow: '0 8px 28px rgba(0, 0, 0, 0.45), 0 1px 6px rgba(0, 0, 0, 0.3)',
  cardShadow: '0 2px 8px rgba(0,0,0,0.45)',
  cardShadowCollapsed: '0 2px 6px rgba(0,0,0,0.5)',
  surfacePrimary: '#2a2a2a',
  surfaceSecondary: '#333333',
  surfaceHover: 'rgba(255, 255, 255, 0.04)',
  surfaceActive: 'rgba(255, 255, 255, 0.07)',
  inputFocusBorder: 'rgba(136, 136, 136, 0.4)',
  inputPillBg: '#222222',
  textPrimary: '#e0e0e0',
  textSecondary: '#b0b0b0',
  textTertiary: '#707070',
  textMuted: '#2a2a2a',
  accent: '#888888',
  accentLight: 'rgba(136, 136, 136, 0.1)',
  accentSoft: 'rgba(136, 136, 136, 0.15)',
  statusRunning: '#888888',
  statusRunningBg: 'rgba(136, 136, 136, 0.1)',
  statusPermission: '#888888',
  statusPermissionGlow: 'rgba(136, 136, 136, 0.4)',
  tabActive: '#2a2a2a',
  tabActiveBorder: '#404040',
  tabHover: 'rgba(255, 255, 255, 0.04)',
  userBubble: '#2a2a2a',
  userBubbleBorder: '#404040',
  userBubbleText: '#e0e0e0',
  toolBg: '#2a2a2a',
  toolBorder: '#404040',
  toolRunningBorder: 'rgba(136, 136, 136, 0.3)',
  toolRunningBg: 'rgba(136, 136, 136, 0.05)',
  timelineLine: '#2a2a2a',
  timelineNode: 'rgba(136, 136, 136, 0.2)',
  timelineNodeActive: '#888888',
  sendBg: '#888888',
  sendHover: '#777777',
  sendDisabled: 'rgba(136, 136, 136, 0.3)',
  popoverBg: '#1e1e1e',
  popoverBorder: '#404040',
  popoverShadow: '0 4px 20px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.25)',
  codeBg: '#151515',
  accentBorder: 'rgba(136, 136, 136, 0.19)',
  accentBorderMedium: 'rgba(136, 136, 136, 0.25)',
} as const

const codexLightColors = {
  ...lightColors,
  accent: '#888888',
  accentLight: 'rgba(136, 136, 136, 0.1)',
  accentSoft: 'rgba(136, 136, 136, 0.12)',
  statusRunning: '#888888',
  statusRunningBg: 'rgba(136, 136, 136, 0.1)',
  statusPermission: '#888888',
  statusPermissionGlow: 'rgba(136, 136, 136, 0.3)',
  toolRunningBorder: 'rgba(136, 136, 136, 0.3)',
  toolRunningBg: 'rgba(136, 136, 136, 0.05)',
  timelineNode: 'rgba(136, 136, 136, 0.2)',
  timelineNodeActive: '#888888',
  sendBg: '#888888',
  sendHover: '#777777',
  sendDisabled: 'rgba(136, 136, 136, 0.3)',
  inputFocusBorder: 'rgba(136, 136, 136, 0.4)',
  accentBorder: 'rgba(136, 136, 136, 0.19)',
  accentBorderMedium: 'rgba(136, 136, 136, 0.25)',
} as const

const openclaudeDarkColors = {
  containerBg: '#000000',
  containerBgCollapsed: '#000000',
  containerBorder: '#1a1a1a',
  containerShadow: '0 8px 28px rgba(0, 0, 0, 0.6), 0 1px 6px rgba(0, 0, 0, 0.4)',
  cardShadow: '0 2px 8px rgba(0,0,0,0.5)',
  cardShadowCollapsed: '0 2px 6px rgba(0,0,0,0.6)',
  surfacePrimary: '#0d0d0d',
  surfaceSecondary: '#141414',
  surfaceHover: 'rgba(52, 211, 153, 0.04)',
  surfaceActive: 'rgba(52, 211, 153, 0.06)',
  inputBg: 'transparent',
  inputBorder: '#1a1a1a',
  inputFocusBorder: 'rgba(52, 211, 153, 0.35)',
  inputPillBg: '#0a0a0a',
  textPrimary: '#e2e2e2',
  textSecondary: '#a8a8a8',
  textTertiary: '#5a5a5a',
  textMuted: '#1a1a1a',
  accent: '#34d399',
  accentLight: 'rgba(52, 211, 153, 0.1)',
  accentSoft: 'rgba(52, 211, 153, 0.15)',
  statusIdle: '#5a5a5a',
  statusRunning: '#34d399',
  statusRunningBg: 'rgba(52, 211, 153, 0.1)',
  statusComplete: '#34d399',
  statusCompleteBg: 'rgba(52, 211, 153, 0.1)',
  statusError: '#ef4444',
  statusErrorBg: 'rgba(239, 68, 68, 0.08)',
  statusDead: '#ef4444',
  statusPermission: '#34d399',
  statusPermissionGlow: 'rgba(52, 211, 153, 0.35)',
  tabActive: '#0d0d0d',
  tabActiveBorder: '#1a1a1a',
  tabInactive: 'transparent',
  tabHover: 'rgba(52, 211, 153, 0.04)',
  userBubble: '#0d0d0d',
  userBubbleBorder: '#1a1a1a',
  userBubbleText: '#e2e2e2',
  toolBg: '#0d0d0d',
  toolBorder: '#1a1a1a',
  toolRunningBorder: 'rgba(52, 211, 153, 0.25)',
  toolRunningBg: 'rgba(52, 211, 153, 0.04)',
  timelineLine: '#1a1a1a',
  timelineNode: 'rgba(52, 211, 153, 0.2)',
  timelineNodeActive: '#34d399',
  scrollThumb: 'rgba(255, 255, 255, 0.12)',
  scrollThumbHover: 'rgba(255, 255, 255, 0.22)',
  stopBg: '#ef4444',
  stopHover: '#dc2626',
  sendBg: '#34d399',
  sendHover: '#28b886',
  sendDisabled: 'rgba(52, 211, 153, 0.25)',
  popoverBg: '#050505',
  popoverBorder: '#1a1a1a',
  popoverShadow: '0 4px 20px rgba(0,0,0,0.5), 0 1px 4px rgba(0,0,0,0.3)',
  codeBg: '#080808',
  micBg: '#0d0d0d',
  micColor: '#a8a8a8',
  micDisabled: '#1a1a1a',
  placeholder: '#4a4a4a',
  btnDisabled: '#1a1a1a',
  textOnAccent: '#000000',
  btnHoverColor: '#a8a8a8',
  btnHoverBg: '#141414',
  accentBorder: 'rgba(52, 211, 153, 0.19)',
  accentBorderMedium: 'rgba(52, 211, 153, 0.25)',
  permissionBorder: 'rgba(245, 158, 11, 0.3)',
  permissionShadow: '0 2px 12px rgba(245, 158, 11, 0.08)',
  permissionHeaderBg: 'rgba(245, 158, 11, 0.06)',
  permissionHeaderBorder: 'rgba(245, 158, 11, 0.12)',
  permissionAllowBg: 'rgba(52, 211, 153, 0.1)',
  permissionAllowHoverBg: 'rgba(52, 211, 153, 0.22)',
  permissionAllowBorder: 'rgba(52, 211, 153, 0.25)',
  permissionDenyBg: 'rgba(239, 68, 68, 0.08)',
  permissionDenyHoverBg: 'rgba(239, 68, 68, 0.18)',
  permissionDenyBorder: 'rgba(239, 68, 68, 0.22)',
  permissionDeniedBorder: 'rgba(239, 68, 68, 0.3)',
  permissionDeniedHeaderBorder: 'rgba(239, 68, 68, 0.12)',
} as const

const openclaudeLightColors = openclaudeDarkColors

export type ColorPalette = { [K in keyof typeof darkColors]: string }

const glassLightInkColors: ColorPalette = {
  ...darkColors,
  containerBg: 'transparent',
  containerBgCollapsed: 'transparent',
  containerBorder: 'rgba(255, 255, 255, 0.1)',
  containerShadow: '0 18px 50px rgba(0, 0, 0, 0.28), 0 2px 10px rgba(0, 0, 0, 0.18)',
  cardShadow: '0 18px 50px rgba(0, 0, 0, 0.28), 0 2px 10px rgba(0, 0, 0, 0.16)',
  cardShadowCollapsed: '0 12px 34px rgba(0, 0, 0, 0.26), 0 2px 8px rgba(0, 0, 0, 0.16)',
  surfacePrimary: 'rgba(255, 255, 255, 0.12)',
  surfaceSecondary: 'rgba(255, 255, 255, 0.18)',
  surfaceHover: 'rgba(255, 255, 255, 0.08)',
  surfaceActive: 'rgba(255, 255, 255, 0.14)',
  inputBorder: 'rgba(255, 255, 255, 0.16)',
  inputFocusBorder: 'rgba(255, 255, 255, 0.45)',
  inputPillBg: 'transparent',
  textPrimary: 'rgba(255, 255, 255, 0.96)',
  textSecondary: 'rgba(255, 255, 255, 0.84)',
  textTertiary: 'rgba(255, 255, 255, 0.6)',
  textMuted: 'rgba(255, 255, 255, 0.32)',
  accent: '#ffffff',
  accentLight: 'rgba(255, 255, 255, 0.12)',
  accentSoft: 'rgba(255, 255, 255, 0.18)',
  statusIdle: 'rgba(255, 255, 255, 0.5)',
  statusRunning: '#ffffff',
  statusRunningBg: 'rgba(255, 255, 255, 0.12)',
  statusComplete: '#8fe3a8',
  statusCompleteBg: 'rgba(143, 227, 168, 0.14)',
  statusError: '#ff8a7a',
  statusErrorBg: 'rgba(255, 138, 122, 0.12)',
  statusDead: '#ff8a7a',
  statusPermission: '#ffd66b',
  statusPermissionGlow: 'rgba(255, 214, 107, 0.45)',
  tabActive: 'rgba(255, 255, 255, 0.16)',
  tabActiveBorder: 'rgba(255, 255, 255, 0.22)',
  tabHover: 'rgba(255, 255, 255, 0.08)',
  userBubble: 'rgba(255, 255, 255, 0.13)',
  userBubbleBorder: 'rgba(255, 255, 255, 0.18)',
  userBubbleText: 'rgba(255, 255, 255, 0.96)',
  toolBg: 'rgba(255, 255, 255, 0.07)',
  toolBorder: 'rgba(255, 255, 255, 0.14)',
  toolRunningBorder: 'rgba(255, 255, 255, 0.35)',
  toolRunningBg: 'rgba(255, 255, 255, 0.08)',
  timelineLine: 'rgba(255, 255, 255, 0.14)',
  timelineNode: 'rgba(255, 255, 255, 0.3)',
  timelineNodeActive: '#ffffff',
  scrollThumb: 'rgba(255, 255, 255, 0.22)',
  scrollThumbHover: 'rgba(255, 255, 255, 0.36)',
  stopBg: '#ff5f57',
  stopHover: '#e5483f',
  sendBg: '#ffffff',
  sendHover: 'rgba(255, 255, 255, 0.86)',
  sendDisabled: 'rgba(255, 255, 255, 0.25)',
  popoverBg: 'rgba(24, 24, 27, 0.3)',
  popoverBorder: 'rgba(255, 255, 255, 0.14)',
  popoverShadow: '0 18px 48px rgba(0, 0, 0, 0.32), 0 2px 8px rgba(0, 0, 0, 0.18)',
  codeBg: 'rgba(0, 0, 0, 0.28)',
  micBg: 'rgba(255, 255, 255, 0.14)',
  micColor: 'rgba(255, 255, 255, 0.9)',
  micDisabled: 'rgba(255, 255, 255, 0.1)',
  placeholder: 'rgba(255, 255, 255, 0.5)',
  btnDisabled: 'rgba(255, 255, 255, 0.25)',
  textOnAccent: '#111113',
  btnHoverColor: '#ffffff',
  btnHoverBg: 'rgba(255, 255, 255, 0.16)',
  accentBorder: 'rgba(255, 255, 255, 0.2)',
  accentBorderMedium: 'rgba(255, 255, 255, 0.28)',
}

const glassDarkInkColors: ColorPalette = {
  ...lightColors,
  containerBg: 'transparent',
  containerBgCollapsed: 'transparent',
  containerBorder: 'rgba(0, 0, 0, 0.08)',
  containerShadow: '0 18px 50px rgba(0, 0, 0, 0.16), 0 2px 10px rgba(0, 0, 0, 0.08)',
  cardShadow: '0 18px 50px rgba(0, 0, 0, 0.16), 0 2px 10px rgba(0, 0, 0, 0.08)',
  cardShadowCollapsed: '0 12px 34px rgba(0, 0, 0, 0.14), 0 2px 8px rgba(0, 0, 0, 0.08)',
  surfacePrimary: 'rgba(255, 255, 255, 0.45)',
  surfaceSecondary: 'rgba(255, 255, 255, 0.6)',
  surfaceHover: 'rgba(0, 0, 0, 0.05)',
  surfaceActive: 'rgba(0, 0, 0, 0.08)',
  inputBorder: 'rgba(0, 0, 0, 0.1)',
  inputFocusBorder: 'rgba(0, 0, 0, 0.3)',
  inputPillBg: 'transparent',
  textPrimary: 'rgba(0, 0, 0, 0.88)',
  textSecondary: 'rgba(0, 0, 0, 0.72)',
  textTertiary: 'rgba(0, 0, 0, 0.52)',
  textMuted: 'rgba(0, 0, 0, 0.28)',
  accent: '#1c1c1e',
  accentLight: 'rgba(0, 0, 0, 0.07)',
  accentSoft: 'rgba(0, 0, 0, 0.1)',
  statusIdle: 'rgba(0, 0, 0, 0.4)',
  statusRunning: '#1c1c1e',
  statusRunningBg: 'rgba(0, 0, 0, 0.07)',
  statusComplete: '#1f9d55',
  statusCompleteBg: 'rgba(31, 157, 85, 0.12)',
  statusError: '#d93a2b',
  statusErrorBg: 'rgba(217, 58, 43, 0.1)',
  statusDead: '#d93a2b',
  statusPermission: '#b7791f',
  statusPermissionGlow: 'rgba(183, 121, 31, 0.4)',
  tabActive: 'rgba(255, 255, 255, 0.6)',
  tabActiveBorder: 'rgba(0, 0, 0, 0.08)',
  tabHover: 'rgba(0, 0, 0, 0.05)',
  userBubble: 'rgba(255, 255, 255, 0.55)',
  userBubbleBorder: 'rgba(0, 0, 0, 0.07)',
  userBubbleText: 'rgba(0, 0, 0, 0.88)',
  toolBg: 'rgba(255, 255, 255, 0.4)',
  toolBorder: 'rgba(0, 0, 0, 0.08)',
  toolRunningBorder: 'rgba(0, 0, 0, 0.25)',
  toolRunningBg: 'rgba(0, 0, 0, 0.04)',
  timelineLine: 'rgba(0, 0, 0, 0.12)',
  timelineNode: 'rgba(0, 0, 0, 0.25)',
  timelineNodeActive: '#1c1c1e',
  scrollThumb: 'rgba(0, 0, 0, 0.2)',
  scrollThumbHover: 'rgba(0, 0, 0, 0.32)',
  stopBg: '#ff3b30',
  stopHover: '#e0342a',
  sendBg: '#1c1c1e',
  sendHover: '#3a3a3c',
  sendDisabled: 'rgba(0, 0, 0, 0.18)',
  popoverBg: 'rgba(255, 255, 255, 0.3)',
  popoverBorder: 'rgba(0, 0, 0, 0.08)',
  popoverShadow: '0 18px 48px rgba(0, 0, 0, 0.16), 0 2px 8px rgba(0, 0, 0, 0.08)',
  codeBg: 'rgba(255, 255, 255, 0.5)',
  micBg: 'rgba(0, 0, 0, 0.07)',
  micColor: 'rgba(0, 0, 0, 0.75)',
  micDisabled: 'rgba(0, 0, 0, 0.05)',
  placeholder: 'rgba(0, 0, 0, 0.42)',
  btnDisabled: 'rgba(0, 0, 0, 0.2)',
  textOnAccent: '#ffffff',
  btnHoverColor: 'rgba(0, 0, 0, 0.85)',
  btnHoverBg: 'rgba(255, 255, 255, 0.55)',
  accentBorder: 'rgba(0, 0, 0, 0.12)',
  accentBorderMedium: 'rgba(0, 0, 0, 0.18)',
}

const nativeGlassLightInkColors: ColorPalette = { ...glassLightInkColors, popoverBg: 'transparent' }
const nativeGlassDarkInkColors: ColorPalette = { ...glassDarkInkColors, popoverBg: 'transparent' }

function claudeColors(isDark: boolean, glass: ColorPalette | null): ColorPalette {
  return glass ?? (isDark ? darkColors : lightColors)
}

// ─── Theme store ───

export type ThemeMode = 'system' | 'light' | 'dark'

export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

export interface RulesProfile {
  id: string
  name: string
  content: string
}

interface ThemeState {
  isDark: boolean
  themeMode: ThemeMode
  soundEnabled: boolean
  expandedUI: boolean
  effort: EffortLevel
  thinkingEnabled: boolean
  liquidGlass: boolean
  reducedTransparency: boolean
  nativeGlass: boolean
  glassTone: GlassTone | null
  defaultProvider: 'claude' | 'openclaude' | 'codex'
  activeProvider: 'claude' | 'openclaude' | 'codex'
  globalRules: string
  rulesProfiles: RulesProfile[]
  activeProfileId: string | null
  freeRules: string
  _systemIsDark: boolean
  setIsDark: (isDark: boolean) => void
  setDefaultProvider: (provider: 'claude' | 'openclaude' | 'codex') => void
  setActiveProvider: (provider: 'claude' | 'openclaude' | 'codex') => void
  setThemeMode: (mode: ThemeMode) => void
  setSoundEnabled: (enabled: boolean) => void
  setExpandedUI: (expanded: boolean) => void
  setEffort: (effort: EffortLevel) => void
  setThinkingEnabled: (enabled: boolean) => void
  setLiquidGlass: (enabled: boolean) => void
  setReducedTransparency: (reduced: boolean) => void
  setNativeGlass: (supported: boolean) => void
  setGlassTone: (tone: GlassTone | null) => void
  setGlobalRules: (rules: string) => void
  setActiveProfile: (id: string | null) => void
  createProfile: (name: string) => RulesProfile | null
  updateProfileName: (id: string, name: string) => boolean
  setRulesContent: (content: string) => void
  deleteProfile: (id: string) => void
  setSystemTheme: (isDark: boolean) => void
}

/** Convert camelCase token name to --clui-kebab-case CSS custom property */
function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

/** Sync all JS design tokens to CSS custom properties on :root */
function syncTokensToCss(tokens: ColorPalette): void {
  const style = document.documentElement.style
  for (const [key, value] of Object.entries(tokens)) {
    style.setProperty(`--clui-${camelToKebab(key)}`, value)
  }
}

function applyTheme(isDark: boolean, provider?: 'claude' | 'openclaude' | 'codex', glass: ColorPalette | null = null): void {
  document.documentElement.classList.toggle('dark', isDark)
  document.documentElement.classList.toggle('light', !isDark)
  if (provider === 'codex') {
    syncTokensToCss((isDark ? codexDarkColors : codexLightColors) as unknown as ColorPalette)
  } else if (provider === 'openclaude') {
    syncTokensToCss(openclaudeDarkColors as unknown as ColorPalette)
  } else {
    syncTokensToCss(claudeColors(isDark, glass))
  }
}

export function isGlassActive(s: Pick<ThemeState, 'liquidGlass' | 'reducedTransparency' | 'activeProvider'>): boolean {
  return s.liquidGlass && !s.reducedTransparency && s.activeProvider === 'claude'
}

function glassInk(s: Pick<ThemeState, 'liquidGlass' | 'reducedTransparency' | 'activeProvider' | 'glassTone' | '_systemIsDark'>): boolean | null {
  if (!isGlassActive(s)) return null
  return s.glassTone ? s.glassTone === 'dark' : s._systemIsDark
}

function glassPalette(s: Pick<ThemeState, 'liquidGlass' | 'reducedTransparency' | 'activeProvider' | 'glassTone' | '_systemIsDark' | 'nativeGlass'>): ColorPalette | null {
  const ink = glassInk(s)
  if (ink === null) return null
  if (s.nativeGlass) return ink ? nativeGlassLightInkColors : nativeGlassDarkInkColors
  return ink ? glassLightInkColors : glassDarkInkColors
}

const SETTINGS_KEY = 'clui-settings'
const GLOBAL_RULES_KEY = 'clui-global-rules'
const RULES_V1_KEY = 'clui-rules-v1'

function loadGlobalRules(): string {
  try { return localStorage.getItem(GLOBAL_RULES_KEY) || '' } catch { return '' }
}

function saveGlobalRules(rules: string): void {
  try { localStorage.setItem(GLOBAL_RULES_KEY, rules) } catch {}
}

function loadRulesV1(): { profiles: RulesProfile[]; activeProfileId: string | null; freeRules: string } {
  try {
    const raw = localStorage.getItem(RULES_V1_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.version === 1) {
        const profiles: RulesProfile[] = Array.isArray(parsed.profiles)
          ? parsed.profiles.filter((p: unknown) => {
              const x = p as Record<string, unknown>
              return typeof x?.id === 'string' && typeof x?.name === 'string' && typeof x?.content === 'string'
            })
          : []
        const activeProfileId = typeof parsed.activeProfileId === 'string' && profiles.some((p) => p.id === parsed.activeProfileId)
          ? parsed.activeProfileId as string
          : null
        const freeRules = typeof parsed.freeRules === 'string' ? parsed.freeRules : loadGlobalRules()
        return { profiles, activeProfileId, freeRules }
      }
    }
  } catch {}
  return { profiles: [], activeProfileId: null, freeRules: loadGlobalRules() }
}

function saveRulesV1(state: { profiles: RulesProfile[]; activeProfileId: string | null; freeRules: string }): void {
  try { localStorage.setItem(RULES_V1_KEY, JSON.stringify({ version: 1, ...state })) } catch {}
}

function loadSettings(): { themeMode: ThemeMode; soundEnabled: boolean; expandedUI: boolean; effort: EffortLevel; thinkingEnabled: boolean; liquidGlass: boolean; defaultProvider: 'claude' | 'openclaude' | 'codex' } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        themeMode: ['light', 'dark', 'system'].includes(parsed.themeMode) ? parsed.themeMode : 'dark',
        soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : true,
        expandedUI: typeof parsed.expandedUI === 'boolean' ? parsed.expandedUI : false,
        effort: (['low', 'medium', 'high', 'max'] as EffortLevel[]).includes(parsed.effort) ? parsed.effort : 'medium',
        thinkingEnabled: typeof parsed.thinkingEnabled === 'boolean' ? parsed.thinkingEnabled : true,
        liquidGlass: typeof parsed.liquidGlass === 'boolean' ? parsed.liquidGlass : true,
        defaultProvider: parsed.defaultProvider === 'codex'
          ? 'codex'
          : parsed.defaultProvider === 'openclaude'
            ? 'openclaude'
            : 'claude',
      }
    }
  } catch {}
  return { themeMode: 'dark', soundEnabled: true, expandedUI: false, effort: 'medium', thinkingEnabled: true, liquidGlass: true, defaultProvider: 'claude' }
}

function saveSettings(s: { themeMode: ThemeMode; soundEnabled: boolean; expandedUI: boolean; effort: EffortLevel; thinkingEnabled: boolean; liquidGlass: boolean; defaultProvider: 'claude' | 'openclaude' | 'codex' }): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch {}
}

const saved = loadSettings()
const savedRules = loadRulesV1()

export const useThemeStore = create<ThemeState>((set, get) => ({
  isDark: saved.themeMode === 'dark' ? true : saved.themeMode === 'light' ? false : (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : true),
  themeMode: saved.themeMode,
  soundEnabled: saved.soundEnabled,
  expandedUI: saved.expandedUI,
  effort: saved.effort,
  thinkingEnabled: saved.thinkingEnabled,
  liquidGlass: saved.liquidGlass,
  reducedTransparency: typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-transparency: reduce)').matches : false,
  nativeGlass: false,
  glassTone: null,
  defaultProvider: saved.defaultProvider,
  activeProvider: saved.defaultProvider,
  globalRules: savedRules.activeProfileId !== null
    ? (savedRules.profiles.find((p) => p.id === savedRules.activeProfileId)?.content ?? savedRules.freeRules)
    : savedRules.freeRules,
  rulesProfiles: savedRules.profiles,
  activeProfileId: savedRules.activeProfileId,
  freeRules: savedRules.freeRules,
  _systemIsDark: typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : true,
  setDefaultProvider: (provider) => {
    set({ defaultProvider: provider })
    const s = get()
    saveSettings({ themeMode: s.themeMode, soundEnabled: s.soundEnabled, expandedUI: s.expandedUI, effort: s.effort, thinkingEnabled: s.thinkingEnabled, liquidGlass: s.liquidGlass, defaultProvider: provider })
  },
  setActiveProvider: (provider) => {
    const s = get()
    set({ activeProvider: provider })
    const palette = provider === 'codex'
      ? (s.isDark ? codexDarkColors : codexLightColors)
      : provider === 'openclaude'
      ? openclaudeDarkColors
      : claudeColors(s.isDark, glassPalette({ ...s, activeProvider: provider }))
    syncTokensToCss(palette as unknown as ColorPalette)
  },
  setIsDark: (isDark) => {
    set({ isDark })
    const active = get().activeProvider
    const provider = active === 'openclaude' ? undefined : active
    applyTheme(isDark, provider, glassPalette(get()))
  },
  setThemeMode: (mode) => {
    const resolved = mode === 'system' ? get()._systemIsDark : mode === 'dark'
    set({ themeMode: mode, isDark: resolved })
    const active = get().activeProvider
    const provider = active === 'openclaude' ? undefined : active
    applyTheme(resolved, provider, glassPalette(get()))
    const s = get()
    saveSettings({ themeMode: mode, soundEnabled: s.soundEnabled, expandedUI: s.expandedUI, effort: s.effort, thinkingEnabled: s.thinkingEnabled, liquidGlass: s.liquidGlass, defaultProvider: s.defaultProvider })
  },
  setSoundEnabled: (enabled) => {
    set({ soundEnabled: enabled })
    const s = get()
    saveSettings({ themeMode: s.themeMode, soundEnabled: enabled, expandedUI: s.expandedUI, effort: s.effort, thinkingEnabled: s.thinkingEnabled, liquidGlass: s.liquidGlass, defaultProvider: s.defaultProvider })
  },
  setExpandedUI: (expanded) => {
    set({ expandedUI: expanded })
    const s = get()
    saveSettings({ themeMode: s.themeMode, soundEnabled: s.soundEnabled, expandedUI: expanded, effort: s.effort, thinkingEnabled: s.thinkingEnabled, liquidGlass: s.liquidGlass, defaultProvider: s.defaultProvider })
  },
  setEffort: (effort) => {
    set({ effort })
    const s = get()
    saveSettings({ themeMode: s.themeMode, soundEnabled: s.soundEnabled, expandedUI: s.expandedUI, effort, thinkingEnabled: s.thinkingEnabled, liquidGlass: s.liquidGlass, defaultProvider: s.defaultProvider })
  },
  setThinkingEnabled: (thinkingEnabled) => {
    set({ thinkingEnabled })
    const s = get()
    saveSettings({ themeMode: s.themeMode, soundEnabled: s.soundEnabled, expandedUI: s.expandedUI, effort: s.effort, thinkingEnabled, liquidGlass: s.liquidGlass, defaultProvider: s.defaultProvider })
  },
  setLiquidGlass: (liquidGlass) => {
    set({ liquidGlass })
    const s = get()
    if (s.activeProvider === 'claude') applyTheme(s.isDark, 'claude', glassPalette(s))
    saveSettings({ themeMode: s.themeMode, soundEnabled: s.soundEnabled, expandedUI: s.expandedUI, effort: s.effort, thinkingEnabled: s.thinkingEnabled, liquidGlass, defaultProvider: s.defaultProvider })
  },
  setReducedTransparency: (reducedTransparency) => {
    if (get().reducedTransparency === reducedTransparency) return
    set({ reducedTransparency })
    const s = get()
    if (s.activeProvider === 'claude') applyTheme(s.isDark, 'claude', glassPalette(s))
  },
  setNativeGlass: (nativeGlass) => {
    if (get().nativeGlass === nativeGlass) return
    set({ nativeGlass })
    const s = get()
    if (s.activeProvider === 'claude') applyTheme(s.isDark, 'claude', glassPalette(s))
  },
  setGlassTone: (glassTone) => {
    if (get().glassTone === glassTone) return
    set({ glassTone })
    const s = get()
    if (s.activeProvider === 'claude') applyTheme(s.isDark, 'claude', glassPalette(s))
  },
  setGlobalRules: (rules) => {
    get().setRulesContent(rules)
  },
  setActiveProfile: (id) => {
    const { rulesProfiles, freeRules } = get()
    if (id === null) {
      set({ activeProfileId: null, globalRules: freeRules })
      saveRulesV1({ profiles: rulesProfiles, activeProfileId: null, freeRules })
    } else {
      const profile = rulesProfiles.find((p) => p.id === id)
      if (!profile) return
      set({ activeProfileId: id, globalRules: profile.content })
      saveRulesV1({ profiles: rulesProfiles, activeProfileId: id, freeRules })
    }
  },
  createProfile: (name) => {
    const trimmed = name.trim()
    if (!trimmed) return null
    const { rulesProfiles, freeRules } = get()
    if (rulesProfiles.some((p) => p.name.trim().toLowerCase() === trimmed.toLowerCase())) return null
    const newProfile: RulesProfile = { id: crypto.randomUUID(), name: trimmed, content: '' }
    const newProfiles = [...rulesProfiles, newProfile]
    set({ rulesProfiles: newProfiles, activeProfileId: newProfile.id, globalRules: '' })
    saveRulesV1({ profiles: newProfiles, activeProfileId: newProfile.id, freeRules })
    return newProfile
  },
  updateProfileName: (id, name) => {
    const trimmed = name.trim()
    if (!trimmed) return false
    const { rulesProfiles, activeProfileId, freeRules } = get()
    if (!rulesProfiles.some((p) => p.id === id)) return false
    if (rulesProfiles.some((p) => p.id !== id && p.name.trim().toLowerCase() === trimmed.toLowerCase())) return false
    const newProfiles = rulesProfiles.map((p) => p.id === id ? { ...p, name: trimmed } : p)
    set({ rulesProfiles: newProfiles })
    saveRulesV1({ profiles: newProfiles, activeProfileId, freeRules })
    return true
  },
  setRulesContent: (content) => {
    const { activeProfileId, rulesProfiles, freeRules } = get()
    if (activeProfileId === null) {
      set({ globalRules: content, freeRules: content })
      saveRulesV1({ profiles: rulesProfiles, activeProfileId: null, freeRules: content })
      saveGlobalRules(content)
    } else {
      const profileExists = rulesProfiles.some((p) => p.id === activeProfileId)
      if (!profileExists) {
        set({ activeProfileId: null, globalRules: freeRules })
        saveRulesV1({ profiles: rulesProfiles, activeProfileId: null, freeRules })
        return
      }
      const newProfiles = rulesProfiles.map((p) => p.id === activeProfileId ? { ...p, content } : p)
      set({ rulesProfiles: newProfiles, globalRules: content })
      saveRulesV1({ profiles: newProfiles, activeProfileId, freeRules })
    }
  },
  deleteProfile: (id) => {
    const { rulesProfiles, activeProfileId, freeRules } = get()
    const newProfiles = rulesProfiles.filter((p) => p.id !== id)
    if (activeProfileId === id) {
      set({ rulesProfiles: newProfiles, activeProfileId: null, globalRules: freeRules })
      saveRulesV1({ profiles: newProfiles, activeProfileId: null, freeRules })
    } else {
      set({ rulesProfiles: newProfiles })
      saveRulesV1({ profiles: newProfiles, activeProfileId, freeRules })
    }
  },
  setSystemTheme: (isDark) => {
    const s = get()
    if (s._systemIsDark === isDark) return
    if (s.themeMode === 'system') {
      set({ _systemIsDark: isDark, isDark })
      const provider = s.activeProvider === 'openclaude' ? undefined : s.activeProvider
      applyTheme(isDark, provider, glassPalette(get()))
    } else {
      set({ _systemIsDark: isDark })
      const next = get()
      if (next.activeProvider === 'claude' && isGlassActive(next)) applyTheme(next.isDark, 'claude', glassPalette(next))
    }
  },
}))

// Initialize CSS vars with saved theme
const initialIsDark = saved.themeMode === 'dark' ? true : saved.themeMode === 'light' ? false : (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : true)
syncTokensToCss(claudeColors(initialIsDark, glassPalette(useThemeStore.getState())))

function syncGlassClass(s: ThemeState): void {
  if (typeof document === 'undefined') return
  const active = isGlassActive(s)
  document.documentElement.classList.toggle('clui-glass', active)
  document.documentElement.classList.toggle('clui-glass-light-ink', glassInk(s) === true)
  document.documentElement.classList.toggle('clui-glass-native', active && s.nativeGlass)
}

syncGlassClass(useThemeStore.getState())
useThemeStore.subscribe(syncGlassClass)

if (typeof window !== 'undefined' && window.matchMedia) {
  try {
    window.matchMedia('(prefers-reduced-transparency: reduce)').addEventListener('change', (e) => {
      useThemeStore.getState().setReducedTransparency(e.matches)
    })
  } catch {}
}

export function useGlassActive(): boolean {
  return useThemeStore(isGlassActive)
}

export function useColors(): ColorPalette {
  const isDark = useThemeStore((s) => s.isDark)
  const provider = useThemeStore((s) => s.activeProvider)
  const glass = useThemeStore(glassPalette)
  if (provider === 'codex') {
    return (isDark ? codexDarkColors : codexLightColors) as unknown as ColorPalette
  }
  if (provider === 'openclaude') {
    return openclaudeDarkColors as unknown as ColorPalette
  }
  return claudeColors(isDark, glass)
}

export function getColors(isDark: boolean, provider?: 'claude' | 'openclaude' | 'codex'): ColorPalette {
  if (provider === 'codex') {
    return (isDark ? codexDarkColors : codexLightColors) as unknown as ColorPalette
  }
  if (provider === 'openclaude') {
    return openclaudeDarkColors as unknown as ColorPalette
  }
  return isDark ? darkColors : lightColors
}

// ─── Backward compatibility ───
// Legacy static export — components being migrated should use useColors() instead
export const colors = darkColors

// ─── Spacing ───

export const spacing = {
  contentWidth: 460,
  containerRadius: 20,
  containerPadding: 12,
  tabHeight: 32,
  inputMinHeight: 44,
  inputMaxHeight: 160,
  conversationMaxHeight: 380,
  pillRadius: 9999,
  circleSize: 36,
  circleGap: 8,
} as const

// ─── Animation ───

export const motion = {
  spring: { type: 'spring' as const, stiffness: 500, damping: 30 },
  easeOut: { duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] as const },
  fadeIn: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
    transition: { duration: 0.15 },
  },
} as const
