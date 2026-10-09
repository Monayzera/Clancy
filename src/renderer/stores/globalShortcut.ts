import { useThemeStore } from '../theme'

export function initGlobalShortcut(): () => void {
  const api = window.clui
  if (api?.platform !== 'linux' || !api.setGlobalShortcut || !api.onGlobalShortcutStatus) return () => {}

  let last: string | null | undefined

  const sync = () => {
    const state = useThemeStore.getState()
    const accelerator = state.linuxShortcutRecording ? null : state.linuxShortcut
    if (accelerator === last) return
    last = accelerator
    api.setGlobalShortcut(accelerator)
  }

  const unsubscribeStatus = api.onGlobalShortcutStatus((status) => useThemeStore.getState().setLinuxShortcutStatus(status))
  const unsubscribe = useThemeStore.subscribe(sync)
  sync()

  return () => {
    unsubscribe()
    unsubscribeStatus()
  }
}
