import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentRow, FeedItem } from '../types'

const PANE = 'agents-window'
const rows = atom({ plugin: 'agents-window', key: 'rows' } as const, [] as AgentRow[])
const clock = atom({ plugin: 'agents-window', key: 'now' } as const, 0)
const models = atom({ plugin: 'agents-window', key: 'models' } as const, {} as Record<string, string>)
const feed = atom({ plugin: 'agents-window', key: 'feed' } as const, {} as Record<string, FeedItem[]>)
const selected = atom({ plugin: 'agents-window', key: 'selected' } as const, '')
const MAIN = 'main'

const short = (m: string) => m.replace(/^claude-/, '')
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const summarize = (e: Record<string, unknown>) => {
  const src = { ...((e.input as Record<string, unknown>) ?? {}), ...e }
  for (const k of ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description', 'prompt']) {
    if (typeof src[k] === 'string' && src[k]) return clip(String(src[k]).replace(/\s+/g, ' '), 90)
  }
  return ''
}

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
      name: 'agents-window',
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

  on('agent.spawn', async ($, e, next) => {
    const res = await next(e)
    if (res && 'agentId' in res && res.agentId) {
      const id = res.agentId
      await update($, models, m => ({ ...m, [id]: res.model }))
    }
    return res
  })

  on('turn.step', async function* ($, e, next) {
    const id = e.agentId ?? MAIN
    await update($, models, m => (m[id] === e.model ? m : { ...m, [id]: e.model }))
    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const item: FeedItem = {
      id: e.tool_use_id,
      at: await $.clock.now(),
      tool: e.tool,
      what: summarize(e as unknown as Record<string, unknown>),
      isDone: false,
    }
    await update($, feed, f => ({ ...f, [id]: [...(f[id] ?? []), item].slice(-40) }))
    const ran = await next(e)
    await update($, feed, f => ({
      ...f,
      [id]: (f[id] ?? []).map(x => (x.id === item.id ? { ...x, isDone: true } : x)),
    }))
    return ran
  })

  on('command.run', { command: 'agents-window' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Агенты' })
    return { text: 'Окно агентов открыто.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const rowsNow = await read($, rows)
    const now = await read($, clock)
    const modelOf = await read($, models)
    const feedOf = await read($, feed)
    const pick = await read($, selected)

    const mainRow: AgentRow = {
      id: MAIN, name: 'Главный', type: 'сессия', task: '', status: 'running', seenAt: now,
    }
    const all = [mainRow, ...rowsNow]
    const live = all.filter(r => r.id !== MAIN && LIVE.has(r.status)).length
    const sorted = [...all].sort((a, b) => Number(LIVE.has(b.status)) - Number(LIVE.has(a.status)))

    const chosen = all.find(r => r.id === pick)
    if (chosen) {
      const look = LOOK[chosen.status] ?? LOOK.idle
      const items = (feedOf[chosen.id] ?? []).slice(-Math.max(3, (e.viewport?.rows ?? 24) - 10)).reverse()
      return (
        <Box flexDirection="column" gap={1} padding={1}>
          <Button key="back" label="‹ Назад" onPress={() => update($, selected, () => '')} />
          <Box borderStyle="round" borderColor={look.color} paddingX={2} flexDirection="column">
            <Text bold color={look.color}>{look.dot} {chosen.name}</Text>
            <Text dimColor>{chosen.type} · {look.label}</Text>
            <Text>Модель: <Text bold>{modelOf[chosen.id] ? short(modelOf[chosen.id]) : 'ещё не известна'}</Text></Text>
            {chosen.task ? <Text>{chosen.task}</Text> : null}
          </Box>
          <Text bold>Что делает</Text>
          {items.length === 0 && <Text dimColor>Пока ничего не запускал.</Text>}
          {items.map(it => (
            <Box key={it.id} flexDirection="column">
              <Text color={it.isDone ? undefined : '#4ade80'} dimColor={it.isDone}>
                {it.isDone ? '✓' : '▸'} {it.tool} <Text dimColor>· {elapsed(now - it.at)} назад</Text>
              </Text>
              {it.what ? <Text dimColor>   {it.what}</Text> : null}
            </Box>
          ))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Box justifyContent="space-between">
          <Text bold size="heading">Агенты</Text>
          <Text color={live ? '#4ade80' : undefined} dimColor={!live}>
            {live ? `● ${live} активн.` : '○ все свободны'}
          </Text>
        </Box>

        {sorted.map(r => {
          const look = LOOK[r.status] ?? LOOK.idle
          const isLive = LIVE.has(r.status)
          const last = (feedOf[r.id] ?? []).slice(-1)[0]
          const m = modelOf[r.id]
          return (
            <Box
              key={r.id}
              borderStyle="round"
              borderColor={look.color}
              borderDimColor={!isLive}
              paddingX={2}
              flexDirection="column"
            >
              <Box justifyContent="space-between">
                <Text bold color={look.color}>{look.dot} {r.name}</Text>
                <Text dimColor>{r.id === MAIN ? '' : elapsed((r.endedAt ?? now) - r.seenAt)}</Text>
              </Box>
              <Text dimColor>{r.type} · {look.label} · {m ? short(m) : 'модель ?'}</Text>
              {r.task ? <Text>{r.task}</Text> : null}
              {last ? <Text dimColor>{last.isDone ? '✓' : '▸'} {last.tool} {last.what}</Text> : null}
              <Button key={`open-${r.id}`} label="Подробнее ›" onPress={() => update($, selected, () => r.id)} />
            </Box>
          )
        })}
      </Box>
    )
  })
}
