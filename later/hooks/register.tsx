import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Todo } from '../types'
import { loadTodos, mtimeOf, saveTodos, storagePath } from './storage'

const PANE = 'later'
const LEGACY_PREFIX = 'later:'
const POLL_MS = 2000
const MAX_HOTKEYS = 9

// Tokyo Night, matching the tmux popups.
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

const TICKET = /\b[A-Z][A-Z0-9]+-\d+\b/g
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function age(ms: number): string {
  if (ms < MINUTE) return 'just now'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`
  return `${Math.floor(ms / DAY)}d ago`
}

// Splits text around ticket keys (JIRA-123) so they can be highlighted.
function splitTickets(text: string): { text: string; isTicket: boolean }[] {
  const parts: { text: string; isTicket: boolean }[] = []
  let last = 0
  for (const match of text.matchAll(TICKET)) {
    const at = match.index ?? 0
    if (at > last) parts.push({ text: text.slice(last, at), isTicket: false })
    parts.push({ text: match[0], isTicket: true })
    last = at + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), isTicket: false })
  return parts
}

const todos = atom({ plugin: 'later', key: 'todos' } as const, [])
const root = atom({ plugin: 'later', key: 'root' } as const, '')
const file = atom({ plugin: 'later', key: 'file' } as const, '')

// The file's mtime as this session last read or wrote it.
let seenMtime = 0

// The repo's top level, so a subdirectory shares its repo's list; else the cwd.
async function findRoot($: EngineInterface): Promise<string> {
  try {
    const git = await $.process.run(['git', 'rev-parse', '--show-toplevel'])
    if (git.exitCode === 0 && git.stdout.trim() !== '') return git.stdout.trim()
  } catch {
    // git missing or refused: fall back to the session's directory
  }
  return $.session.cwd()
}

async function openPane($: EngineInterface, count: number) {
  return $.ui.open({ id: PANE, title: `Later (${count})` })
}

async function isPaneOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

// Shows a list: opens the pane when it grew, retitles it, closes it when empty.
async function show($: EngineInterface, before: readonly Todo[], after: Todo[]) {
  await update($, todos, () => after)
  if (after.length === 0) await $.ui.close({ id: PANE })
  else if (after.length > before.length || (await isPaneOpen($))) await openPane($, after.length)
}

// Read-modify-write against the file, so another session's changes are kept.
async function mutate($: EngineInterface, change: (list: Todo[]) => Todo[]) {
  const path = await read($, file)
  const before = await loadTodos($, path)
  const after = change(before)
  await saveTodos($, path, await read($, root), after)
  seenMtime = await mtimeOf($, path)
  await show($, await read($, todos), after)
  return { before, after }
}

// Picks up what other sessions wrote since this one last looked.
async function sync($: EngineInterface) {
  const path = await read($, file)
  const mtime = await mtimeOf($, path)
  if (mtime === seenMtime) return
  seenMtime = mtime
  try {
    await show($, await read($, todos), await loadTodos($, path))
  } catch (error) {
    $.ui.log(`later: ${(error as Error).message}`)
  }
}

// Moves a list kept by the first version of this mod into the file.
async function migrate($: EngineInterface, dir: string) {
  const legacy = await $.store.get(LEGACY_PREFIX + dir)
  if (!Array.isArray(legacy) || legacy.length === 0) return
  await mutate($, list => [...list, ...(legacy as Todo[])])
  await $.store.delete(LEGACY_PREFIX + dir)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'later',
      description: 'Stash a task for this repo without running it; bare /later toggles the list',
      argumentHint: '[task]',
      immediate: true,
    })

    const dir = await findRoot($)
    await update($, root, () => dir)
    const path = await storagePath($, dir)
    await update($, file, () => path)
    await migrate($, dir)
    await sync($)
    $.clock.every(POLL_MS, () => void sync($))

    return next(e)
  })

  on('command.run', { command: 'later' }, async ($, e) => {
    const text = e.args.trim()

    // Bare /later toggles the pane; it opens on its empty state too.
    if (text === '') {
      if (await isPaneOpen($)) {
        await $.ui.close({ id: PANE })
        return { text: 'Later pane closed.' }
      }
      await sync($)
      const list = await read($, todos)
      await openPane($, list.length)
      return { text: list.length === 0 ? 'Nothing stashed for this repo.' : `${list.length} stashed for later.` }
    }

    const todo: Todo = { id: crypto.randomUUID(), text, createdAt: await $.clock.now() }
    try {
      const { after } = await mutate($, list => [...list, todo])
      await openPane($, after.length)
      return { text: `Stashed for later (${after.length} pending).` }
    } catch (error) {
      return { text: `Not stashed: ${(error as Error).message}` }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, todos)
    const repo = (await read($, root)).split('/').pop() || '~'
    const now = await $.clock.now()

    const drop = (id: string) => mutate($, list => list.filter(todo => todo.id !== id))
    // Only the session whose write removed the task starts it.
    const start = async (id: string) => {
      const { before } = await drop(id)
      const todo = before.find(one => one.id === id)
      if (todo !== undefined) await $.prompt.submit({ text: todo.text, asUser: true })
    }

    const header = (
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Text>
          <Text color={THEME.purple} bold>{'󰃀 later'}</Text>
          <Text color={THEME.muted}>{'  '}</Text>
          <Text color={THEME.cyan}>{repo}</Text>
        </Text>
        <Text color={list.length > 0 ? THEME.yellow : THEME.green}>
          {list.length > 0 ? `${list.length} pending` : 'clear'}
        </Text>
      </Box>
    )

    if (list.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Box paddingX={1} flexDirection="column">
            <Text color={THEME.green}>{'✓ Nothing stashed for this repo'}</Text>
            <Text color={THEME.muted}>{'/later <task> to save one for later'}</Text>
          </Box>
        </Box>
      )
    }

    const card = (todo: Todo, index: number) => (
      <Box
        key={todo.id}
        flexDirection="row"
        gap={1}
        paddingX={1}
        borderStyle="round"
        borderColor={THEME.border}
        hover={{ borderColor: THEME.blue }}
      >
        <Text color={THEME.blue} bold>
          {String(index + 1).padStart(2)}
        </Text>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text color={THEME.fg} wrap="wrap">
            {splitTickets(todo.text).map(part =>
              part.isTicket ? (
                <Text color={THEME.yellow} bold>
                  {part.text}
                </Text>
              ) : (
                part.text
              ),
            )}
          </Text>
          <Box flexDirection="row" justifyContent="space-between">
            <Text color={THEME.muted}>{age(now - todo.createdAt)}</Text>
            <Box flexDirection="row" gap={1}>
              <Button
                key={`start-${todo.id}`}
                label="▶ Start"
                variant="primary"
                hotkey={index < MAX_HOTKEYS ? String(index + 1) : undefined}
                onPress={() => start(todo.id)}
              />
              <Button
                key={`drop-${todo.id}`}
                plain
                hover={{ color: THEME.red }}
                onPress={() => drop(todo.id)}
              >
                <Text color={THEME.muted}>{'✕'}</Text>
              </Button>
            </Box>
          </Box>
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column">
        {header}
        {list.map(card)}
        <Box paddingX={1}>
          <Text color={THEME.muted}>
            <Text color={THEME.blue}>{'1-9'}</Text>
            {' start · '}
            <Text color={THEME.blue}>{'tab'}</Text>
            {' walk · '}
            <Text color={THEME.blue}>{'/later <task>'}</Text>
            {' add'}
          </Text>
        </Box>
      </Box>
    )
  })
}
