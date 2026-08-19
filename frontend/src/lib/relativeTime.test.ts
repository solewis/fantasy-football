import { describe, expect, it } from 'vitest'

import { formatExactDateTime, formatRelativeTime } from './relativeTime'

const NOW = new Date('2026-08-19T12:00:00Z')

describe('formatRelativeTime', () => {
  it('returns "Never" for null', () => {
    expect(formatRelativeTime(null, NOW)).toBe('Never')
  })

  it('returns "Just now" for timestamps under a minute old', () => {
    expect(formatRelativeTime('2026-08-19T11:59:45Z', NOW)).toBe('Just now')
  })

  it('formats minutes ago', () => {
    expect(formatRelativeTime('2026-08-19T11:55:00Z', NOW)).toBe(
      '5 minutes ago',
    )
  })

  it('formats hours ago', () => {
    expect(formatRelativeTime('2026-08-19T09:00:00Z', NOW)).toBe('3 hours ago')
  })

  it('formats days ago', () => {
    expect(formatRelativeTime('2026-08-17T12:00:00Z', NOW)).toBe('2 days ago')
  })
})

describe('formatExactDateTime', () => {
  it('returns undefined for null', () => {
    expect(formatExactDateTime(null)).toBeUndefined()
  })

  it('returns a locale-formatted date string containing the year', () => {
    // Avoid asserting an exact string -- toLocaleString output is
    // locale/timezone-dependent by design (that's the point of using it).
    expect(formatExactDateTime('2026-08-19T17:58:31.119111Z')).toContain('2026')
  })
})
