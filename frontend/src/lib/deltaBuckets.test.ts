import { describe, expect, it } from 'vitest'

import {
  boundsForSlot,
  deltaBucket,
  describeDelta,
  formatDelta,
  formatRankAndDelta,
  PICK_BOUNDS,
  rankDelta,
} from './deltaBuckets'

describe('deltaBucket', () => {
  it('reads zero as agreement, on neither arm', () => {
    expect(deltaBucket(0, PICK_BOUNDS)).toEqual({
      arm: 'none',
      level: 0,
      missing: false,
    })
  })

  it('marks a source with no opinion as missing, not as agreement', () => {
    expect(deltaBucket(null, PICK_BOUNDS)).toEqual({
      arm: 'none',
      level: 0,
      missing: true,
    })
  })

  it('climbs monotonically with the size of the gap', () => {
    // The bug this replaces: +1 rendered darker than +9, because the dark-mode
    // ramp ran the other way. Intensity has to track magnitude.
    const levels = [1, 3, 6, 9, 15].map(
      (d) => deltaBucket(d, PICK_BOUNDS).level,
    )
    expect(levels).toEqual([1, 2, 3, 4, 5])
  })

  it('is symmetric across the two arms', () => {
    for (const magnitude of [1, 3, 6, 9, 15]) {
      const behind = deltaBucket(magnitude, PICK_BOUNDS)
      const value = deltaBucket(-magnitude, PICK_BOUNDS)
      expect(behind.arm).toBe('behind')
      expect(value.arm).toBe('value')
      expect(behind.level).toBe(value.level)
    }
  })

  it('tops out rather than running off the end', () => {
    expect(deltaBucket(200, PICK_BOUNDS).level).toBe(5)
    expect(deltaBucket(-200, PICK_BOUNDS).level).toBe(5)
  })

  it('reads a negative delta as the source being higher on the player', () => {
    // rank 2 against slot 5 -- a lower number is a higher rank
    expect(rankDelta(2, 5)).toBe(-3)
    expect(deltaBucket(rankDelta(2, 5), PICK_BOUNDS).arm).toBe('value')
  })
})

describe('boundsForSlot', () => {
  it('stays tight at the top of a list', () => {
    // Filling WR1, a source saying WR3 is a real disagreement.
    const bounds = boundsForSlot(1)
    expect(deltaBucket(2, bounds).arm).toBe('behind')
    expect(deltaBucket(2, bounds).level).toBeGreaterThanOrEqual(2)
  })

  it('widens deeper into a list', () => {
    // The same gap is noise by pick 84.
    expect(deltaBucket(3, boundsForSlot(1)).level).toBeGreaterThan(
      deltaBucket(3, boundsForSlot(84)).level,
    )
  })

  it('never collapses to zero width', () => {
    expect(boundsForSlot(1)[0]).toBeGreaterThanOrEqual(1)
  })
})

describe('PICK_BOUNDS', () => {
  it('spans roughly a round, which is the scale a drafter thinks in', () => {
    expect(deltaBucket(1, PICK_BOUNDS).level).toBe(1)
    expect(deltaBucket(12, PICK_BOUNDS).level).toBe(5)
  })
})

describe('formatDelta', () => {
  it.each([
    [null, '—'],
    [0, '0'],
    [3, '+3'],
    [-1, '-1'],
  ])('formats %s as %s', (delta, expected) => {
    expect(formatDelta(delta)).toBe(expected)
  })
})

describe('formatRankAndDelta', () => {
  it.each([
    [null, null, '—'],
    [4, 3, '4 (+3)'],
    [1, -1, '1 (-1)'],
    [5, 0, '5 (0)'],
  ] as const)('formats rank %s / delta %s as %s', (rank, delta, expected) => {
    expect(formatRankAndDelta(rank, delta)).toBe(expected)
  })
})

describe('describeDelta', () => {
  it('never leaves meaning to colour alone', () => {
    expect(describeDelta('ADP', 3, 1, 'WR1')).toContain('2 lower')
    expect(describeDelta('ADP', 1, 3, 'WR3')).toContain('2 higher')
    expect(describeDelta('ADP', 1, 1, 'WR1')).toContain('also has them')
  })

  it('distinguishes not ranked from not ranked this deep', () => {
    expect(describeDelta('ADP', null, 200, '#200', false)).toContain(
      "doesn't rank this player",
    )
    expect(describeDelta('ADP', null, 200, '#200', true)).toContain(
      "doesn't rank this deep",
    )
  })
})

describe('the case this feature was built around', () => {
  it('three sources at WR1 read as agreement and one at WR3 does not', () => {
    const bounds = boundsForSlot(1)
    const buckets = [1, 1, 1, 3].map(
      (rank) => deltaBucket(rankDelta(rank, 1), bounds).arm,
    )

    expect(buckets).toEqual(['none', 'none', 'none', 'behind'])
  })
})
