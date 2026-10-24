export type Todo = { id: string; text: string; createdAt: number }

declare module 'claude-code' {
  interface PluginState {
    later: { todos: Todo[]; root: string; file: string }
  }
}
