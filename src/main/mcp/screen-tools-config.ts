import { existsSync } from 'fs'
import { join } from 'path'

export const SCREEN_TOOLS_MCP_NAME = 'clui_screen_tools'

export interface ScreenToolsMcpConfig {
  name: string
  type: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
}

function resolveServerScriptPath(): string {
  const candidates = [
    join(process.resourcesPath || '', 'mcp', 'screen-tools-server.cjs'),
    join(process.cwd(), 'resources', 'mcp', 'screen-tools-server.cjs'),
    join(__dirname, '..', '..', '..', 'resources', 'mcp', 'screen-tools-server.cjs'),
    join(__dirname, '..', '..', '..', '..', 'resources', 'mcp', 'screen-tools-server.cjs'),
  ]

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[1]
}

export function getScreenToolsMcpConfig(): ScreenToolsMcpConfig {
  return {
    name: SCREEN_TOOLS_MCP_NAME,
    type: 'stdio',
    command: process.execPath,
    args: [resolveServerScriptPath()],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
    },
  }
}
