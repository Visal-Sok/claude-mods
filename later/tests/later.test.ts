import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const REPO = '/home/me/project'
const PANE_PROPS = {
  title: 'Later',
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

const FILE = '/home/me/.claude/later/home-me-project.json'

type Disk = Map<string, { text: string; mtimeMs: number }>

// The engine beneath the plugin: git answers REPO, panes always place, and
// the file system is an in-memory disk the test can also write to.
function fakeEngine(on: On, entries: Record<string, unknown> = {}) {
  const disk: Disk = new Map()
  let tick = 0
  const writeFile = (path: string, text: string) => disk.set(path, { text, mtimeMs: ++tick })
  const open = new Set<string>()

  mock.store(on, entries)
  mock.env(on, { HOME: '/home/me' })
  const clock = mock.clock(on, { now: 1000 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => {
    open.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('fs.exists', (_$, e) => ({ value: disk.has(e.path) }))
  on('fs.read', (_$, e) => ({ value: disk.get(e.path)!.text }))
  on('fs.write', (_$, e) => {
    writeFile(e.path, e.text)
    return { value: undefined }
  })
  on('fs.stat', (_$, e) => ({
    value: { kind: 'file', size: 0, mtimeMs: disk.get(e.path)!.mtimeMs, isLink: false },
  }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: `${REPO}\n`,
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))

  return { disk, clock, open, writeFile }
}

const START = { cwd: REPO, surface: 'terminal', isInteractive: true } as const
const run = (args: string) =>
  ({
    command: 'later',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  }) as const

test('/later stashes the task per repo without submitting a prompt', async ($, on) => {
  // Arrange
  fakeEngine(on)
  const submitted: string[] = []
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  await $.session.start(START)

  // Act
  const result = await $.command.run(run('fix the login redirect'))

  // Assert
  expect(result.text).toContain('1 pending')
  expect(submitted).toEqual([])
})

test('bare /later toggles the pane, opening it on its empty state too', async ($, on) => {
  // Arrange
  const engine = fakeEngine(on)
  await $.session.start(START)

  // Act + Assert
  expect((await $.command.run(run(''))).text).toBe('Nothing stashed for this repo.')
  expect(engine.open.has('later')).toBe(true)
  expect((await $.command.run(run(''))).text).toBe('Later pane closed.')
  expect(engine.open.has('later')).toBe(false)
  await $.command.run(run('fix the login redirect'))
  await $.command.run(run(''))
  expect((await $.command.run(run(''))).text).toBe('1 stashed for later.')
})

test('Start sends the task as a prompt and removes it from the list', async ($, on) => {
  // Arrange
  fakeEngine(on)
  const submitted: string[] = []
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  await $.session.start(START)
  await $.command.run(run('write the README'))
  await $.command.run(run('add JIRA-123 export'))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'later',
      surface,
      component: 'Pane',
      requestId: 'later',
      props: PANE_PROPS,
    })
    expect(await ui.find({ text: 'write the README' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({
    plugin: 'later',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'later',
    props: PANE_PROPS,
  })
  const first = await ui.find({ type: 'Button', text: 'Start' })

  // Act
  await ui.press({ key: first!.key! })

  // Assert
  expect(submitted).toEqual(['write the README'])
  expect(await ui.find({ text: 'write the README' })).toBeUndefined()
  expect(await ui.find({ text: 'add JIRA-123 export' })).toBeDefined()
})

test('stashed tasks survive into a new session for the same repo', async ($, on) => {
  // Arrange
  const engine = fakeEngine(on)
  engine.writeFile(FILE, JSON.stringify({ todos: [{ id: 'a', text: 'carried over', createdAt: 0 }] }))

  // Act
  await $.session.start(START)

  // Assert
  expect(engine.open.has('later')).toBe(true)
  await $.command.run(run(''))
  expect((await $.command.run(run(''))).text).toBe('1 stashed for later.')
})

test('a task another session stashes shows up after the next poll', async ($, on) => {
  // Arrange
  const engine = fakeEngine(on)
  await $.session.start(START)
  expect(engine.open.has('later')).toBe(false)

  // Act: another session writes the shared file
  engine.writeFile(FILE, JSON.stringify({ todos: [{ id: 'b', text: 'from elsewhere', createdAt: 0 }] }))
  await engine.clock.advance(2000)

  // Assert
  expect(engine.open.has('later')).toBe(true)
  const ui = await $.ui.mount({
    plugin: 'later',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'later',
    props: PANE_PROPS,
  })
  expect(await ui.find({ text: 'from elsewhere' })).toBeDefined()
})

test('stashing keeps tasks another session added since the last poll', async ($, on) => {
  // Arrange
  const engine = fakeEngine(on)
  await $.session.start(START)
  engine.writeFile(FILE, JSON.stringify({ todos: [{ id: 'c', text: 'theirs', createdAt: 0 }] }))

  // Act: no poll has run yet
  await $.command.run(run('mine'))

  // Assert
  const saved = JSON.parse(engine.disk.get(FILE)!.text) as { todos: { text: string }[] }
  expect(saved.todos.map(todo => todo.text)).toEqual(['theirs', 'mine'])
})

test('a list from the store-backed version moves into the file', async ($, on) => {
  // Arrange
  const engine = fakeEngine(on, { [`later:${REPO}`]: [{ id: 'old', text: 'legacy', createdAt: 0 }] })

  // Act
  await $.session.start(START)

  // Assert
  const saved = JSON.parse(engine.disk.get(FILE)!.text) as { todos: { text: string }[] }
  expect(saved.todos.map(todo => todo.text)).toEqual(['legacy'])
})

test('ticket keys in a task are drawn as their own highlighted text', async ($, on) => {
  // Arrange
  fakeEngine(on)
  await $.session.start(START)
  await $.command.run(run('ship OCPP-42 charger fix'))

  // Act
  const ui = await $.ui.mount({
    plugin: 'later',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'later',
    props: PANE_PROPS,
  })

  // Assert
  const ticket = await ui.find({ type: 'Text', text: /^OCPP-42$/ })
  expect(ticket).toBeDefined()
  expect(await ui.find({ text: '1 pending' })).toBeDefined()
})
