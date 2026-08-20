import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DraftStatus } from '../../api/draft'
import type { LeagueSummary } from '../../api/leagues'
import { DraftSetupForm } from './DraftSetupForm'

const sampleStatus: DraftStatus = {
  draft: {
    id: 1,
    platform: 'manual',
    platform_draft_id: null,
    league_id: null,
    season: '2026',
    format: 'half_ppr',
    num_teams: 10,
    num_rounds: 14,
    my_slot: 1,
    rank_set_id: null,
    roster_positions: null,
    team_names: {},
  },
  picks: [],
  next_pick_number: 1,
  current_round: 1,
  current_slot: 1,
  is_my_turn: true,
  is_complete: false,
}

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

/** Routes GET /leagues separately so DraftSetupForm's own-mount fetch for the
 * "From a League" picker doesn't interfere with whatever the test is
 * actually asserting about the draft-creation call. */
function mockFetch({
  leagues = [],
  draftResponse = jsonResponse(sampleStatus),
}: {
  leagues?: LeagueSummary[]
  draftResponse?: { ok: boolean; status?: number; json: () => Promise<unknown> }
} = {}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    void init
    if (url.includes('/leagues')) {
      return Promise.resolve(jsonResponse(leagues))
    }
    return Promise.resolve(draftResponse)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function findDraftCall(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls.find(
    ([url]) => !(url as string).includes('/leagues'),
  ) as [string, RequestInit]
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('DraftSetupForm', () => {
  it('submits settings and calls onCreated on success', async () => {
    const fetchMock = mockFetch()
    const onCreated = vi.fn()

    render(<DraftSetupForm onCreated={onCreated} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))

    await vi.waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(sampleStatus)
    })
    const [url, init] = findDraftCall(fetchMock)
    expect(url).toContain('/drafts')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({
      season: '2026',
      format: 'half_ppr',
      num_teams: 10,
      num_rounds: 14,
      my_slot: 1,
    })
  })

  it('disables submit and shows an error when the slot is out of range', () => {
    mockFetch()
    render(<DraftSetupForm onCreated={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Your draft slot'), {
      target: { value: '99' },
    })

    expect(
      screen.getByText('Slot must be between 1 and 10.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Draft' })).toBeDisabled()
  })

  it('shows an error message when creation fails', async () => {
    mockFetch({
      draftResponse: {
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      },
    })

    render(<DraftSetupForm onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))

    expect(await screen.findByText(/Creating draft/)).toBeInTheDocument()
  })

  it('switching to Sleeper mode swaps in the draft-id field', () => {
    mockFetch()
    render(<DraftSetupForm onCreated={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Sync from Sleeper' }))

    expect(screen.getByLabelText('Sleeper draft ID')).toBeInTheDocument()
    expect(screen.queryByLabelText('Number of teams')).not.toBeInTheDocument()
  })

  it('disables submit until a Sleeper draft ID is entered', () => {
    mockFetch()
    render(<DraftSetupForm onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Sync from Sleeper' }))

    expect(screen.getByRole('button', { name: 'Start Draft' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Sleeper draft ID'), {
      target: { value: '999' },
    })

    expect(screen.getByRole('button', { name: 'Start Draft' })).toBeEnabled()
  })

  it('submits to the Sleeper endpoint with the entered draft ID', async () => {
    const sleeperStatus: DraftStatus = {
      ...sampleStatus,
      draft: {
        ...sampleStatus.draft,
        platform: 'sleeper',
        platform_draft_id: '999',
      },
    }
    const fetchMock = mockFetch({ draftResponse: jsonResponse(sleeperStatus) })
    const onCreated = vi.fn()

    render(<DraftSetupForm onCreated={onCreated} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Sync from Sleeper' }))
    fireEvent.change(screen.getByLabelText('Sleeper draft ID'), {
      target: { value: '999' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))

    await vi.waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(sleeperStatus)
    })
    const [url, init] = findDraftCall(fetchMock)
    expect(url).toContain('/drafts/sleeper')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({
      platform_draft_id: '999',
      format: 'half_ppr',
      my_slot: 1,
    })
  })

  it('shows a message when there are no leagues yet', async () => {
    mockFetch({ leagues: [] })
    render(<DraftSetupForm onCreated={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'From a League' }))

    expect(await screen.findByText(/No leagues yet/)).toBeInTheDocument()
  })

  it('lists leagues and submits to the league endpoint', async () => {
    const league: LeagueSummary = {
      id: 7,
      platform: 'sleeper',
      platform_league_id: '555',
      name: 'Sunday Funday',
      season: '2026',
      format: 'half_ppr',
      num_teams: 10,
      roster_positions: ['QB'],
      team_names: {},
      rank_set_id: null,
    }
    const leagueStatus: DraftStatus = {
      ...sampleStatus,
      draft: { ...sampleStatus.draft, league_id: 7 },
    }
    const fetchMock = mockFetch({
      leagues: [league],
      draftResponse: jsonResponse(leagueStatus),
    })
    const onCreated = vi.fn()

    render(<DraftSetupForm onCreated={onCreated} />)
    fireEvent.click(screen.getByRole('tab', { name: 'From a League' }))
    await screen.findByRole('option', { name: /Sunday Funday/ })
    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))

    await vi.waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(leagueStatus)
    })
    const [url, init] = findDraftCall(fetchMock)
    expect(url).toContain('/drafts/league')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({ league_id: 7, my_slot: 1 })
  })

  it('rejects a draft slot beyond the selected league’s team count', async () => {
    const league: LeagueSummary = {
      id: 7,
      platform: 'sleeper',
      platform_league_id: '555',
      name: 'Sunday Funday',
      season: '2026',
      format: 'half_ppr',
      num_teams: 4,
      roster_positions: ['QB'],
      team_names: {},
      rank_set_id: null,
    }
    mockFetch({ leagues: [league] })

    render(<DraftSetupForm onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'From a League' }))
    await screen.findByRole('option', { name: /Sunday Funday/ })

    fireEvent.change(screen.getByLabelText('Your draft slot'), {
      target: { value: '9' },
    })

    expect(
      screen.getByText('Slot must be between 1 and 4.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Draft' })).toBeDisabled()
  })
})
