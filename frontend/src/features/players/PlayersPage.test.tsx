import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlayerRow } from '../../api/players'
import { PlayersPage } from './PlayersPage'

const samplePlayers: PlayerRow[] = [
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

const emptySyncStatus = {
  players: { last_synced_at: null, record_count: 0 },
  adp: { season: '2026', last_synced_at: null, record_count: 0 },
}

/** SyncPanel fetches /sync/status on mount alongside PlayersPage's own /players
 * fetch, so the mock needs to route by URL rather than return one fixed value. */
function mockFetch(playersResponse: {
  ok: boolean
  status?: number
  body: unknown
}) {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes('/sync/status')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(emptySyncStatus),
      })
    }
    return Promise.resolve({
      ok: playersResponse.ok,
      status: playersResponse.status,
      json: () => Promise.resolve(playersResponse.body),
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function playersCallCount(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([url]) => !(url as string).includes('/sync/'),
  ).length
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('PlayersPage', () => {
  it('renders players once loaded', async () => {
    mockFetch({ ok: true, body: samplePlayers })

    render(<PlayersPage />)

    expect(await screen.findByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(screen.getByText('Bijan Robinson')).toBeInTheDocument()

    const table = screen.getByRole('table')
    expect(within(table).getByText('WR')).toBeInTheDocument()
    expect(within(table).getByText('RB')).toBeInTheDocument()
  })

  it('shows an empty state when no players match', async () => {
    mockFetch({ ok: true, body: [] })

    render(<PlayersPage />)

    expect(await screen.findByText('No players found.')).toBeInTheDocument()
  })

  it('shows an error message when the fetch fails', async () => {
    mockFetch({ ok: false, status: 500, body: [] })

    render(<PlayersPage />)

    expect(
      await screen.findByText(/Failed to fetch players/),
    ).toBeInTheDocument()
  })

  it('filters by position client-side without refetching', async () => {
    const fetchMock = mockFetch({ ok: true, body: samplePlayers })
    render(<PlayersPage />)
    await screen.findByText("Ja'Marr Chase")

    fireEvent.click(screen.getByRole('tab', { name: 'RB' }))

    expect(await screen.findByText('Bijan Robinson')).toBeInTheDocument()
    expect(screen.queryByText("Ja'Marr Chase")).not.toBeInTheDocument()
    expect(playersCallCount(fetchMock)).toBe(1)
  })

  it('filters by search text client-side without refetching', async () => {
    const fetchMock = mockFetch({ ok: true, body: samplePlayers })
    render(<PlayersPage />)
    await screen.findByText("Ja'Marr Chase")

    fireEvent.change(screen.getByPlaceholderText('Find player'), {
      target: { value: 'chase' },
    })

    expect(screen.getByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(screen.queryByText('Bijan Robinson')).not.toBeInTheDocument()
    expect(playersCallCount(fetchMock)).toBe(1)
  })

  it('refetches with only season/format when the format dropdown changes', async () => {
    const fetchMock = mockFetch({ ok: true, body: samplePlayers })
    render(<PlayersPage />)
    await screen.findByText("Ja'Marr Chase")

    fireEvent.change(screen.getByLabelText('Scoring format'), {
      target: { value: 'ppr' },
    })

    await waitFor(() => {
      expect(playersCallCount(fetchMock)).toBe(2)
    })
    const lastPlayersCall = fetchMock.mock.calls
      .map(([url]) => url as string)
      .filter((url) => !url.includes('/sync/'))
      .at(-1)
    expect(lastPlayersCall).toContain('format=ppr')
    expect(lastPlayersCall).not.toContain('position=')
    expect(lastPlayersCall).not.toContain('search=')
  })
})
