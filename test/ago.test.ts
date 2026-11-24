import { expect, it } from 'vitest'
import { formatAgo } from '../lib/ago.ts'
import { formatStamp, formatTime } from '../web/src/sdk/format.ts'

const minute = 60_000
const day = 24 * 60 * minute
const now = new Date(2026, 9, 24, 12).getTime()

it('counts minutes, hours and days, rounding down, and treats future times as now', () => {
  const at = (ms: number) => formatAgo(now - ms, now)
  expect([at(-5 * minute), at(0), at(59_999), at(minute)]).toEqual(['now', 'now', 'now', '1m'])
  expect([at(60 * minute - 1), at(60 * minute)]).toEqual(['59m', '1h'])
  expect([at(day - 1), at(day)]).toEqual(['23h', '1d'])
  expect(at(7 * day - 1)).toBe('6d')
})

it('falls back to a short date from 7 days on, with the year only when it differs', () => {
  const short = { month: 'short', day: 'numeric' } as const
  expect(formatAgo(now - 7 * day, now)).toBe(
    new Date(now - 7 * day).toLocaleDateString(undefined, short),
  )
  const lastYear = new Date(2025, 9, 12).getTime()
  expect(formatAgo(lastYear, now)).toBe(
    new Date(lastYear).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
  )
})

it('reads in a sentence with ago, the date fallback unchanged', () => {
  const ago = (ms: number) => formatAgo(now - ms, now, { ago: true })
  expect([ago(0), ago(5 * minute), ago(3 * 60 * minute), ago(2 * day)]).toEqual([
    'just now',
    '5m ago',
    '3h ago',
    '2d ago',
  ])
  expect(ago(8 * day)).toBe(formatAgo(now - 8 * day, now))
})

it('stamps a time relatively within the hour, then by local day and clock', () => {
  const stamp = (at: number) => formatStamp(at, now)
  expect([stamp(now - 30_000), stamp(now - 12 * minute)]).toEqual(['just now', '12m ago'])
  expect(stamp(now - 3 * 60 * minute)).toBe(`today ${formatTime(now - 3 * 60 * minute)}`)
  const yesterday = new Date(2026, 9, 23, 23, 30).getTime()
  expect(stamp(yesterday)).toBe(`yesterday ${formatTime(yesterday)}`)
  const older = new Date(2026, 9, 20, 21, 57).getTime()
  expect(stamp(older)).toBe(
    `${new Date(older).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${formatTime(older)}`,
  )
  const lastYear = new Date(2025, 9, 12, 8, 5).getTime()
  expect(stamp(lastYear)).toContain('2025')
})
