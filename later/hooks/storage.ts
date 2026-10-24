import type { EngineInterface } from 'claude-code'

import type { Todo } from '../types'

// One JSON file per repo under ~/.claude/later, shared by every session.
export async function storagePath($: EngineInterface, root: string): Promise<string> {
  const home = (await $.env.get('HOME')) ?? '/tmp'
  const slug = root.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root'
  return `${home}/.claude/later/${slug}.json`
}

export async function mtimeOf($: EngineInterface, file: string): Promise<number> {
  if (!(await $.fs.exists(file))) return 0
  return (await $.fs.stat(file)).mtimeMs
}

function isTodo(value: unknown): value is Todo {
  const todo = value as Todo
  return typeof todo?.id === 'string' && typeof todo.text === 'string'
}

// Throws on a file that is not valid JSON, so a hand edit is never overwritten.
export async function loadTodos($: EngineInterface, file: string): Promise<Todo[]> {
  if (!(await $.fs.exists(file))) return []
  const text = await $.fs.read(file)
  let data: { todos?: unknown }
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`${file} is not valid JSON; fix or delete it`)
  }
  if (!Array.isArray(data?.todos)) return []
  return data.todos
    .filter(isTodo)
    .map(todo => ({ ...todo, createdAt: Number(todo.createdAt) || 0 }))
}

export async function saveTodos(
  $: EngineInterface,
  file: string,
  root: string,
  todos: readonly Todo[],
): Promise<void> {
  await $.fs.write(file, JSON.stringify({ root, todos }, null, 2) + '\n')
}
