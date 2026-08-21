import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DraftStatus } from '../../api/draft'
import type { LeagueSummary } from '../../api/leagues'
import type { DraftSummary } from '../../lib/draftSummary'
import { LeagueDetailPage } from './LeagueDetailPage'

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

function noContentResponse() {
  return { ok: true, status: 204, json: () => Promise.resolve(null) }
}

const baseLeague: LeagueSummary = {
  id: 1,
  platform: 'sleeper',
  platform_league_id: '999',
  name: 'Sunday Funday',
  season: '2026',
  format: 'half_ppr',
  num_teams: 10,
  roster_positions: ['QB'],
  team_names: { '1': 'Bourrow my Toe', '2': 'Rowdy Owls' },
  rank_set_id: null,
}

function draftStatusFor(league: LeagueSummary, mySlot: number): DraftStatus {
  return {
    draft: {
      id: 5,
      platform: 'sleeper',
      platform_draft_id: '555',
      league_id: league.id,
      season: league.season,
      format: league.format,
      num_teams: league.num_teams,
      num_rounds: 14,
      my_slot: mySlot,
      rank_set_id: null,
      roster_positions: league.roster_positions,
      team_names: {},
    },
    picks: [],
    next_pick_number: 1,
    current_round: 1,
    current_slot: 1,
    is_my_turn: false,
    is_complete: false,
  }
}

/** A small in-memory stand-in covering the league detail page's own calls
 * (sync/delete/rank-set) plus enough of the drafts backend to create and
 * resume one. */
function mockBackend({
  league = baseLeague,
  rankSets = [],
}: {
  league?: LeagueSummary
  rankSets?: { id: number; name: string; player_count: number }[]
} = {}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const { pathname } = new URL(url)
    const method = init?.method ?? 'GET'
    const body = init?.body
      ? (JSON.parse(init.body as string) as Record<string, unknown>)
      : undefined

    if (pathname === '/rank-sets') {
      return Promise.resolve(
        jsonResponse(
          rankSets.map((s) => ({
            id: s.id,
            name: s.name,
            platform: 'sleeper',
            season: '2026',
            format: 'half_ppr',
            player_count: s.player_count,
          })),
        ),
      )
    }
    if (pathname === `/leagues/${league.id}/sync` && method === 'POST') {
      return Promise.resolve(
        jsonResponse({ ...league, name: 'Renamed League' }),
      )
    }
    if (pathname === `/leagues/${league.id}/rank-set` && method === 'PATCH') {
      return Promise.resolve(
        jsonResponse({ ...league, rank_set_id: body?.rank_set_id ?? null }),
      )
    }
    if (pathname === `/leagues/${league.id}` && method === 'DELETE') {
      return Promise.resolve(noContentResponse())
    }
    if (pathname === '/drafts/league' && method === 'POST') {
      return Promise.resolve(
        jsonResponse(draftStatusFor(league, body?.my_slot as number)),
      )
    }
    if (pathname === '/drafts/5') {
      return Promise.resolve(jsonResponse(draftStatusFor(league, 3)))
    }
    if (pathname === '/drafts/5/queue') {
      return Promise.resolve(jsonResponse([]))
    }
    return Promise.resolve(jsonResponse([]))
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('LeagueDetailPage', () => {
  it('shows the league header and a back link', () => {
    mockBackend()
    render(
      <LeagueDetailPage
        league={baseLeague}
        draft={null}
        onBack={vi.fn()}
        onLeagueUpdated={vi.fn()}
        onLeagueDeleted={vi.fn()}
        onDraftChanged={vi.fn()}
      />,
    )

    expect(screen.getByText('Sunday Funday')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '← Leagues' }))
  })

  it("shows a league's team names as chips", () => {
    mockBackend()
    render(
      <LeagueDetailPage
        league={baseLeague}
        draft={null}
        onBack={vi.fn()}
        onLeagueUpdated={vi.fn()}
        onLeagueDeleted={vi.fn()}
        onDraftChanged={vi.fn()}
      />,
    )

    expect(screen.getByText('Bourrow my Toe')).toBeInTheDocument()
    expect(screen.getByText('Rowdy Owls')).toBeInTheDocument()
  })

  it('syncing a league calls onLeagueUpdated with the refreshed league', async () => {
    mockBackend()
    const onLeagueUpdated = vi.fn()
    render(
      <LeagueDetailPage
        league={baseLeague}
        draft={null}
        onBack={vi.fn()}
        onLeagueUpdated={onLeagueUpdated}
        onLeagueDeleted={vi.fn()}
        onDraftChanged={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Sync from Sleeper' }))

    await vi.waitFor(() => {
      expect(onLeagueUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Renamed League' }),
      )
    })
  })

  it('deleting a league requires a confirm click', async () => {
    mockBackend()
    const onLeagueDeleted = vi.fn()
    render(
      <LeagueDetailPage
        league={baseLeague}
        draft={null}
        onBack={vi.fn()}
        onLeagueUpdated={vi.fn()}
        onLeagueDeleted={onLeagueDeleted}
        onDraftChanged={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Sunday Funday')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete?' }))

    await vi.waitFor(() => {
      expect(onLeagueDeleted).toHaveBeenCalled()
    })
  })

  it('the delete confirm mentions the in-progress draft when one exists', () => {
    mockBackend()
    const draft: DraftSummary = {
      id: 5,
      next_pick_number: 4,
      current_round: 2,
      is_complete: false,
    }
    render(
      <LeagueDetailPage
        league={baseLeague}
        draft={draft}
        onBack={vi.fn()}
        onLeagueUpdated={vi.fn()}
        onLeagueDeleted={vi.fn()}
        onDraftChanged={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(
      screen.getByRole('button', {
        name: 'Confirm delete? (also deletes its draft)',
      }),
    ).toBeInTheDocument()
  })

  it("changing the league's rank set calls onLeagueUpdated", async () => {
    mockBackend({ rankSets: [{ id: 5, name: 'Main', player_count: 300 }] })
    const onLeagueUpdated = vi.fn()
    render(
      <LeagueDetailPage
        league={baseLeague}
        draft={null}
        onBack={vi.fn()}
        onLeagueUpdated={onLeagueUpdated}
        onLeagueDeleted={vi.fn()}
        onDraftChanged={vi.fn()}
      />,
    )
    // wait for the async rank-sets fetch to populate the <option> before
    // selecting it -- jsdom silently ignores setting a <select>'s value to
    // one with no matching option yet.
    await screen.findByRole('option', { name: 'Main (300)' })

    fireEvent.change(screen.getByLabelText('Rank set'), {
      target: { value: '5' },
    })

    await vi.waitFor(() => {
      expect(onLeagueUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ rank_set_id: 5 }),
      )
    })
  })

  it('shows a slot input and Start Draft when the league has no draft yet', () => {
    mockBackend()
    render(
      <LeagueDetailPage
        league={baseLeague}
        draft={null}
        onBack={vi.fn()}
        onLeagueUpdated={vi.fn()}
        onLeagueDeleted={vi.fn()}
        onDraftChanged={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Your draft slot')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Draft' })).toBeEnabled()
  })

  it('rejects a draft slot beyond the league’s team count', () => {
    mockBackend()
    render(
      <LeagueDetailPage
        league={baseLeague}
        draft={null}
        onBack={vi.fn()}
        onLeagueUpdated={vi.fn()}
        onLeagueDeleted={vi.fn()}
        onDraftChanged={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('Your draft slot'), {
      target: { value: '99' },
    })

    expect(
      screen.getByText('Slot must be between 1 and 10.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Draft' })).toBeDisabled()
  })

  it('starting a draft mounts the board and calls onDraftChanged', async () => {
    mockBackend()
    const onDraftChanged = vi.fn()
    render(
      <LeagueDetailPage
        league={baseLeague}
        draft={null}
        onBack={vi.fn()}
        onLeagueUpdated={vi.fn()}
        onLeagueDeleted={vi.fn()}
        onDraftChanged={onDraftChanged}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))

    expect(
      await screen.findByRole('columnheader', { name: 'You' }),
    ).toBeInTheDocument()
    expect(onDraftChanged).toHaveBeenCalled()
  })

  it('shows a Round/Pick summary and Resume when a draft already exists', () => {
    mockBackend()
    const draft: DraftSummary = {
      id: 5,
      next_pick_number: 4,
      current_round: 2,
      is_complete: false,
    }
    render(
      <LeagueDetailPage
        league={baseLeague}
        draft={draft}
        onBack={vi.fn()}
        onLeagueUpdated={vi.fn()}
        onLeagueDeleted={vi.fn()}
        onDraftChanged={vi.fn()}
      />,
    )

    expect(screen.getByText('Round 2, Pick 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Your draft slot')).not.toBeInTheDocument()
  })

  it('Resume mounts the board with a back-to-league control', async () => {
    mockBackend()
    const draft: DraftSummary = {
      id: 5,
      next_pick_number: 4,
      current_round: 2,
      is_complete: false,
    }
    render(
      <LeagueDetailPage
        league={baseLeague}
        draft={draft}
        onBack={vi.fn()}
        onLeagueUpdated={vi.fn()}
        onLeagueDeleted={vi.fn()}
        onDraftChanged={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))

    expect(
      await screen.findByRole('columnheader', { name: 'You' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '← Sunday Funday' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '← Sunday Funday' }))

    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
  })
})
