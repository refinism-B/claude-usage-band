export type Win = { pct: number; resetsAt?: string }

// seen=false: no main-thread turn.step yet; value=null: the model takes no effort
export type EffortState = { seen: boolean; value: string | number | null }

export type Snap = {
  model: string | null
  modelFromStep: boolean
  effort: EffortState
  ctx: number | null
  five: Win | null
  seven: Win | null
}

// theme keys; 'success' (green) only ever colors a bar's filled part
export type Tone = 'success' | 'warning' | 'error' | undefined

export type Part = { text: string; tone?: Tone; dim?: boolean }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { snap: Snap; tick: number }
  }
}
