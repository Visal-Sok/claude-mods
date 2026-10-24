export type HudMeter = { percent: number; resetsAt: number | null }

export type Hud = {
  model: string
  dir: string
  branch: string
  isDirty: boolean
  contextPercent: number | null
  fiveHour: HudMeter | null
  weekly: HudMeter | null
  runningAgents: number
  // The later plugin is installed, so the pane button has a /later to run
  hasLater: boolean
}

declare module 'claude-code' {
  interface PluginState {
    hud: { hud: Hud | null }
  }
}
