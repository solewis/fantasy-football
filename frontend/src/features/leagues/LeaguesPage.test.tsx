import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LeagueSummary } from '../../api/leagues'
import type { RankSetSummary } from '../../api/ranks'
import { LeaguesPage } from './LeaguesPage'

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

function noContentResponse() {
  return { ok: true, status: 204, json: () => Promise.resolve(null) }
}

/** A small in-memory stand-in for the leagues + rank-sets backend. */
function mockBackend({
  initialLeagues = [],
  initialRankSets = [],
  lookupResult = {
    name: 'Sunday Funday',
    season: '2026',
    num_teams: 10,
    roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
    suggested_format: 'half_ppr',
  },
}: {
  initialLeagues?: LeagueSummary[]
  initialRankSets?: RankSetSummary[]
  lookupResult?: {
    name: string
    season: string
    num_teams: number
    roster_positions: string[]
    suggested_format: string | null
  }
} = {}) {
  let leagues = [...initialLeagues]
  let rankSets = [...initialRankSets]
  let nextLeagueId = Math.max(0, ...leagues.map((l) => l.id)) + 1
  let nextRankSetId = Math.max(0, ...rankSets.map((s) => s.id)) + 1

  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const { pathname, searchParams } = new URL(url)
    const method = init?.method ?? 'GET'
    const body = init?.body
      ? (JSON.parse(init.body as string) as Record<string, unknown>)
      : undefined

    if (pathname === '/leagues/lookup' && method === 'GET') {
      return Promise.resolve(jsonResponse(lookupResult))
    }
    if (pathname === '/leagues' && method === 'GET') {
      return Promise.resolve(jsonResponse([...leagues]))
    }
    if (pathname === '/leagues' && method === 'POST') {
      const created: LeagueSummary = {
        id: nextLeagueId++,
        platform: 'sleeper',
        platform_league_id: body?.platform_league_id as string,
        name: lookupResult.name,
        season: lookupResult.season,
        format: body?.format as string,
        num_teams: lookupResult.num_teams,
        roster_positions: lookupResult.roster_positions,
        team_names: { '1': 'Bourrow my Toe' },
        rank_set_id: (body?.rank_set_id as number | null) ?? null,
      }
      leagues = [...leagues, created]
      return Promise.resolve(jsonResponse(created))
    }

    const syncMatch = pathname.match(/^\/leagues\/(\d+)\/sync$/)
    if (syncMatch && method === 'POST') {
      const id = Number(syncMatch[1])
      leagues = leagues.map((l) =>
        l.id === id ? { ...l, name: 'Renamed League' } : l,
      )
      return Promise.resolve(jsonResponse(leagues.find((l) => l.id === id)))
    }

    const rankSetPatchMatch = pathname.match(/^\/leagues\/(\d+)\/rank-set$/)
    if (rankSetPatchMatch && method === 'PATCH') {
      const id = Number(rankSetPatchMatch[1])
      leagues = leagues.map((l) =>
        l.id === id
          ? { ...l, rank_set_id: body?.rank_set_id as number | null }
          : l,
      )
      return Promise.resolve(jsonResponse(leagues.find((l) => l.id === id)))
    }

    const deleteMatch = pathname.match(/^\/leagues\/(\d+)$/)
    if (deleteMatch && method === 'DELETE') {
      const id = Number(deleteMatch[1])
      leagues = leagues.filter((l) => l.id !== id)
      return Promise.resolve(noContentResponse())
    }

    if (pathname === '/rank-sets' && method === 'GET') {
      const format = searchParams.get('format')
      return Promise.resolve(
        jsonResponse(rankSets.filter((s) => !format || s.format === format)),
      )
    }
    if (pathname === '/rank-sets' && method === 'POST') {
      const created: RankSetSummary = {
        id: nextRankSetId++,
        name: body?.name as string,
        platform: (body?.platform as string) ?? 'sleeper',
        season: body?.season as string,
        format: body?.format as string,
        player_count: body?.seed_from_adp ? 250 : 0,
      }
      rankSets.push(created)
      return Promise.resolve(jsonResponse(created))
    }
    if (pathname === '/players') {
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

describe('LeaguesPage', () => {
  it('shows an empty state when there are no leagues yet', async () => {
    mockBackend({ initialLeagues: [] })

    render(<LeaguesPage />)

    expect(await screen.findByText(/No leagues yet/)).toBeInTheDocument()
  })

  it('looking up a league shows a preview with the suggested format', async () => {
    mockBackend({ initialLeagues: [] })
    render(<LeaguesPage />)
    await screen.findByText(/No leagues yet/)

    fireEvent.click(screen.getByRole('button', { name: '+ Add League' }))
    fireEvent.change(screen.getByPlaceholderText(/e.g. 139/), {
      target: { value: '999' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Look Up' }))

    expect(await screen.findByText('Sunday Funday')).toBeInTheDocument()
    expect(screen.getByText(/10 teams/)).toBeInTheDocument()
    expect(
      (screen.getByLabelText('Scoring format') as HTMLSelectElement).value,
    ).toBe('half_ppr')
  })

  it('adding a league posts to /leagues and appends it to the list', async () => {
    const fetchMock = mockBackend({ initialLeagues: [] })
    render(<LeaguesPage />)
    await screen.findByText(/No leagues yet/)

    fireEvent.click(screen.getByRole('button', { name: '+ Add League' }))
    fireEvent.change(screen.getByPlaceholderText(/e.g. 139/), {
      target: { value: '999' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Look Up' }))
    await screen.findByText('Sunday Funday')

    fireEvent.click(screen.getByRole('button', { name: 'Add League' }))
    await vi.waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Adding…' }),
      ).not.toBeInTheDocument()
    })

    expect(screen.getByText('Sunday Funday')).toBeInTheDocument()
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        (url as string).includes('/leagues') &&
        (init as RequestInit)?.method === 'POST',
    )
    expect(postCall).toBeDefined()
    const [, init] = postCall as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({
      platform_league_id: '999',
      format: 'half_ppr',
    })
  })

  it('creating a new rank set from the picker seeds it from ADP and selects it', async () => {
    mockBackend({ initialLeagues: [], initialRankSets: [] })
    render(<LeaguesPage />)
    await screen.findByText(/No leagues yet/)

    fireEvent.click(screen.getByRole('button', { name: '+ Add League' }))
    fireEvent.change(screen.getByPlaceholderText(/e.g. 139/), {
      target: { value: '999' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Look Up' }))
    await screen.findByText('Sunday Funday')

    fireEvent.click(screen.getByRole('button', { name: '+ New Rank Set' }))
    fireEvent.change(screen.getByLabelText('New rank set name'), {
      target: { value: 'Main' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(
      await screen.findByRole('option', { name: /Main \(250\)/ }),
    ).toBeInTheDocument()
  })

  it('syncing a league updates it in place', async () => {
    mockBackend({
      initialLeagues: [
        {
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
        },
      ],
    })
    render(<LeaguesPage />)
    await screen.findByText('Sunday Funday')

    fireEvent.click(screen.getByRole('button', { name: 'Sync from Sleeper' }))

    expect(await screen.findByText('Renamed League')).toBeInTheDocument()
  })

  it('deleting a league requires a confirm click', async () => {
    mockBackend({
      initialLeagues: [
        {
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
        },
      ],
    })
    render(<LeaguesPage />)
    await screen.findByText('Sunday Funday')

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Sunday Funday')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete?' }))

    expect(await screen.findByText(/No leagues yet/)).toBeInTheDocument()
  })

  it("shows a league's team names as chips", async () => {
    mockBackend({
      initialLeagues: [
        {
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
        },
      ],
    })
    render(<LeaguesPage />)

    expect(await screen.findByText('Bourrow my Toe')).toBeInTheDocument()
    expect(screen.getByText('Rowdy Owls')).toBeInTheDocument()
  })

  it("changing a league's rank set calls the update endpoint", async () => {
    const fetchMock = mockBackend({
      initialLeagues: [
        {
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
        },
      ],
      initialRankSets: [
        {
          id: 5,
          name: 'Main',
          platform: 'sleeper',
          season: '2026',
          format: 'half_ppr',
          player_count: 300,
        },
      ],
    })
    render(<LeaguesPage />)
    await screen.findByText('Sunday Funday')
    // wait for the async rank-sets fetch to populate the <option> before
    // selecting it -- jsdom silently ignores setting a <select>'s value to
    // one with no matching <option> yet.
    await screen.findByRole('option', { name: 'Main (300)' })

    fireEvent.change(screen.getByLabelText('Rank set'), {
      target: { value: '5' },
    })

    const patchCall = await vi.waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        ([url, init]) =>
          (url as string).includes('/rank-set') &&
          (init as RequestInit)?.method === 'PATCH',
      )
      const last = calls.at(-1)
      if (!last) throw new Error('not called yet')
      return last
    })
    const [, init] = patchCall as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { rank_set_id: number }
    expect(body.rank_set_id).toBe(5)
  })
})
