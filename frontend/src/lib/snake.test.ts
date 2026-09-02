import { describe, expect, it } from 'vitest'

import { overallPick, pickInRound, pickLabel } from './snake'

const TEAMS = 10

describe('snake numbering', () => {
  it('runs left to right in odd rounds', () => {
    expect(pickInRound(1, 1, TEAMS)).toBe(1)
    expect(pickInRound(1, 10, TEAMS)).toBe(10)
    expect(overallPick(1, 1, TEAMS)).toBe(1)
    expect(overallPick(1, 10, TEAMS)).toBe(10)
  })

  it('reverses in even rounds', () => {
    // The board keeps team 1 in the leftmost column all the way down, so in
    // round 2 that column holds the round's *last* pick.
    expect(pickInRound(2, 1, TEAMS)).toBe(10)
    expect(pickInRound(2, 10, TEAMS)).toBe(1)
    expect(overallPick(2, 10, TEAMS)).toBe(11)
    expect(overallPick(2, 1, TEAMS)).toBe(20)
  })

  it('is continuous across the turn', () => {
    expect(overallPick(1, 10, TEAMS)).toBe(10)
    expect(overallPick(2, 10, TEAMS)).toBe(11)
  })

  it('numbers every pick exactly once', () => {
    const seen = new Set<number>()
    for (let round = 1; round <= 15; round += 1) {
      for (let slot = 1; slot <= TEAMS; slot += 1) {
        seen.add(overallPick(round, slot, TEAMS))
      }
    }
    expect(seen.size).toBe(150)
    expect(Math.min(...seen)).toBe(1)
    expect(Math.max(...seen)).toBe(150)
  })

  it('labels a cell with both numbers', () => {
    expect(pickLabel(1, 1, TEAMS)).toBe('1.1 (1)')
    expect(pickLabel(1, 2, TEAMS)).toBe('1.2 (2)')
    expect(pickLabel(2, 10, TEAMS)).toBe('2.1 (11)')
    expect(pickLabel(2, 1, TEAMS)).toBe('2.10 (20)')
  })
})
