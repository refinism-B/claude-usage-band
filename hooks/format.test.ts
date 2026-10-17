import { describe, expect, test } from 'claude-code/testing'

import type { Part, Snap } from '../types'
import { bar, countdown, effortLabel, fixed, layout, modelLabel, shown, tone } from './format'

const NOW = Date.parse('2026-10-17T00:00:00Z')
const MIN = 60_000

const full: Snap = {
  model: 'claude-opus-5-5',
  modelFromStep: true,
  effort: { seen: true, value: 'high' },
  ctx: 31,
  five: { pct: 42, resetsAt: new Date(NOW + 83 * MIN).toISOString() },
  seven: { pct: 18, resetsAt: new Date(NOW + (3 * 1440 + 4 * 60) * MIN).toISOString() },
}

const empty: Snap = {
  model: null,
  modelFromStep: false,
  effort: { seen: false, value: null },
  ctx: null,
  five: null,
  seven: null,
}

const text = (parts: Part[]) => parts.map(p => p.text).join('')
const B = (n: number) => '▬'.repeat(n)
const partWith = (parts: Part[], s: string) => parts.find(p => p.text.includes(s))

describe('labels', () => {
  test('modelLabel', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
    expect(modelLabel('claude-haiku-5-5')).toBe('Haiku 5.5')
    expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1')
    expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5[1m]')
    expect(modelLabel('claude-opus-5-5', true)).toBe('Opus')
    expect(modelLabel('some-gateway-model')).toBe('some-gateway-model')
    expect(modelLabel(null)).toBe('—')
  })

  test('effortLabel', () => {
    expect(effortLabel({ seen: false, value: null })).toBe('—')
    expect(effortLabel({ seen: true, value: 'high' })).toBe('high')
    expect(effortLabel({ seen: true, value: 8000 })).toBe('8000')
    expect(effortLabel({ seen: true, value: null })).toBe(null)
  })
})

describe('numbers', () => {
  test('tone on displayed integer', () => {
    expect([60, 60.4, 60.5, 80, 80.4, 80.5, 104].map(p => tone(p, 'quota')))
      .toEqual([undefined, undefined, 'warning', 'warning', 'warning', 'error', 'error'])
    expect([40, 41, 65, 66].map(p => tone(p, 'ctx')))
      .toEqual([undefined, 'warning', 'warning', 'error'])
    expect(shown(60.5)).toBe(61)
  })

  test('countdown', () => {
    expect(countdown('2026-10-20T04:10:00Z', NOW)).toBe('3d4h')
    expect(countdown('2026-10-17T01:23:00Z', NOW)).toBe('1h23m')
    expect(countdown('2026-10-17T00:23:00Z', NOW)).toBe('23m')
    expect(countdown('2026-10-16T23:00:00Z', NOW)).toBe('0m')
    expect(countdown(undefined, NOW)).toBe('')
  })

  test('bar: filled part takes the tone, the rest is dim', () => {
    const shape = (p: Part[]) => p.map(x => [x.text, x.tone, !!x.dim])
    expect(shape(bar(42, 10, 'warning'))).toEqual([[B(4), 'warning', false], [B(6), undefined, true]])
    expect(shape(bar(104, 10, 'error'))).toEqual([[B(10), 'error', false]])
    expect(shape(bar(0, 5, undefined))).toEqual([[B(5), undefined, true]])
    // below the warning limit the filled part is green
    expect(shape(bar(42, 10, undefined))).toEqual([[B(4), 'success', false], [B(6), undefined, true]])
  })
})

describe('layout', () => {
  const WIDE = ` Opus 5.5 · high │ ctx ${B(10)} 31% │ 5h ${B(10)} 42% (1h23m) │ 7d ${B(10)} 18% (3d4h)`

  test('wide line', () => {
    expect(text(layout(full, NOW, 120))).toBe(WIDE)
  })

  test('stretches bars to 70% of the width', () => {
    for (const cols of [180, 250]) {
      const target = Math.floor(cols * 0.7)
      const p = layout(full, NOW, cols)
      const s = text(p)
      expect(s.length).toBeLessThanOrEqual(target)
      expect(s.length).toBeGreaterThan(target - 3)
      const bars = (s.match(/▬+/g) ?? []).map(run => run.length)
      expect(bars).toHaveLength(3)
      expect(new Set(bars).size).toBe(1)
      expect(bars[0]).toBeGreaterThan(10)
    }
  })

  test('degrades in order', () => {
    const s1 = text(layout(full, NOW, WIDE.length - 1))
    expect(s1).toContain('18%')
    expect(s1).not.toContain('(3d4h)')
    expect(s1).toContain('(1h23m)')

    const s2 = text(layout(full, NOW, s1.length - 1))
    expect(s2).not.toContain('(')
    expect(s2).toContain(`5h ${B(10)} 42%`)

    const s3 = text(layout(full, NOW, s2.length - 1))
    expect(s3).toContain(`5h ${B(5)} 42%`)

    const s4 = text(layout(full, NOW, s3.length - 1))
    expect(s4).toBe(' Opus 5.5 · high │ ctx 31% │ 5h 42% │ 7d 18%')
  })

  test('narrow keeps model family and all percents', () => {
    const s = text(layout(full, NOW, 20))
    expect(s.startsWith(' Opus · high')).toBe(true)
    expect(s).toContain('31%')
    expect(s).toContain('42%')
    expect(s).toContain('18%')
  })

  test('no readings', () => {
    expect(text(layout(empty, NOW, 200))).toBe(' — · — │ ctx — │ 5h — │ 7d —')
  })

  test('model without effort', () => {
    expect(text(layout({ ...full, effort: { seen: true, value: null } }, NOW, 200))).not.toContain(' · ')
  })

  test('tones', () => {
    const p = layout({ ...full, ctx: 50, five: { pct: 50 } }, NOW, 200)
    expect(partWith(p, '50%')?.tone).toBe('warning')
    // ctx comes first, so these are its bar's two halves
    expect(p.find(x => x.text.startsWith('▬'))?.tone).toBe('warning')
    expect(p.find(x => x.text.startsWith('▬') && x.dim)?.tone).toBe(undefined)
    expect(partWith(p, 'ctx ')?.tone).toBe(undefined)
    expect(p.filter(x => x.text.includes('50%')).map(x => x.tone)).toEqual(['warning', undefined])
    // 5h at 50% is under its quota limit: green bar, plain percent
    expect(p.filter(x => x.text.startsWith('▬') && !x.dim).map(x => x.tone)).toEqual(['warning', 'success', 'success'])

    const q = layout({ ...full, ctx: 66, five: { pct: 104 } }, NOW, 200)
    expect(partWith(q, '66%')?.tone).toBe('error')
    expect(partWith(q, '104%')?.tone).toBe('error')
  })

  test('fixed is the full line at any width', () => {
    expect(text(fixed(full, NOW))).toBe(WIDE)
  })
})
