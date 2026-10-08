export type NativeToolCategory =
  | 'filesystem'
  | 'shell'
  | 'search'
  | 'web'
  | 'planning'
  | 'agent'
  | 'interaction'
  | 'mcp'
  | 'workflow'

export interface NativeToolDefinition {
  name: string
  category: NativeToolCategory
  readOnly: boolean
  requiresUserInteraction: boolean
  concurrencySafe: boolean
}

export const NATIVE_TOOL_REGISTRY: NativeToolDefinition[] = [
  { name: 'AskUserQuestion', category: 'interaction', readOnly: true, requiresUserInteraction: true, concurrencySafe: true },
  { name: 'Bash', category: 'shell', readOnly: false, requiresUserInteraction: false, concurrencySafe: false },
  { name: 'Read', category: 'filesystem', readOnly: true, requiresUserInteraction: false, concurrencySafe: true },
  { name: 'Write', category: 'filesystem', readOnly: false, requiresUserInteraction: false, concurrencySafe: false },
  { name: 'Edit', category: 'filesystem', readOnly: false, requiresUserInteraction: false, concurrencySafe: false },
  { name: 'MultiEdit', category: 'filesystem', readOnly: false, requiresUserInteraction: false, concurrencySafe: false },
  { name: 'NotebookEdit', category: 'filesystem', readOnly: false, requiresUserInteraction: false, concurrencySafe: false },
  { name: 'Glob', category: 'search', readOnly: true, requiresUserInteraction: false, concurrencySafe: true },
  { name: 'Grep', category: 'search', readOnly: true, requiresUserInteraction: false, concurrencySafe: true },
  { name: 'LS', category: 'filesystem', readOnly: true, requiresUserInteraction: false, concurrencySafe: true },
  { name: 'WebFetch', category: 'web', readOnly: true, requiresUserInteraction: false, concurrencySafe: true },
  { name: 'WebSearch', category: 'web', readOnly: true, requiresUserInteraction: false, concurrencySafe: true },
  { name: 'TodoWrite', category: 'planning', readOnly: false, requiresUserInteraction: false, concurrencySafe: true },
  { name: 'EnterPlanMode', category: 'planning', readOnly: true, requiresUserInteraction: true, concurrencySafe: true },
  { name: 'ExitPlanMode', category: 'planning', readOnly: true, requiresUserInteraction: true, concurrencySafe: true },
  { name: 'Compact', category: 'workflow', readOnly: false, requiresUserInteraction: false, concurrencySafe: false },
  { name: 'Agent', category: 'agent', readOnly: false, requiresUserInteraction: false, concurrencySafe: false },
  { name: 'Task', category: 'agent', readOnly: false, requiresUserInteraction: false, concurrencySafe: false },
  { name: 'TaskOutput', category: 'agent', readOnly: true, requiresUserInteraction: false, concurrencySafe: true },
  { name: 'ListMcpResources', category: 'mcp', readOnly: true, requiresUserInteraction: false, concurrencySafe: true },
  { name: 'ReadMcpResource', category: 'mcp', readOnly: true, requiresUserInteraction: false, concurrencySafe: true },
  { name: 'ToolSearch', category: 'workflow', readOnly: true, requiresUserInteraction: false, concurrencySafe: true },
  { name: 'Skill', category: 'workflow', readOnly: true, requiresUserInteraction: false, concurrencySafe: true },
]

export function getNativeToolNames(): string[] {
  return NATIVE_TOOL_REGISTRY.map((tool) => tool.name)
}
