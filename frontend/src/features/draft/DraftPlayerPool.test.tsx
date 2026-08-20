import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlayerRow } from '../../api/players'
import type { RankRow } from '../../api/ranks'
import { DraftPlayerPool } from './DraftPlayerPool'

const adpPlayers: PlayerRow[] = [
  {
    rank: 1,
    platform_player_id: '3',
    name: "Ja'Marr Chase",
    position: 'WR',
    team: 'CIN',
    adp: 1.0,
  },
  {
    rank: 2,
    platform_player_id: '2',
    name: 'Bijan Robinson',
    position: 'RB',
    team: 'ATL',
    adp: 2.0,
  },
]

const savedRanks: RankRow[] = [
  {
    rank: 1,
    platform_player_id: '2',
    name: 'Bijan Robinson',
    position: 'RB',
    team: 'ATL',
    adp: 2.0,
  },
  {
    rank: 2,
    platform_player_id: '3',
    name: "Ja'Marr Chase",
    position: 'WR',
    team: 'CIN',
    adp: 1.0,
  },
]

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

function mockFetch({
  ranks = [],
  players = adpPlayers,
}: { ranks?: RankRow[]; players?: PlayerRow[] } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('/ranks')) return Promise.resolve(jsonResponse(ranks))
      return Promise.resolve(jsonResponse(players))
    }),
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('DraftPlayerPool', () => {
  it('falls back to ADP order when no saved ranks exist', async () => {
    mockFetch({ ranks: [] })

    render(
      <DraftPlayerPool
        format="half_ppr"
        draftedIds={new Set()}
        queuedIds={new Set()}
        onDraft={vi.fn()}
        onQueue={vi.fn()}
      />,
    )

    expect(await screen.findByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(screen.getByText('Bijan Robinson')).toBeInTheDocument()
  })

  it('excludes already-drafted players', async () => {
    mockFetch({ ranks: savedRanks })

    render(
      <DraftPlayerPool
        format="half_ppr"
        draftedIds={new Set(['2'])}
        queuedIds={new Set()}
        onDraft={vi.fn()}
        onQueue={vi.fn()}
      />,
    )

    expect(await screen.findByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(screen.queryByText('Bijan Robinson')).not.toBeInTheDocument()
  })

  it('Draft button calls onDraft with the player id', async () => {
    mockFetch({ ranks: savedRanks })
    const onDraft = vi.fn()

    render(
      <DraftPlayerPool
        format="half_ppr"
        draftedIds={new Set()}
        queuedIds={new Set()}
        onDraft={onDraft}
        onQueue={vi.fn()}
      />,
    )
    await screen.findByText('Bijan Robinson')

    fireEvent.click(screen.getAllByRole('button', { name: 'Draft' })[0])

    expect(onDraft).toHaveBeenCalledWith('2')
  })

  it('Queue button calls onQueue and disables once queued', async () => {
    mockFetch({ ranks: savedRanks })
    const onQueue = vi.fn()

    render(
      <DraftPlayerPool
        format="half_ppr"
        draftedIds={new Set()}
        queuedIds={new Set(['3'])}
        onDraft={vi.fn()}
        onQueue={onQueue}
      />,
    )
    await screen.findByText('Bijan Robinson')

    fireEvent.click(screen.getByRole('button', { name: '+ Queue' }))
    expect(onQueue).toHaveBeenCalledWith('2')

    expect(screen.getByRole('button', { name: 'Queued' })).toBeDisabled()
  })

  it('filters by position tab', async () => {
    mockFetch({ ranks: savedRanks })

    render(
      <DraftPlayerPool
        format="half_ppr"
        draftedIds={new Set()}
        queuedIds={new Set()}
        onDraft={vi.fn()}
        onQueue={vi.fn()}
      />,
    )
    await screen.findByText('Bijan Robinson')

    fireEvent.click(screen.getByRole('tab', { name: 'WR' }))

    expect(screen.getByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(screen.queryByText('Bijan Robinson')).not.toBeInTheDocument()
  })
})
