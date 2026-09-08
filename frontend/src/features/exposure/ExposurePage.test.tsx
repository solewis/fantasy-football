import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ExposurePage } from './ExposurePage'

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

const PLAYERS = [
  {
    rank: 1,
    platform_player_id: '1',
    name: 'Garrett Wilson',
    position: 'WR',
    team: 'NYJ',
    adp: 22.0,
    tier: null,
    break_after: null,
    flag: null,
  },
  {
    rank: 2,
    platform_player_id: '2',
    name: 'Bijan Robinson',
    position: 'RB',
    team: 'ATL',
    adp: 3.0,
    tier: null,
    break_after: null,
    flag: null,
  },
]

function exposureRow(overrides: Partial<(typeof EXPOSURES)[number]> = {}) {
  return {
    id: 1,
    platform: 'sleeper',
    season: '2026',
    platform_player_id: '2',
    name: 'Bijan Robinson',
    position: 'RB',
    team: 'ATL',
    shares: 3,
    updated_at: '2026-09-08T00:00:00Z',
    ...overrides,
  }
}

const EXPOSURES = [exposureRow()]

function mockFetch({
  players = PLAYERS,
  exposures = [],
  postResponse,
}: {
  players?: unknown[]
  exposures?: unknown[]
  postResponse?: unknown
} = {}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const { pathname } = new URL(url)
    if (pathname === '/exposures' && (!init || init.method === undefined)) {
      return Promise.resolve(jsonResponse(exposures))
    }
    if (pathname === '/exposures' && init?.method === 'POST') {
      const body = JSON.parse((init.body as string) ?? '{}') as {
        platform_player_id: string
        shares: number
      }
      return Promise.resolve(
        jsonResponse(
          postResponse ?? {
            id: 99,
            platform: 'sleeper',
            season: '2026',
            platform_player_id: body.platform_player_id,
            name:
              players.find(
                (p) =>
                  (p as { platform_player_id: string }).platform_player_id ===
                  body.platform_player_id,
              )?.['name' as never] ?? 'Unknown',
            position: 'WR',
            team: 'NYJ',
            shares: body.shares,
            updated_at: '2026-09-08T00:00:00Z',
          },
        ),
      )
    }
    if (/^\/exposures\/\d+$/.exec(pathname) && init?.method === 'DELETE') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }
    if (pathname === '/players') return Promise.resolve(jsonResponse(players))
    return Promise.resolve(jsonResponse([]))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('ExposurePage', () => {
  it('shows a prompt when nothing is tracked yet', async () => {
    mockFetch({ exposures: [] })
    render(<ExposurePage />)

    expect(
      await screen.findByText(/haven't tracked any exposure yet/i),
    ).toBeInTheDocument()
  })

  it('lists tracked players with their share counts', async () => {
    mockFetch({ exposures: EXPOSURES })
    render(<ExposurePage />)

    expect(await screen.findByText('Bijan Robinson')).toBeInTheDocument()
    expect(screen.getByLabelText('Shares of Bijan Robinson')).toHaveValue(3)
  })

  it('searches unadded players and adds one on click', async () => {
    const fetchMock = mockFetch({ players: PLAYERS, exposures: [] })
    render(<ExposurePage />)
    await screen.findByText(/haven't tracked/i)

    fireEvent.change(screen.getByLabelText('Add a player'), {
      target: { value: 'Garrett' },
    })

    const candidate = await screen.findByRole('button', {
      name: /Garrett Wilson/,
    })
    fireEvent.click(candidate)

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            (url as string).endsWith('/exposures') &&
            (init as RequestInit)?.method === 'POST',
        ),
      ).toBe(true)
    })
    const post = fetchMock.mock.calls.find(
      ([url, init]) =>
        (url as string).endsWith('/exposures') &&
        (init as RequestInit)?.method === 'POST',
    )
    const body = JSON.parse((post![1] as RequestInit).body as string) as {
      platform_player_id: string
      shares: number
    }
    expect(body.platform_player_id).toBe('1')
    expect(body.shares).toBe(1)
  })

  it('excludes already-tracked players from the search candidates', async () => {
    mockFetch({ players: PLAYERS, exposures: EXPOSURES })
    render(<ExposurePage />)
    await screen.findByText('Bijan Robinson')

    fireEvent.change(screen.getByLabelText('Add a player'), {
      target: { value: 'Bijan' },
    })

    expect(screen.queryByRole('button', { name: /Bijan Robinson/ })).toBeNull()
    expect(screen.getByText(/No unadded player matching/)).toBeInTheDocument()
  })

  it('saves an edited share count on blur', async () => {
    const fetchMock = mockFetch({
      exposures: EXPOSURES,
      postResponse: { ...exposureRow(), shares: 5 },
    })
    render(<ExposurePage />)
    const input = await screen.findByLabelText('Shares of Bijan Robinson')

    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.blur(input)

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) =>
          (url as string).endsWith('/exposures') &&
          (init as RequestInit)?.method === 'POST',
      )
      expect(post).toBeDefined()
    })
    const post = fetchMock.mock.calls.find(
      ([url, init]) =>
        (url as string).endsWith('/exposures') &&
        (init as RequestInit)?.method === 'POST',
    )
    const body = JSON.parse((post![1] as RequestInit).body as string) as {
      shares: number
    }
    expect(body.shares).toBe(5)
  })

  it('reverts an invalid edit without saving', async () => {
    const fetchMock = mockFetch({ exposures: EXPOSURES })
    render(<ExposurePage />)
    const input = await screen.findByLabelText('Shares of Bijan Robinson')

    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(input).toHaveValue(3)
    })
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          (url as string).endsWith('/exposures') &&
          (init as RequestInit)?.method === 'POST',
      ),
    ).toBe(false)
  })

  it('does not save when the value is unchanged', async () => {
    const fetchMock = mockFetch({ exposures: EXPOSURES })
    render(<ExposurePage />)
    const input = await screen.findByLabelText('Shares of Bijan Robinson')

    fireEvent.blur(input)

    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          (url as string).endsWith('/exposures') &&
          (init as RequestInit)?.method === 'POST',
      ),
    ).toBe(false)
  })

  it('removes a tracked player', async () => {
    const fetchMock = mockFetch({ exposures: EXPOSURES })
    render(<ExposurePage />)
    await screen.findByText('Bijan Robinson')

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(screen.queryByText('Bijan Robinson')).toBeNull()
    })
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          /\/exposures\/\d+$/.exec(url as string) &&
          (init as RequestInit)?.method === 'DELETE',
      ),
    ).toBe(true)
  })
})
