import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ExposurePage } from './ExposurePage'

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

const RANK_SETS = [
  {
    id: 1,
    name: 'Half PPR Main',
    platform: 'sleeper',
    season: '2026',
    format: 'half_ppr',
    scope: 'overall',
    is_active: true,
    player_count: 2,
  },
]

const RANKS = [
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

function exposureRow(
  overrides: Partial<{
    id: number
    platform: string
    season: string
    platform_player_id: string
    name: string
    position: string
    team: string
    shares: number
    updated_at: string
  }> = {},
) {
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

function mockFetch({
  rankSets = RANK_SETS,
  ranksBySetId = { 1: RANKS },
  exposures = [],
  postResponse,
}: {
  rankSets?: unknown[]
  ranksBySetId?: Record<number, unknown[]>
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
      const match = RANKS.find(
        (r) => r.platform_player_id === body.platform_player_id,
      )
      return Promise.resolve(
        jsonResponse(
          postResponse ?? {
            id: 99,
            platform: 'sleeper',
            season: '2026',
            platform_player_id: body.platform_player_id,
            name: match?.name ?? 'Unknown',
            position: match?.position ?? null,
            team: match?.team ?? null,
            shares: body.shares,
            updated_at: '2026-09-08T00:00:00Z',
          },
        ),
      )
    }
    if (/^\/exposures\/\d+$/.exec(pathname) && init?.method === 'DELETE') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }
    if (pathname === '/rank-sets')
      return Promise.resolve(jsonResponse(rankSets))
    const setRanksMatch = /^\/rank-sets\/(\d+)\/ranks$/.exec(pathname)
    if (setRanksMatch) {
      const id = Number(setRanksMatch[1])
      return Promise.resolve(jsonResponse(ranksBySetId[id] ?? []))
    }
    return Promise.resolve(jsonResponse([]))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

async function chooseRankList() {
  fireEvent.change(await screen.findByRole('combobox', { name: 'Rank list' }), {
    target: { value: '1' },
  })
}

describe('ExposurePage', () => {
  it('prompts to choose a rank list before showing anything else', async () => {
    mockFetch()
    render(<ExposurePage />)

    expect(
      await screen.findByText(/choose a rank list above/i),
    ).toBeInTheDocument()
  })

  it('says so when no rank list exists yet', async () => {
    mockFetch({ rankSets: [] })
    render(<ExposurePage />)

    expect(await screen.findByText(/no rank lists yet/i)).toBeInTheDocument()
  })

  it('shows every player in the chosen list, defaulting to 0 shares', async () => {
    mockFetch({ exposures: [] })
    render(<ExposurePage />)
    await chooseRankList()

    expect(await screen.findByText('Garrett Wilson')).toBeInTheDocument()
    expect(screen.getByText('Bijan Robinson')).toBeInTheDocument()
    expect(screen.getByLabelText('Shares of Garrett Wilson')).toHaveValue(0)
    expect(screen.getByLabelText('Shares of Bijan Robinson')).toHaveValue(0)
  })

  it('shows an existing exposure record for a player already tracked', async () => {
    mockFetch({ exposures: [exposureRow()] })
    render(<ExposurePage />)
    await chooseRankList()

    await waitFor(() => {
      expect(screen.getByLabelText('Shares of Bijan Robinson')).toHaveValue(3)
    })
    expect(screen.getByLabelText('Shares of Garrett Wilson')).toHaveValue(0)
  })

  it('saves a new share count on blur', async () => {
    const fetchMock = mockFetch({ exposures: [] })
    render(<ExposurePage />)
    await chooseRankList()
    const input = await screen.findByLabelText('Shares of Garrett Wilson')

    fireEvent.change(input, { target: { value: '2' } })
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
      platform_player_id: string
      shares: number
    }
    expect(body.platform_player_id).toBe('1')
    expect(body.shares).toBe(2)
  })

  it('zeroing an existing exposure deletes it rather than saving a 0', async () => {
    const fetchMock = mockFetch({ exposures: [exposureRow()] })
    render(<ExposurePage />)
    await chooseRankList()
    const input = await screen.findByLabelText('Shares of Bijan Robinson')
    await waitFor(() => expect(input).toHaveValue(3))

    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            /\/exposures\/1$/.exec(url as string) &&
            (init as RequestInit)?.method === 'DELETE',
        ),
      ).toBe(true)
    })
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          (url as string).endsWith('/exposures') &&
          (init as RequestInit)?.method === 'POST',
      ),
    ).toBe(false)
  })

  it('does nothing when zeroing a player who was already at 0', async () => {
    const fetchMock = mockFetch({ exposures: [] })
    render(<ExposurePage />)
    await chooseRankList()
    const input = await screen.findByLabelText('Shares of Garrett Wilson')

    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(input).toHaveValue(0)
    })
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          ((url as string).endsWith('/exposures') &&
            (init as RequestInit)?.method === 'POST') ||
          /\/exposures\/\d+$/.exec(url as string),
      ),
    ).toBe(false)
  })

  it('reverts an invalid edit without saving', async () => {
    const fetchMock = mockFetch({ exposures: [exposureRow()] })
    render(<ExposurePage />)
    await chooseRankList()
    const input = await screen.findByLabelText('Shares of Bijan Robinson')
    await waitFor(() => expect(input).toHaveValue(3))

    fireEvent.change(input, { target: { value: '-1' } })
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
    const fetchMock = mockFetch({ exposures: [exposureRow()] })
    render(<ExposurePage />)
    await chooseRankList()
    const input = await screen.findByLabelText('Shares of Bijan Robinson')
    await waitFor(() => expect(input).toHaveValue(3))

    fireEvent.blur(input)

    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          (url as string).endsWith('/exposures') &&
          (init as RequestInit)?.method === 'POST',
      ),
    ).toBe(false)
  })

  it('filters visible rows by name', async () => {
    mockFetch({ exposures: [] })
    render(<ExposurePage />)
    await chooseRankList()
    await screen.findByText('Garrett Wilson')

    fireEvent.change(screen.getByLabelText('Find player'), {
      target: { value: 'Bijan' },
    })

    expect(screen.queryByText('Garrett Wilson')).toBeNull()
    expect(screen.getByText('Bijan Robinson')).toBeInTheDocument()
  })

  it('marks the highest-shares row with the top gradient level', async () => {
    mockFetch({
      exposures: [
        exposureRow({
          id: 1,
          platform_player_id: '1',
          name: 'Garrett Wilson',
          shares: 1,
        }),
        exposureRow({
          id: 2,
          platform_player_id: '2',
          name: 'Bijan Robinson',
          shares: 5,
        }),
      ],
    })
    render(<ExposurePage />)
    await chooseRankList()
    await screen.findByText('Garrett Wilson')

    const rows = screen.getAllByRole('row').slice(1)
    const bijanRow = rows.find((r) => r.textContent?.includes('Bijan Robinson'))
    const wilsonRow = rows.find((r) =>
      r.textContent?.includes('Garrett Wilson'),
    )
    expect(bijanRow).toHaveAttribute('data-share-level', '5')
    expect(wilsonRow).toHaveAttribute('data-share-level', '1')
  })

  it('gives an untracked (0-share) row no gradient level', async () => {
    mockFetch({
      exposures: [exposureRow({ id: 2, platform_player_id: '2', shares: 5 })],
    })
    render(<ExposurePage />)
    await chooseRankList()
    await screen.findByText('Garrett Wilson')

    const rows = screen.getAllByRole('row').slice(1)
    const wilsonRow = rows.find((r) =>
      r.textContent?.includes('Garrett Wilson'),
    )
    expect(wilsonRow).toHaveAttribute('data-share-level', '0')
  })
})
