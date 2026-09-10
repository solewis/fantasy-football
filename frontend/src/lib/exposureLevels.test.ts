import { describe, expect, it } from 'vitest'

import { shareLevel } from './exposureLevels'

describe('shareLevel', () => {
  it('is level 0 for zero shares', () => {
    expect(shareLevel(0, 10)).toBe(0)
  })

  it('is level 0 when nobody has any shares yet', () => {
    expect(shareLevel(0, 0)).toBe(0)
  })

  it('is level 5 for the max, however small the max is', () => {
    expect(shareLevel(3, 3)).toBe(5)
  })

  it('is level 1 for the smallest positive share of a wide range', () => {
    expect(shareLevel(1, 20)).toBe(1)
  })

  it('climbs monotonically with share count', () => {
    const levels = [1, 4, 8, 12, 20].map((s) => shareLevel(s, 20))
    expect(levels).toEqual([1, 1, 2, 3, 5])
  })

  it('scales relative to the current max, not a fixed ceiling', () => {
    // The same share count reads as "near the top" against a small max and
    // "middling" against a large one.
    expect(shareLevel(3, 3)).toBe(5)
    expect(shareLevel(3, 30)).toBe(1)
  })

  it('never returns a level above 5 even if shares exceeds maxShares', () => {
    // Shouldn't happen in practice (maxShares is derived from the same
    // data), but a defensive floor/ceiling costs nothing.
    expect(shareLevel(50, 10)).toBe(5)
  })

  it('treats a negative share count the same as zero', () => {
    expect(shareLevel(-1, 10)).toBe(0)
  })
})
