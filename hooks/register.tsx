import { atom, read, update } from 'claude-code'
import type { Register, SessionRateLimit } from 'claude-code'

import type { Part, Snap, Win } from '../types'
import { fixed, layout } from './format'

const EMPTY: Snap = {
  model: null,
  modelFromStep: false,
  effort: { seen: false, value: null },
  ctx: null,
  five: null,
  seven: null,
}

// the dark theme's success green (#4EBA65), saturation +20% then lightness -10%, as the person asked
const GREEN = '#38B653'
const paint = (p: Part) => (p.dim ? 'subtle' : p.tone === 'success' ? GREEN : p.tone)

const snap = atom({ plugin: 'usage-band', key: 'snap' } as const, EMPTY)
const tick = atom({ plugin: 'usage-band', key: 'tick' } as const, 0)

const win = (limits: SessionRateLimit[], kind: string, old: Win | null): Win | null => {
  const r = limits.find(l => l.kind === kind)
  return r ? { pct: r.percentUsed, resetsAt: r.resetsAt } : old
}

const readings = (v: Snap, ctx: number | undefined, limits: SessionRateLimit[]): Snap => ({
  ...v,
  ctx: ctx ?? v.ctx,
  five: win(limits, 'five_hour', v.five),
  seven: win(limits, 'seven_day', v.seven),
})

export const register: Register = on => {
  // Windows 10's conhost crashes (0xc0000409) reflowing on a resize when the band's
  // length follows the width; there the band keeps one length and truncates
  let conhost = false

  on('session.start', async ($, e, next) => {
    // inherited vars can mislead either way; a miss only costs the stretch or the guard
    conhost = await Promise.all([$.env.get('OS'), $.env.get('WT_SESSION'), $.env.get('TERM_PROGRAM')])
      .then(([os, wt, term]) => os === 'Windows_NT' && wt === undefined && term === undefined)
      .catch(() => false)
    // redraw every minute so the reset countdowns move; no API call
    $.clock.every(60_000, () => update($, tick, n => n + 1))
    const usage = await $.session.usage()
    const model = await $.session.model()
    await update($, snap, v => ({
      ...readings(v, usage.context.percent, usage.rateLimits),
      model: v.modelFromStep ? v.model : model,
    }))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const v = await read($, snap)
    const model = v.modelFromStep ? v.model : await $.session.model()
    await update($, snap, v => ({ ...readings(v, e.context.percent, e.rateLimits), model: v.modelFromStep ? v.model : model }))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // a subagent's request may run another model or effort; the band shows the main loop's
    if (e.agentId === undefined) {
      await update($, snap, v => ({
        ...v,
        model: e.model,
        modelFromStep: true,
        effort: { seen: true, value: e.effort ?? null },
      }))
    }
    return yield* next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    await read($, tick)
    const v = await read($, snap)
    const now = await $.clock.now()
    const parts = conhost && e.surface === 'terminal' ? fixed(v, now) : layout(v, now, e.props.bodyColumns)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text wrap="truncate-end">
          {parts.map((p, i) => (
            // dimColor was too close to the filled run; the theme's subtle gray reads darker
            <Text key={String(i)} color={paint(p)}>
              {p.text}
            </Text>
          ))}
        </Text>
      </Box>
    )
  })
}
