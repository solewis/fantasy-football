import { describe, expect, it } from 'vitest'

import {
  armOf,
  deltaBucket,
  describeDelta,
  formatDelta,
  rankDelta,
  thresholdsAt,
} from './deltaBuckets'

describe('thresholdsAt', () => {
  it('keeps the top of a list strict', () => {
    // At slot 1, a source saying WR3 has to read as a disagreement -- that's
    // the "three sources have him WR1 and one has him WR3" case.
    expect(thresholdsAt(1)).toEqual({ slight: 2, moderate: 5 })
    expect(deltaBucket(2, thresholdsAt(1))).toBe('behind-slight')
  })

  it('widens deeper into a list', () => {
    // +/-2 is a real disagreement at WR3 and pure noise at overall pick 84.
    expect(thresholdsAt(84)).toEqual({ slight: 4, moderate: 13 })
    expect(thresholdsAt(150)).toEqual({ slight: 8, moderate: 23 })
  })

  it('buckets the same absolute delta differently by depth', () => {
    expect(deltaBucket(5, thresholdsAt(10))).toBe('behind-moderate')
    expect(deltaBucket(5, thresholdsAt(84))).toBe('behind-moderate')
    expect(deltaBucket(3, thresholdsAt(10))).toBe('behind-moderate')
    expect(deltaBucket(3, thresholdsAt(84))).toBe('behind-slight')
  })
})

describe('deltaBucket', () => {
  const thresholds = { slight: 2, moderate: 5 }

  it.each([
    [null, 'missing'],
    [0, 'neutral'],
    [-1, 'value-slight'],
    [-2, 'value-slight'],
    [-3, 'value-moderate'],
    [-5, 'value-moderate'],
    [-6, 'value-strong'],
    [1, 'behind-slight'],
    [2, 'behind-slight'],
    [3, 'behind-moderate'],
    [5, 'behind-moderate'],
    [6, 'behind-strong'],
  ])('delta %s is %s', (delta, expected) => {
    expect(deltaBucket(delta, thresholds)).toBe(expected)
  })

  it('reads a negative delta as the source being higher on the player', () => {
    // rank 2 against slot 5 -- a lower number is a higher rank
    expect(rankDelta(2, 5)).toBe(-3)
    expect(deltaBucket(rankDelta(2, 5), thresholds)).toBe('value-moderate')
  })
})

describe('armOf', () => {
  it.each([
    ['missing', 'none'],
    ['neutral', 'none'],
    ['value-slight', 'value'],
    ['value-strong', 'value'],
    ['behind-slight', 'behind'],
    ['behind-strong', 'behind'],
  ] as const)('%s is on the %s arm', (bucket, arm) => {
    expect(armOf(bucket)).toBe(arm)
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
  it('three sources at WR1 read neutral and one at WR3 reads negative', () => {
    const slot = 1
    const thresholds = thresholdsAt(slot)
    const sourceRanks = [1, 1, 1, 3]

    const buckets = sourceRanks.map((rank) =>
      deltaBucket(rankDelta(rank, slot), thresholds),
    )

    expect(buckets).toEqual(['neutral', 'neutral', 'neutral', 'behind-slight'])
  })
})
