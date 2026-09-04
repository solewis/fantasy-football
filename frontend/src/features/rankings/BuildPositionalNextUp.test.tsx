import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RankSetSummary } from '../../api/ranks'
import { BuildPositionalNextUp } from './BuildPositionalNextUp'

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

function rankSet(overrides: Partial<RankSetSummary>): RankSetSummary {
  return {
    id: 1,
    name: 'My QBs',
    platform: 'sleeper',
    season: '2026',
    format: 'half_ppr',
    scope: 'QB',
    is_active: true,
    player_count: 0,
    ...overrides,
  }
}

function row(
  id: string,
  name: string,
  rank: number,
  tier: number | null = null,
) {
  return {
    rank,
    platform_player_id: id,
    name,
    position: 'QB',
    team: 'BUF',
    adp: null,
    tier,
    break_after: null,
    flag: null,
  }
}

function mockFetch(ranksBySetId: Record<number, unknown[]>) {
  const fetchMock = vi.fn((url: string) => {
    const match = /\/rank-sets\/(\d+)\/ranks$/.exec(url)
    if (match)
      return Promise.resolve(jsonResponse(ranksBySetId[Number(match[1])] ?? []))
    return Promise.resolve(jsonResponse([]))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('BuildPositionalNextUp', () => {
  it('names which rank set is feeding each position', async () => {
    mockFetch({
      1: [row('q1', 'Josh Allen', 1)],
    })

    render(
      <BuildPositionalNextUp
        platform="sleeper"
        format="half_ppr"
        sets={[rankSet({ id: 1, name: 'My QBs', scope: 'QB' })]}
        placed={new Set()}
        onPick={vi.fn()}
      />,
    )

    expect(await screen.findByText('Josh Allen')).toBeInTheDocument()
    expect(screen.getByText('My QBs')).toBeInTheDocument()
  })

  it('shows up to 6 players per position, not just 3', async () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      row(`q${i}`, `QB Player ${i}`, i + 1),
    )
    mockFetch({ 1: rows })

    render(
      <BuildPositionalNextUp
        platform="sleeper"
        format="half_ppr"
        sets={[rankSet({ id: 1, name: 'My QBs', scope: 'QB' })]}
        placed={new Set()}
        onPick={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('QB Player 5')).toBeInTheDocument()
    })
    expect(screen.queryByText('QB Player 6')).toBeNull()
  })

  it('updates the set name when a different list becomes active', async () => {
    mockFetch({
      1: [row('q1', 'Josh Allen', 1)],
      2: [row('q2', 'Lamar Jackson', 1)],
    })

    const { rerender } = render(
      <BuildPositionalNextUp
        platform="sleeper"
        format="half_ppr"
        sets={[rankSet({ id: 1, name: 'My QBs', scope: 'QB' })]}
        placed={new Set()}
        onPick={vi.fn()}
      />,
    )
    expect(await screen.findByText('My QBs')).toBeInTheDocument()

    rerender(
      <BuildPositionalNextUp
        platform="sleeper"
        format="half_ppr"
        sets={[rankSet({ id: 2, name: 'QB backup', scope: 'QB' })]}
        placed={new Set()}
        onPick={vi.fn()}
      />,
    )

    expect(await screen.findByText('QB backup')).toBeInTheDocument()
    expect(screen.queryByText('My QBs')).toBeNull()
  })
})
