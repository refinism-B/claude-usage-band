import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'

const NOW = Date.parse('2026-10-17T00:00:00Z')
const MIN = 60_000
const SURFACES = ['terminal', 'desktop'] as const

const LIMITS: SessionRateLimit[] = [
  { kind: 'five_hour', percentUsed: 42, resetsAt: new Date(NOW + 83 * MIN).toISOString() },
  { kind: 'seven_day', percentUsed: 18, resetsAt: new Date(NOW + 4560 * MIN).toISOString() },
]

const props = (hasSurvey = false, bodyColumns = 100) => ({
  hasSurvey,
  isWorking: false,
  maxRows: 10,
  bodyColumns,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
})

// the test's hooks sit beneath the plugin and stand for the engine
const engine = (on: On, rateLimits: SessionRateLimit[] = LIMITS, env: Record<string, string> = {}) => {
  mock.clock(on, { now: NOW })
  mock.env(on, env)
  on('session.usage', () => ({ value: { startedAt: NOW, context: { percent: 31, window: 200_000 }, rateLimits } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
}

const start = ($: Engine) => $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })

const step = async ($: Engine, model: string, effort: string, agentId?: string) => {
  const s = $.turn.step({ turnId: 't1', index: 0, model, effort: effort as 'high', messageCount: 1, agentId })
  for await (const _ of s) {
    // drain the stream so the chain runs
  }
  return s.result
}

const line = async ($: Engine, surface: (typeof SURFACES)[number], hasSurvey = false, columns = 100) => {
  const ui = await $.ui.mount({ plugin: 'usage-band', surface, component: 'AbovePrompt', props: props(hasSurvey, columns) })
  const outer = await ui.find({ type: 'Text' })
  await ui.unmount()
  return outer
}

test('band shows readings', async ($, on) => {
  engine(on)
  await start($)
  await step($, 'claude-opus-5-5', 'high')
  for (const surface of SURFACES) {
    const t = (await line($, surface))?.text ?? ''
    expect(t).toContain('Opus 5.5 · high')
    expect(t).toContain('31%')
    expect(t).toContain('42%')
    expect(t).toContain('18%')
  }
})

test('measure updates readings', async ($, on) => {
  engine(on)
  await start($)
  await $.session.measure({
    context: { percent: 70, window: 200_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 85 }],
    changed: ['context', 'rateLimits'],
  })
  for (const surface of SURFACES) {
    const t = (await line($, surface))?.text ?? ''
    expect(t).toMatch(/ctx ▬+ 70%/)
    expect(t).toMatch(/5h ▬+ 85%/)
    expect(t).toContain('18%')
  }
})

test('subagent step ignored', async ($, on) => {
  engine(on)
  await start($)
  await step($, 'claude-opus-5-5', 'high')
  await step($, 'claude-haiku-5-5', 'low', 'a1')
  for (const surface of SURFACES) {
    expect((await line($, surface))?.text ?? '').toContain('Opus 5.5 · high')
  }
})

test('yields to survey', async ($, on) => {
  engine(on)
  await start($)
  for (const surface of SURFACES) {
    const t = await line($, surface, true)
    expect(t?.text ?? '').not.toContain('ctx')
  }
})

test('truncates, never wraps', async ($, on) => {
  engine(on)
  await start($)
  for (const surface of SURFACES) {
    expect((await line($, surface))?.props.wrap).toBe('truncate-end')
  }
})

test('unused half of a bar is drawn in the subtle theme color', async ($, on) => {
  engine(on)
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface, component: 'AbovePrompt', props: props() })
    const texts = await ui.findAll({ type: 'Text', text: /^▬+$/ })
    await ui.unmount()
    // ctx 31% of 10 cells: a filled run then an unused run
    expect(texts.map(t => t.props.color)).toContain('subtle')
    // filled part under the limits: theme green, saturation +20%, lightness -10%
    expect(texts.map(t => t.props.color)).toContain('#38B653')
    expect(texts.every(t => t.props.dimColor !== true)).toBe(true)
  }
})

// legacy conhost (Windows 10) crashes reflowing a band whose length follows the width
test('legacy conhost: band ignores the width', async ($, on) => {
  engine(on, LIMITS, { OS: 'Windows_NT' })
  await start($)
  const narrow = (await line($, 'terminal', false, 70))?.text ?? ''
  const wide = (await line($, 'terminal', false, 180))?.text ?? ''
  expect(wide).toBe(narrow)
  expect(wide).toContain('7d')
})

test('windows terminal: band still stretches', async ($, on) => {
  engine(on, LIMITS, { OS: 'Windows_NT', WT_SESSION: 'x' })
  await start($)
  const narrow = (await line($, 'terminal', false, 70))?.text ?? ''
  const wide = (await line($, 'terminal', false, 180))?.text ?? ''
  expect(wide.length).toBeGreaterThan(narrow.length)
})

test('vscode terminal on windows: band still stretches', async ($, on) => {
  engine(on, LIMITS, { OS: 'Windows_NT', TERM_PROGRAM: 'vscode' })
  await start($)
  const narrow = (await line($, 'terminal', false, 70))?.text ?? ''
  const wide = (await line($, 'terminal', false, 180))?.text ?? ''
  expect(wide.length).toBeGreaterThan(narrow.length)
})

test('legacy conhost: desktop surface still stretches', async ($, on) => {
  engine(on, LIMITS, { OS: 'Windows_NT' })
  await start($)
  const narrow = (await line($, 'desktop', false, 70))?.text ?? ''
  const wide = (await line($, 'desktop', false, 180))?.text ?? ''
  expect(wide.length).toBeGreaterThan(narrow.length)
})

test('spend_limit ignored', async ($, on) => {
  engine(on, [{ kind: 'spend_limit', percentUsed: 50 }])
  await start($)
  for (const surface of SURFACES) {
    expect((await line($, surface))?.text ?? '').toContain('5h —')
  }
})
