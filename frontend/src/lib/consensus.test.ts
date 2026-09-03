import { describe, expect, it } from 'vitest'

import type { PoolPlayer } from '../api/rankPool'
import { CONTESTED_SPREAD, isContested, summarizeCandidates } from './consensus'

function player(
  id: string,
  name: string,
  ranks: Record<string, number | null>,
): PoolPlayer {
  return {
    platform_player_id: id,
    name,
    position: 'WR',
    team: 'CIN',
    adp: null,
    ranks,
  }
}

const REFS = ['dataset:1', 'dataset:2']

describe('summarizeCandidates', () => {
  it('averages only the sources that rank the player', () => {
    const rows = summarizeCandidates(
      [player('1', 'A', { 'dataset:1': 2, 'dataset:2': null })],
      REFS,
      new Set(),
    )

    expect(rows[0].average).toBe(2)
    expect(rows[0].coverage).toBe(1)
    expect(rows[0].sourceCount).toBe(2)
  })

  it('never imputes a rank for a missing source', () => {
    // Adding a source that ranks nobody must not move anyone's average --
    // an imputed number is indistinguishable from a real one downstream.
    const players = [player('1', 'A', { 'dataset:1': 4 })]

    const one = summarizeCandidates(players, ['dataset:1'], new Set())
    const two = summarizeCandidates(players, REFS, new Set())

    expect(two[0].average).toBe(one[0].average)
    expect(two[0].ranks['dataset:2']).toBeNull()
  })

  it('reports min, max and spread across the sources that have an opinion', () => {
    const rows = summarizeCandidates(
      [player('1', 'A', { 'dataset:1': 2, 'dataset:2': 11 })],
      REFS,
      new Set(),
    )

    expect(rows[0].min).toBe(2)
    expect(rows[0].max).toBe(11)
    expect(rows[0].spread).toBe(9)
    expect(isContested(rows[0])).toBe(true)
  })

  it('does not flag agreement as contested', () => {
    const rows = summarizeCandidates(
      [player('1', 'A', { 'dataset:1': 4, 'dataset:2': 3 })],
      REFS,
      new Set(),
    )

    expect(rows[0].spread).toBeLessThan(CONTESTED_SPREAD)
    expect(isContested(rows[0])).toBe(false)
  })

  it('sorts by average ascending', () => {
    const rows = summarizeCandidates(
      [
        player('1', 'Third', { 'dataset:1': 9 }),
        player('2', 'First', { 'dataset:1': 1 }),
        player('3', 'Second', { 'dataset:1': 5 }),
      ],
      ['dataset:1'],
      new Set(),
    )

    expect(rows.map((r) => r.name)).toEqual(['First', 'Second', 'Third'])
  })

  it('sorts a player no selected source ranks last, not first', () => {
    // The classic null-as-zero bug would float them to the top.
    const rows = summarizeCandidates(
      [
        player('1', 'Unranked', { 'dataset:1': null }),
        player('2', 'Ranked', { 'dataset:1': 12 }),
      ],
      ['dataset:1'],
      new Set(),
    )

    expect(rows.map((r) => r.name)).toEqual(['Ranked', 'Unranked'])
    expect(rows[1].average).toBeNull()
  })

  it('breaks an average tie by coverage, then name', () => {
    const rows = summarizeCandidates(
      [
        player('1', 'Thin', { 'dataset:1': 4, 'dataset:2': null }),
        player('2', 'Broad', { 'dataset:1': 4, 'dataset:2': 4 }),
      ],
      REFS,
      new Set(),
    )

    expect(rows.map((r) => r.name)).toEqual(['Broad', 'Thin'])
  })

  it('excludes players already placed', () => {
    const rows = summarizeCandidates(
      [
        player('1', 'A', { 'dataset:1': 1 }),
        player('2', 'B', { 'dataset:1': 2 }),
      ],
      ['dataset:1'],
      new Set(['1']),
    )

    expect(rows.map((r) => r.name)).toEqual(['B'])
  })

  it('handles no sources selected without dividing by zero', () => {
    const rows = summarizeCandidates([player('1', 'A', {})], [], new Set())

    expect(rows[0].average).toBeNull()
    expect(rows[0].coverage).toBe(0)
  })
})

describe('ADP is shown but never counted toward the average', () => {
  // ADP is a market estimate, not an opinion a source formed about this
  // list -- it's shown as its own column so you can see it, but folding it
  // into average/min/max/spread/coverage would double it against the sole
  // real opinion in a two-source build, or quietly make it the tie-breaker
  // in every comparison.
  it('excludes adp from the average entirely, even when it is the only other source', () => {
    const rows = summarizeCandidates(
      [player('1', 'A', { adp: 1, 'dataset:1': 9 })],
      ['adp', 'dataset:1'],
      new Set(),
    )

    expect(rows[0].average).toBe(9)
  })

  it('still reports adp in ranks, so its column keeps showing', () => {
    const rows = summarizeCandidates(
      [player('1', 'A', { adp: 1, 'dataset:1': 9 })],
      ['adp', 'dataset:1'],
      new Set(),
    )

    expect(rows[0].ranks.adp).toBe(1)
  })

  it('a player only adp ranks has no average at all', () => {
    const rows = summarizeCandidates(
      [player('1', 'A', { adp: 1 })],
      ['adp'],
      new Set(),
    )

    expect(rows[0].average).toBeNull()
    expect(rows[0].coverage).toBe(0)
    expect(rows[0].sourceCount).toBe(0)
  })

  it('does not let an extreme adp value distort min, max or spread', () => {
    const rows = summarizeCandidates(
      [player('1', 'A', { adp: 999, 'dataset:1': 2, 'dataset:2': 11 })],
      ['adp', 'dataset:1', 'dataset:2'],
      new Set(),
    )

    expect(rows[0].min).toBe(2)
    expect(rows[0].max).toBe(11)
    expect(rows[0].spread).toBe(9)
  })

  it('excludes adp from sourceCount', () => {
    const rows = summarizeCandidates(
      [player('1', 'A', { adp: 1, 'dataset:1': 2 })],
      ['adp', 'dataset:1'],
      new Set(),
    )

    expect(rows[0].sourceCount).toBe(1)
  })
})
