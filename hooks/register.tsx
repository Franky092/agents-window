import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentRow } from '../types'

const PANE = 'agents-window'
const rows = atom({ plugin: 'agents-window', key: 'rows' } as const, [] as AgentRow[])
const clock = atom({ plugin: 'agents-window', key: 'now' } as const, 0)

const LOOK: Record<string, { dot: string; color: string; label: string }> = {
  running: { dot: '●', color: '#4ade80', label: 'работает' },
  pending: { dot: '◌', color: '#fbbf24', label: 'запуск' },
  waiting: { dot: '◐', color: '#60a5fa', label: 'ждёт' },
  idle: { dot: '○', color: '#94a3b8', label: 'простаивает' },
  completed: { dot: '✓', color: '#a78bfa', label: 'готово' },
  failed: { dot: '✕', color: '#f87171', label: 'ошибка' },
  killed: { dot: '■', color: '#f87171', label: 'остановлен' },
}
const LIVE = new Set(['running', 'pending', 'waiting'])

const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s}с` : `${Math.floor(s / 60)}м ${String(s % 60).padStart(2, '0')}с`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agents',
      description: 'Открыть окно с активными агентами',
    })
    void $.ui.open({ id: PANE, title: 'Агенты' })

    $.clock.every(1000, async () => {
      const now = await $.clock.now()
      const list = await $.agent.list()
      const old = await read($, rows)
      const fresh: AgentRow[] = list.map(a => {
        const prev = old.find(r => r.id === a.id)
        const ended = !LIVE.has(a.status) && a.status !== 'idle'
        return {
          id: a.id,
          name: a.name ?? a.type,
          type: a.type,
          task: a.description,
          status: a.status,
          seenAt: prev?.seenAt ?? now,
          endedAt: ended ? (prev?.endedAt ?? now) : undefined,
        }
      })
      // keep finished agents on screen for a minute after the engine drops them
      for (const r of old) {
        if (!fresh.some(n => n.id === r.id) && now - (r.endedAt ?? now) < 60000) {
          fresh.push({ ...r, status: LIVE.has(r.status) ? 'completed' : r.status, endedAt: r.endedAt ?? now })
        }
      }
      await update($, rows, () => fresh.slice(-30))
      await update($, clock, () => now)
    })

    return next(e)
  })

  on('command.run', { command: 'agents' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Агенты' })
    return { text: 'Окно агентов открыто.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, rows)
    const now = await read($, clock)
    const live = list.filter(r => LIVE.has(r.status)).length
    const sorted = [...list].sort((a, b) => Number(LIVE.has(b.status)) - Number(LIVE.has(a.status)))

    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Box justifyContent="space-between">
          <Text bold size="heading">Агенты</Text>
          <Text color={live ? '#4ade80' : undefined} dimColor={!live}>
            {live ? `● ${live} активн.` : '○ все свободны'}
          </Text>
        </Box>

        {sorted.length === 0 && (
          <Box borderStyle="round" borderDimColor paddingX={2} paddingY={1} flexDirection="column">
            <Text dimColor>Пока нет агентов.</Text>
            <Text dimColor>Они появятся здесь, как только запустятся.</Text>
          </Box>
        )}

        {sorted.map(r => {
          const look = LOOK[r.status] ?? LOOK.idle
          const live = LIVE.has(r.status)
          return (
            <Box
              key={r.id}
              borderStyle="round"
              borderColor={look.color}
              borderDimColor={!live}
              paddingX={2}
              flexDirection="column"
            >
              <Box justifyContent="space-between">
                <Text bold color={look.color}>{look.dot} {r.name}</Text>
                <Text dimColor>{elapsed((r.endedAt ?? now) - r.seenAt)}</Text>
              </Box>
              <Text dimColor>{r.type} · {look.label}</Text>
              {r.task ? <Text>{r.task}</Text> : null}
            </Box>
          )
        })}
      </Box>
    )
  })
}
