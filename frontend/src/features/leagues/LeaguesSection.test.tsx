import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DraftListRow } from '../../api/draft'
import type { LeagueSummary } from '../../api/leagues'
import { LeaguesSection } from './LeaguesSection'

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

function noContentResponse() {
  return { ok: true, status: 204, json: () => Promise.resolve(null) }
}

const sampleLeague: LeagueSummary = {
  id: 1,
  platform: 'sleeper',
  platform_league_id: '999',
  name: 'Sunday Funday',
  season: '2026',
  format: 'half_ppr',
  num_teams: 10,
  roster_positions: ['QB'],
  team_names: {},
  rank_set_id: null,
}

/** A small in-memory stand-in covering everything LeaguesSection itself
 * fetches, plus what its children (LeaguesPage/LeagueDetailPage/DraftRoom)
 * need for the flows exercised here. */
function mockBackend({
  leagues = [sampleLeague],
  drafts = [],
}: {
  leagues?: LeagueSummary[]
  drafts?: DraftListRow[]
} = {}) {
  let currentLeagues = [...leagues]

  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const { pathname } = new URL(url)
    const method = init?.method ?? 'GET'

    if (pathname === '/leagues' && method === 'GET') {
      return Promise.resolve(jsonResponse([...currentLeagues]))
    }
    if (pathname === '/drafts' && method === 'GET') {
      return Promise.resolve(jsonResponse(drafts))
    }
    if (pathname === '/rank-sets') {
      return Promise.resolve(jsonResponse([]))
    }
    const syncMatch = pathname.match(/^\/leagues\/(\d+)\/sync$/)
    if (syncMatch && method === 'POST') {
      const id = Number(syncMatch[1])
      currentLeagues = currentLeagues.map((l) =>
        l.id === id ? { ...l, name: 'Renamed League' } : l,
      )
      return Promise.resolve(
        jsonResponse(currentLeagues.find((l) => l.id === id)),
      )
    }
    const deleteMatch = pathname.match(/^\/leagues\/(\d+)$/)
    if (deleteMatch && method === 'DELETE') {
      const id = Number(deleteMatch[1])
      currentLeagues = currentLeagues.filter((l) => l.id !== id)
      return Promise.resolve(noContentResponse())
    }
    return Promise.resolve(jsonResponse([]))
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('LeaguesSection', () => {
  it('loads and shows the leagues list', async () => {
    mockBackend()
    render(<LeaguesSection />)

    expect(await screen.findByText('Sunday Funday')).toBeInTheDocument()
  })

  it('clicking a league card drills into its detail view', async () => {
    mockBackend()
    render(<LeaguesSection />)
    await screen.findByRole('button', { name: /Sunday Funday/ })

    fireEvent.click(screen.getByRole('button', { name: /Sunday Funday/ }))

    expect(
      screen.getByRole('button', { name: '← Leagues' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Sync from Sleeper' }),
    ).toBeInTheDocument()
  })

  it('back returns to the list', async () => {
    mockBackend()
    render(<LeaguesSection />)
    await screen.findByRole('button', { name: /Sunday Funday/ })
    fireEvent.click(screen.getByRole('button', { name: /Sunday Funday/ }))
    await screen.findByRole('button', { name: '← Leagues' })

    fireEvent.click(screen.getByRole('button', { name: '← Leagues' }))

    expect(
      screen.getByRole('button', { name: /Sunday Funday/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Sync from Sleeper' }),
    ).not.toBeInTheDocument()
  })

  it('restores the last-viewed league from localStorage on mount', async () => {
    localStorage.setItem('fantasy-draft-app:lastLeagueId', '1')
    mockBackend()
    render(<LeaguesSection />)

    expect(
      await screen.findByRole('button', { name: 'Sync from Sleeper' }),
    ).toBeInTheDocument()
  })

  it('the ad-hoc footer link opens the non-league draft setup with its own back link', async () => {
    mockBackend()
    render(<LeaguesSection />)
    await screen.findByRole('button', { name: /Sunday Funday/ })

    fireEvent.click(
      screen.getByRole('button', { name: /Start a draft without a league/ }),
    )

    expect(
      screen.getByRole('heading', { name: 'New draft' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '← Leagues' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '← Leagues' }))

    expect(
      screen.getByRole('button', { name: /Sunday Funday/ }),
    ).toBeInTheDocument()
  })

  it('deleting a league (confirmed) returns to the list without it', async () => {
    mockBackend()
    render(<LeaguesSection />)
    await screen.findByRole('button', { name: /Sunday Funday/ })
    fireEvent.click(screen.getByRole('button', { name: /Sunday Funday/ }))
    await screen.findByRole('button', { name: 'Delete' })

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete?' }))

    expect(await screen.findByText(/No leagues yet/)).toBeInTheDocument()
  })

  it('shows a draft-in-progress badge on the list from GET /drafts', async () => {
    mockBackend({
      drafts: [
        {
          id: 5,
          platform: 'sleeper',
          league_id: 1,
          season: '2026',
          format: 'half_ppr',
          num_teams: 10,
          num_rounds: 14,
          my_slot: 3,
          pick_count: 3,
          next_pick_number: 4,
          current_round: 2,
          is_complete: false,
          created_at: '2026-08-01T00:00:00Z',
        },
      ],
    })
    render(<LeaguesSection />)

    expect(
      await screen.findByText('Draft in progress · Round 2, Pick 4'),
    ).toBeInTheDocument()
  })
})
