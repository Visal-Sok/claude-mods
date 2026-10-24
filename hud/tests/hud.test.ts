import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { bar, countdown, shortModel, tildePath } from '../hooks/register'

const REPO = '/home/me/dotfiles'
const HINT_PROPS = { isDraft: false, isWorking: false, hint: '(shift+tab to cycle)' } as const

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const GIT: Record<string, string> = {
  'rev-parse': REPO,
  branch: 'main',
  status: ' M ghostty/config',
}

// Each command is "name@plugin"
function fakeEngine(on: On, commands: string[] = ['later@later']) {
  mock.clock(on, { now: 1000 })
  on('command.list', () => ({
    value: commands.map(id => {
      const [name = '', plugin] = id.split('@')
      return { name, plugin, description: '', source: 'plugin' as const }
    }),
  }))
  mock.env(on, { HOME: '/home/me' })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('session.cwd', () => ({ value: REPO }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1_000_000, percent: 21 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 63.5, resetsAt: new Date(1000 + 2 * HOUR + 13 * MINUTE).toISOString() },
        { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(1000 + 3 * DAY + 4 * HOUR).toISOString() },
      ],
      cost: { usd: 4.02 },
    },
  }))
  on('process.run', (_$, e) => ({
    value: {
      exitCode: 0,
      stdout: GIT[e.argv[1] ?? ''] ?? '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('agent.list', () => ({
    value: [
      { id: 'a1', description: 'explore', type: 'Explore', status: 'running' },
      { id: 'a2', description: 'review', type: 'code-reviewer', status: 'waiting' },
      { id: 'a3', description: 'done', type: 'Explore', status: 'completed' },
    ],
  }))
}

// The engine's own hint row, which the hud keeps under its line.
function engineHint(on: On) {
  on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'ENGINE HINT') as RenderElement)
}

const mountHint = ($: Engine) =>
  $.ui.mount({ plugin: 'hud', surface: 'terminal', component: 'PromptHint', props: HINT_PROPS })

test('shortens model ids and display names to one compact label', () => {
  expect(shortModel('claude-opus-5-5[1m]')).toBe('Opus 5.5 1M')
  expect(shortModel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(shortModel('Opus 5.5 (1M context)')).toBe('Opus 5.5 1M')
})

test('draws the context bar in five cells', () => {
  expect(bar(0)).toBe('▱▱▱▱▱')
  expect(bar(21)).toBe('▰▱▱▱▱')
  expect(bar(100)).toBe('▰▰▰▰▰')
})

test('counts down to a reset in at most two units', () => {
  expect(countdown(2 * HOUR + 13 * MINUTE)).toBe('2h13m')
  expect(countdown(3 * DAY + 4 * HOUR)).toBe('3d4h')
  expect(countdown(30_000)).toBe('1m')
  expect(countdown(-5)).toBe('now')
})

test('abbreviates the home directory to a tilde', () => {
  expect(tildePath('/home/me/dotfiles', '/home/me')).toBe('~/dotfiles')
  expect(tildePath('/home/meta', '/home/me')).toBe('/home/meta')
})

test('the hud shows dir, branch, context, 5h and weekly usage, and the model, but no cost', async ($, on) => {
  // Arrange
  fakeEngine(on)
  engineHint(on)
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })

  // Act
  const ui = await mountHint($)

  // Assert
  for (const text of ['Opus 5.5 1M', '~/dotfiles', 'main', 'Ctx', '21%', '5H', '64%', '↻ 2h13m', 'Weekly', '12%', '↻ 3d4h', 'Agents', '2']) {
    expect(await ui.find({ text })).toBeDefined()
  }
  expect(await ui.find({ text: '$4.02' })).toBeUndefined()
  expect(await ui.find({ text: 'ENGINE HINT' })).toBeDefined()
})

test('the pane button toggles the later pane through /later', async ($, on) => {
  // Arrange
  fakeEngine(on)
  engineHint(on)
  const ran: string[] = []
  on('command.run', (_$, e) => {
    ran.push(`/${e.command} ${e.args}`.trim())
    return { text: '' }
  })
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const ui = await mountHint($)

  // Act
  await ui.press({ key: 'later' })
  await ui.press({ key: 'later' })

  // Assert
  expect(ran).toEqual(['/later', '/later'])
})

test('the pane button is hidden when the later mod is not installed', async ($, on) => {
  // Arrange
  fakeEngine(on, [])
  engineHint(on)
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })

  // Act
  const ui = await mountHint($)

  // Assert
  expect(await ui.find({ text: 'Opus 5.5 1M' })).toBeDefined()
  expect(await ui.find({ key: 'later' })).toBeUndefined()
})

test('the pane button is hidden when another plugin owns /later', async ($, on) => {
  // Arrange
  fakeEngine(on, ['later@someone-else'])
  engineHint(on)
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })

  // Act
  const ui = await mountHint($)

  // Assert
  expect(await ui.find({ key: 'later' })).toBeUndefined()
})
