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

function mockFetchOnce(rows: PlayerRow[]) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(rows),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('PlayersPage', () => {
  it('renders players once loaded', async () => {
    mockFetchOnce(samplePlayers)

    render(<PlayersPage />)

    expect(await screen.findByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(screen.getByText('Bijan Robinson')).toBeInTheDocument()

    const table = screen.getByRole('table')
    expect(within(table).getByText('WR')).toBeInTheDocument()
    expect(within(table).getByText('RB')).toBeInTheDocument()
  })

  it('shows an empty state when no players match', async () => {
    mockFetchOnce([])

    render(<PlayersPage />)

    expect(await screen.findByText('No players found.')).toBeInTheDocument()
  })

  it('shows an error message when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve([]),
      }),
    )

    render(<PlayersPage />)

    expect(
      await screen.findByText(/Failed to fetch players/),
    ).toBeInTheDocument()
  })

  it('filters by position client-side without refetching', async () => {
    const fetchMock = mockFetchOnce(samplePlayers)
    render(<PlayersPage />)
    await screen.findByText("Ja'Marr Chase")

    fireEvent.click(screen.getByRole('tab', { name: 'RB' }))

    expect(await screen.findByText('Bijan Robinson')).toBeInTheDocument()
    expect(screen.queryByText("Ja'Marr Chase")).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('filters by search text client-side without refetching', async () => {
    const fetchMock = mockFetchOnce(samplePlayers)
    render(<PlayersPage />)
    await screen.findByText("Ja'Marr Chase")

    fireEvent.change(screen.getByPlaceholderText('Find player'), {
      target: { value: 'chase' },
    })

    expect(screen.getByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(screen.queryByText('Bijan Robinson')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refetches with only season/format when the format dropdown changes', async () => {
    const fetchMock = mockFetchOnce(samplePlayers)
    render(<PlayersPage />)
    await screen.findByText("Ja'Marr Chase")

    fireEvent.change(screen.getByLabelText('Scoring format'), {
      target: { value: 'ppr' },
    })

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1)?.[0] as string
      expect(lastCall).toContain('format=ppr')
      expect(lastCall).not.toContain('position=')
      expect(lastCall).not.toContain('search=')
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
