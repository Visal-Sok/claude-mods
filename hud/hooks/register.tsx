import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Hud, HudMeter } from '../types'

const REFRESH_MS = 5000
const BAR_CELLS = 5
const LIVE_AGENT = new Set(['pending', 'running', 'waiting'])
// The mod whose /later the pane button runs; the button shows only while it is installed
const LATER_PLUGIN = 'later'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
// The hud line's width: the terminal's, less the footer's indent and a margin.
const DEFAULT_COLUMNS = 120
const EDGE_COLUMNS = 4
const MIN_COLUMNS = 40

// Tokyo Night, matching the tmux popups and the later pane.
const THEME = {
  fg: '#c0caf5',
  muted: '#565f89',
  border: '#3b4261',
  blue: '#7aa2f7',
  cyan: '#7dcfff',
  green: '#9ece6a',
  yellow: '#e0af68',
  red: '#f7768e',
  purple: '#bb9af7',
} as const

const hud = atom({ plugin: 'hud', key: 'hud' } as const, null)

// "claude-opus-5-5[1m]" or "Opus 5.5 (1M context)" -> "Opus 5.5 1M"
export function shortModel(model: string): string {
  const id = model.match(/^claude-([a-z]+)-(\d+)-(\d+)(?:\[(\w+)\])?/i)
  if (id) {
    const [, family = '', major, minor, window] = id
    const name = `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`
    return window ? `${name} ${window.toUpperCase()}` : name
  }
  return model.replace(/\s*\((\S+) context\)/i, ' $1').trim()
}

export function meterColor(percent: number): string {
  if (percent >= 80) return THEME.red
  if (percent >= 50) return THEME.yellow
  return THEME.green
}

export function bar(percent: number): string {
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.round((percent / 100) * BAR_CELLS)))
  return '▰'.repeat(filled) + '▱'.repeat(BAR_CELLS - filled)
}

export function tildePath(path: string, home: string | undefined): string {
  if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`
  return path
}

// Time until a reset, two units at most: "2h13m", "3d4h", "9m".
export function countdown(ms: number): string {
  if (ms <= 0) return 'now'
  if (ms >= DAY) return `${Math.floor(ms / DAY)}d${Math.floor((ms % DAY) / HOUR)}h`
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)}h${Math.floor((ms % HOUR) / MINUTE)}m`
  return `${Math.max(1, Math.floor(ms / MINUTE))}m`
}

async function git($: EngineInterface, args: string[]): Promise<string | null> {
  try {
    const run = await $.process.run(['git', ...args])
    return run.exitCode === 0 ? run.stdout.trim() : null
  } catch {
    return null
  }
}

async function refresh($: EngineInterface) {
  const [model, usage, cwd, home, agents, commands, branch, status] = await Promise.all([
    $.session.model(),
    $.session.usage(),
    $.session.cwd(),
    $.env.get('HOME'),
    $.agent.list(),
    $.command.list(),
    git($, ['branch', '--show-current']),
    git($, ['status', '--porcelain']),
  ])
  const limit = (kind: string): HudMeter | null => {
    const window = usage.rateLimits.find(one => one.kind === kind)
    if (window === undefined) return null
    const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : NaN
    return { percent: window.percentUsed, resetsAt: Number.isNaN(resetsAt) ? null : resetsAt }
  }
  const next: Hud = {
    model: shortModel(model),
    dir: tildePath(cwd, home),
    branch: branch ?? '',
    isDirty: (status ?? '') !== '',
    contextPercent: usage.context.percent ?? null,
    fiveHour: limit('five_hour'),
    weekly: limit('seven_day'),
    runningAgents: agents.filter(agent => LIVE_AGENT.has(agent.status)).length,
    hasLater: commands.some(command => command.name === 'later' && command.plugin === LATER_PLUGIN),
  }
  await update($, hud, () => next)
}

async function refreshQuietly($: EngineInterface) {
  try {
    await refresh($)
  } catch (error) {
    $.ui.log(`hud: ${(error as Error).message}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refreshQuietly($)
    $.clock.every(REFRESH_MS, () => void refreshQuietly($))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refreshQuietly($)
    return result
  })

  // Draws in the old status line's place: the hud, then the engine's hint row.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const hint = await next(e)
    const state = await read($, hud)
    if (state === null) return hint

    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const width = Math.max(MIN_COLUMNS, (e.viewport?.columns ?? DEFAULT_COLUMNS) - EDGE_COLUMNS)
    const sep = <Text color={THEME.border}>{' │ '}</Text>
    const meter = (label: string, percent: number | null, resetsAt: number | null = null) =>
      percent !== null && (
        <Text>
          {sep}
          <Text color={THEME.muted}>{`${label} `}</Text>
          <Text color={meterColor(percent)}>{`${bar(percent)} ${Math.round(percent)}%`}</Text>
          {resetsAt !== null && <Text color={THEME.muted}>{` ↻ ${countdown(resetsAt - now)}`}</Text>}
        </Text>
      )
    const agents = state.runningAgents

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" gap={2} width={width}>
          <Box flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={THEME.muted}>{'['}</Text>
              <Text color={THEME.cyan}>{state.dir}</Text>
              {state.branch !== '' && (
                <Text>
                  <Text color={THEME.muted}>{': '}</Text>
                  <Text color={THEME.blue}>{state.branch}</Text>
                  {state.isDirty && <Text color={THEME.yellow}>{'*'}</Text>}
                </Text>
              )}
              <Text color={THEME.muted}>{']'}</Text>
              {meter('Ctx', state.contextPercent)}
              {meter('5H', state.fiveHour?.percent ?? null, state.fiveHour?.resetsAt)}
              {meter('Weekly', state.weekly?.percent ?? null, state.weekly?.resetsAt)}
              {sep}
              <Text color={THEME.muted}>{'Agents '}</Text>
              <Text color={agents > 0 ? THEME.yellow : THEME.muted} bold={agents > 0}>
                {String(agents)}
              </Text>
            </Text>
          </Box>
          <Box key="actions" flexDirection="row" flexShrink={0} gap={1}>
            {state.hasLater && (
              <Button
                key="later"
                plain
                hover={{ color: THEME.blue }}
                onPress={() => $.command.run({ command: 'later' })}
              >
                <Text color={THEME.purple}>{'󰃀'}</Text>
              </Button>
            )}
            <Text color={THEME.purple} bold>{state.model}</Text>
          </Box>
        </Box>
        {hint}
      </Box>
    )
  })
}
