import { describe, expect, it } from 'vitest'

import {
  isPositionalRankSetSource,
  isSourceEligibleForScope,
  type AvailableSource,
} from './rankPool'

function source(overrides: Partial<AvailableSource>): AvailableSource {
  return {
    ref: 'adp',
    label: 'ADP',
    kind: 'adp',
    supports_overall: true,
    supports_positional: true,
    scope: null,
    is_active: null,
    ...overrides,
  }
}

describe('isPositionalRankSetSource', () => {
  it('is true only for a rank_set scoped to a position', () => {
    expect(
      isPositionalRankSetSource(source({ kind: 'rank_set', scope: 'RB' })),
    ).toBe(true)
  })

  it('is false for a rank_set scoped to overall', () => {
    expect(
      isPositionalRankSetSource(source({ kind: 'rank_set', scope: 'overall' })),
    ).toBe(false)
  })

  it('is false for adp and dataset sources', () => {
    expect(isPositionalRankSetSource(source({ kind: 'adp' }))).toBe(false)
    expect(isPositionalRankSetSource(source({ kind: 'dataset' }))).toBe(false)
  })
})

describe('isSourceEligibleForScope', () => {
  it('never allows a positional rank_set to feed an overall build', () => {
    // Regression guard: a positional list's ranks are relative to one
    // position only ("RB1", "RB2", ...) -- there's no honest way to turn
    // that into an overall rank, and the backend correctly rejects the
    // request. Letting the frontend think otherwise crashed the overall
    // build with "'My RBs' has no overall ranks, so it can't feed an
    // overall list".
    const myRbs = source({ kind: 'rank_set', scope: 'RB', is_active: true })
    expect(isSourceEligibleForScope(myRbs, 'overall')).toBe(false)
  })

  it('allows a positional rank_set only for its own matching position', () => {
    const myRbs = source({ kind: 'rank_set', scope: 'RB', is_active: true })
    expect(isSourceEligibleForScope(myRbs, 'RB')).toBe(true)
    expect(isSourceEligibleForScope(myRbs, 'QB')).toBe(false)
  })

  it('positional rank_set eligibility does not depend on is_active', () => {
    // is_active governs which list is used automatically elsewhere (the
    // overall build's "next up" panel, the draft room); it has no bearing on
    // whether a specific, manually-selected list is a valid comparison
    // source for its own position.
    const inactive = source({ kind: 'rank_set', scope: 'RB', is_active: false })
    expect(isSourceEligibleForScope(inactive, 'RB')).toBe(true)
  })

  it('follows supports_overall/supports_positional for adp and dataset sources', () => {
    const positionalOnly = source({
      kind: 'dataset',
      supports_overall: false,
      supports_positional: true,
    })
    expect(isSourceEligibleForScope(positionalOnly, 'overall')).toBe(false)
    expect(isSourceEligibleForScope(positionalOnly, 'WR')).toBe(true)
  })

  it('follows supports_overall/supports_positional for an overall-scoped rank_set', () => {
    const savedOverall = source({
      kind: 'rank_set',
      scope: 'overall',
      supports_overall: true,
      supports_positional: false,
    })
    expect(isSourceEligibleForScope(savedOverall, 'overall')).toBe(true)
    expect(isSourceEligibleForScope(savedOverall, 'WR')).toBe(false)
  })
})
