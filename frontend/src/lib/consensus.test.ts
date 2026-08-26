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
    source_tier: null,
  }
}

const REFS = ['adp', 'dataset:1', 'dataset:2']

describe('summarizeCandidates', () => {
  it('averages only the sources that rank the player', () => {
    const rows = summarizeCandidates(
      [player('1', 'A', { adp: 2, 'dataset:1': 4, 'dataset:2': null })],
      REFS,
      new Set(),
    )

    expect(rows[0].average).toBe(3)
    expect(rows[0].coverage).toBe(2)
    expect(rows[0].sourceCount).toBe(3)
  })

  it('never imputes a rank for a missing source', () => {
    // Adding a source that ranks nobody must not move anyone's average --
    // an imputed number is indistinguishable from a real one downstream.
    const players = [player('1', 'A', { adp: 2, 'dataset:1': 4 })]

    const two = summarizeCandidates(players, ['adp', 'dataset:1'], new Set())
    const three = summarizeCandidates(players, REFS, new Set())

    expect(three[0].average).toBe(two[0].average)
    expect(three[0].ranks['dataset:2']).toBeNull()
  })

  it('reports min, max and spread across the sources that have an opinion', () => {
    const rows = summarizeCandidates(
      [player('1', 'A', { adp: 2, 'dataset:1': 11, 'dataset:2': null })],
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
      [player('1', 'A', { adp: 3, 'dataset:1': 4, 'dataset:2': 3 })],
      REFS,
      new Set(),
    )

    expect(rows[0].spread).toBeLessThan(CONTESTED_SPREAD)
    expect(isContested(rows[0])).toBe(false)
  })

  it('sorts by average ascending', () => {
    const rows = summarizeCandidates(
      [
        player('1', 'Third', { adp: 9 }),
        player('2', 'First', { adp: 1 }),
        player('3', 'Second', { adp: 5 }),
      ],
      ['adp'],
      new Set(),
    )

    expect(rows.map((r) => r.name)).toEqual(['First', 'Second', 'Third'])
  })

  it('sorts a player no selected source ranks last, not first', () => {
    // The classic null-as-zero bug would float them to the top.
    const rows = summarizeCandidates(
      [
        player('1', 'Unranked', { adp: null }),
        player('2', 'Ranked', { adp: 12 }),
      ],
      ['adp'],
      new Set(),
    )

    expect(rows.map((r) => r.name)).toEqual(['Ranked', 'Unranked'])
    expect(rows[1].average).toBeNull()
  })

  it('breaks an average tie by coverage, then name', () => {
    const rows = summarizeCandidates(
      [
        player('1', 'Thin', { adp: 4, 'dataset:1': null }),
        player('2', 'Broad', { adp: 4, 'dataset:1': 4 }),
      ],
      ['adp', 'dataset:1'],
      new Set(),
    )

    expect(rows.map((r) => r.name)).toEqual(['Broad', 'Thin'])
  })

  it('excludes players already placed', () => {
    const rows = summarizeCandidates(
      [player('1', 'A', { adp: 1 }), player('2', 'B', { adp: 2 })],
      ['adp'],
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
