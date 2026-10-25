export type AgentRow = {
  id: string
  name: string
  type: string
  task: string
  status: string
  seenAt: number
  endedAt?: number
}

export type FeedItem = { id: string; at: number; tool: string; what: string; isDone: boolean }

declare module 'claude-code' {
  interface PluginState {
    'agents-window': {
      rows: AgentRow[]
      now: number
      models: Record<string, string>
      feed: Record<string, FeedItem[]>
      selected: string
    }
  }
}
