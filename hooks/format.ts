import type { EffortState, Part, Snap, Tone, Win } from '../types'

const NONE = '—'
const SEP = ' │ '

// warn above the first number, alarm above the second (displayed integer)
const LIMITS = { quota: [60, 80], ctx: [40, 65] } as const

export const modelLabel = (id: string | null, short = false): string => {
  if (!id) return NONE
  const bare = id.replace(/^claude-/, '')
  const m = /^([a-z]+)-(\d+)(?:-(\d+))?(.*)$/.exec(bare)
  if (!m) return bare
  const [, fam = '', major, minor, rest] = m
  const family = fam.charAt(0).toUpperCase() + fam.slice(1)
  if (short) return family
  return `${family} ${major}${minor ? `.${minor}` : ''}${rest}`
}

export const effortLabel = (e: EffortState): string | null => {
  if (!e.seen) return NONE
  return e.value === null ? null : String(e.value)
}

export const shown = (p: number): number => Math.round(p)

export const tone = (p: number, kind: 'ctx' | 'quota'): Tone => {
  const [warn, alarm] = LIMITS[kind]
  const r = shown(p)
  return r > alarm ? 'error' : r > warn ? 'warning' : undefined
}

export const countdown = (resetsAt: string | undefined, now: number): string => {
  if (!resetsAt) return ''
  const m = Math.max(0, Math.round((Date.parse(resetsAt) - now) / 60_000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${m % 60}m`
  return `${m}m`
}

// one glyph for both halves, the unused half dim: a thin centered bar the person picked
const CELL = '▬'

export const bar = (p: number, cells: number, t: Tone): Part[] => {
  const filled = Math.round((Math.min(Math.max(p, 0), 100) / 100) * cells)
  const parts: Part[] = []
  if (filled > 0) parts.push({ text: CELL.repeat(filled), tone: t ?? 'success' })
  if (filled < cells) parts.push({ text: CELL.repeat(cells - filled), dim: true })
  return parts
}

type Opts = { cells: number; fiveReset: boolean; sevenReset: boolean; shortModel: boolean }

// step 0 is the full line; each later step gives up one more thing (spec §5.4)
const STEPS: Opts[] = [
  { cells: 10, fiveReset: true, sevenReset: true, shortModel: false },
  { cells: 10, fiveReset: true, sevenReset: false, shortModel: false },
  { cells: 10, fiveReset: false, sevenReset: false, shortModel: false },
  { cells: 5, fiveReset: false, sevenReset: false, shortModel: false },
  { cells: 0, fiveReset: false, sevenReset: false, shortModel: false },
  { cells: 0, fiveReset: false, sevenReset: false, shortModel: true },
]

const segment = (label: string, pct: number | null, kind: 'ctx' | 'quota', cells: number, reset: string): Part[] => {
  const parts: Part[] = [{ text: SEP }, { text: `${label} ` }]
  if (pct === null) return [...parts, { text: NONE }]
  const t = tone(pct, kind)
  if (cells > 0) parts.push(...bar(pct, cells, t), { text: ' ' })
  parts.push({ text: `${shown(pct)}%`, tone: t })
  // plain ASCII: terminal fonts often lack arrow glyphs such as ↻
  if (reset) parts.push({ text: ` (${reset})` })
  return parts
}

const quota = (label: string, w: Win | null, cells: number, withReset: boolean, now: number): Part[] =>
  segment(label, w ? w.pct : null, 'quota', cells, w && withReset ? countdown(w.resetsAt, now) : '')

const build = (s: Snap, now: number, o: Opts): Part[] => {
  const effort = effortLabel(s.effort)
  return [
    { text: ` ${modelLabel(s.model, o.shortModel)}${effort === null ? '' : ` · ${effort}`}` },
    ...segment('ctx', s.ctx, 'ctx', o.cells, ''),
    ...quota('5h', s.five, o.cells, o.fiveReset, now),
    ...quota('7d', s.seven, o.cells, o.sevenReset, now),
  ]
}

const width = (parts: Part[]) => parts.reduce((n, p) => n + p.text.length, 0)

// the full line fills this share of the width; bars grow with it, never below the first step's 10
const FILL = 0.7

const stretch = (s: Snap, now: number, columns: number): Opts => {
  const base = STEPS[0] as Opts
  const bars = [s.ctx, s.five, s.seven].filter(v => v !== null).length
  if (bars === 0) return base
  // each bar adds its cells plus one space to the bar-less line
  const bare = width(build(s, now, { ...base, cells: 0 }))
  const cells = Math.floor((Math.floor(columns * FILL) - bare) / bars) - 1
  return { ...base, cells: Math.max(base.cells, cells) }
}

// the full line whatever the width; the Text truncates it
export const fixed = (s: Snap, now: number): Part[] => build(s, now, STEPS[0] as Opts)

export const layout = (s: Snap, now: number, columns: number): Part[] => {
  let parts: Part[] = []
  for (const o of [stretch(s, now, columns), ...STEPS.slice(1)]) {
    parts = build(s, now, o)
    if (width(parts) <= columns) break
  }
  return parts
}
