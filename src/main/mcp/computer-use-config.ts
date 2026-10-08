import { existsSync } from 'fs'
import { join } from 'path'

export const COMPUTER_USE_MCP_NAME = 'clui_computer_use'

export interface ComputerUseMcpConfig {
  name: string
  type: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
}

function resolveServerScriptPath(): string {
  const candidates = [
    join(process.resourcesPath || '', 'mcp', 'computer-use-server.cjs'),
    join(process.cwd(), 'resources', 'mcp', 'computer-use-server.cjs'),
    join(__dirname, '..', '..', '..', 'resources', 'mcp', 'computer-use-server.cjs'),
    join(__dirname, '..', '..', '..', '..', 'resources', 'mcp', 'computer-use-server.cjs'),
  ]

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[1]
}

export function getComputerUseMcpConfig(): ComputerUseMcpConfig {
  return {
    name: COMPUTER_USE_MCP_NAME,
    type: 'stdio',
    command: process.execPath,
    args: [resolveServerScriptPath()],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
    },
  }
}
