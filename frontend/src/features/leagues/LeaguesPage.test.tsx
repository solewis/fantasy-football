import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LeagueSummary } from '../../api/leagues'
import type { RankSetSummary } from '../../api/ranks'
import type { DraftSummary } from '../../lib/draftSummary'
import { LeaguesPage } from './LeaguesPage'

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
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

/** A small in-memory stand-in for the leagues + rank-sets backend --
 * LeaguesPage only makes network calls for its own "+ Add League" flow now
 * (the list itself and per-league drafts are props from LeaguesSection). */
function mockBackend({
  initialRankSets = [],
  lookupResult = {
    name: 'Sunday Funday',
    season: '2026',
    num_teams: 10,
    roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
    suggested_format: 'half_ppr',
  },
}: {
  initialRankSets?: RankSetSummary[]
  lookupResult?: {
    name: string
    season: string
    num_teams: number
    roster_positions: string[]
    suggested_format: string | null
  }
} = {}) {
  let rankSets = [...initialRankSets]
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
    if (pathname === '/leagues' && method === 'POST') {
      const created: LeagueSummary = {
        id: 1,
        platform: 'sleeper',
        platform_league_id: body?.platform_league_id as string,
        name: lookupResult.name,
        season: lookupResult.season,
        format: body?.format as string,
        num_teams: lookupResult.num_teams,
        roster_positions: lookupResult.roster_positions,
        team_names: {},
        rank_set_id: (body?.rank_set_id as number | null) ?? null,
      }
      return Promise.resolve(jsonResponse(created))
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
      rankSets = [...rankSets, created]
      return Promise.resolve(jsonResponse(created))
    }
    return Promise.resolve(jsonResponse([]))
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const noop = {
  onLeagueCreated: vi.fn(),
  onSelectLeague: vi.fn(),
  onStartAdHoc: vi.fn(),
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('LeaguesPage', () => {
  it('shows an empty state when there are no leagues yet', () => {
    render(
      <LeaguesPage
        leagues={[]}
        loading={false}
        error={null}
        draftsByLeague={new Map()}
        {...noop}
      />,
    )

    expect(screen.getByText(/No leagues yet/)).toBeInTheDocument()
  })

  it('looking up a league shows a preview with the suggested format', async () => {
    mockBackend()
    render(
      <LeaguesPage
        leagues={[]}
        loading={false}
        error={null}
        draftsByLeague={new Map()}
        {...noop}
      />,
    )

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

  it('adding a league posts to /leagues and calls onLeagueCreated', async () => {
    const fetchMock = mockBackend()
    const onLeagueCreated = vi.fn()
    render(
      <LeaguesPage
        leagues={[]}
        loading={false}
        error={null}
        draftsByLeague={new Map()}
        {...noop}
        onLeagueCreated={onLeagueCreated}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '+ Add League' }))
    fireEvent.change(screen.getByPlaceholderText(/e.g. 139/), {
      target: { value: '999' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Look Up' }))
    await screen.findByText('Sunday Funday')

    fireEvent.click(screen.getByRole('button', { name: 'Add League' }))
    await vi.waitFor(() => {
      expect(onLeagueCreated).toHaveBeenCalled()
    })

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
    mockBackend({ initialRankSets: [] })
    render(
      <LeaguesPage
        leagues={[]}
        loading={false}
        error={null}
        draftsByLeague={new Map()}
        {...noop}
      />,
    )

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

  it('clicking a league card calls onSelectLeague', () => {
    const onSelectLeague = vi.fn()
    render(
      <LeaguesPage
        leagues={[sampleLeague]}
        loading={false}
        error={null}
        draftsByLeague={new Map()}
        {...noop}
        onSelectLeague={onSelectLeague}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Sunday Funday/ }))

    expect(onSelectLeague).toHaveBeenCalledWith(1)
  })

  it('shows a draft-in-progress badge for a league with an active draft', () => {
    const draft: DraftSummary = {
      id: 5,
      next_pick_number: 4,
      current_round: 2,
      is_complete: false,
    }
    render(
      <LeaguesPage
        leagues={[sampleLeague]}
        loading={false}
        error={null}
        draftsByLeague={new Map([[sampleLeague.id, draft]])}
        {...noop}
      />,
    )

    expect(
      screen.getByText('Draft in progress · Round 2, Pick 4'),
    ).toBeInTheDocument()
  })

  it('clicking the ad-hoc footer link calls onStartAdHoc', () => {
    const onStartAdHoc = vi.fn()
    render(
      <LeaguesPage
        leagues={[]}
        loading={false}
        error={null}
        draftsByLeague={new Map()}
        {...noop}
        onStartAdHoc={onStartAdHoc}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: /Start a draft without a league/ }),
    )

    expect(onStartAdHoc).toHaveBeenCalled()
  })
})
