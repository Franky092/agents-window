export type AgentRow = {
  id: string
  name: string
  type: string
  task: string
  status: string
  seenAt: number
  endedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'agents-window': { rows: AgentRow[]; now: number }
  }
}
