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

// ADP's dense rank for each player, on whatever axis the request asked for
// -- defaults match RANKS' own rank order (ADP agrees with you) so tests
// that don't care about the vs-ADP column see a neutral "0" chip rather
// than an arbitrary one.
const DEFAULT_ADP_RANKS: Record<string, number | null> = { '1': 1, '2': 2 }

function mockFetch({
  rankSets = RANK_SETS,
  ranksBySetId = { 1: RANKS },
  exposures = [],
  adpRanks = DEFAULT_ADP_RANKS,
  postResponse,
}: {
  rankSets?: unknown[]
  ranksBySetId?: Record<number, unknown[]>
  exposures?: unknown[]
  adpRanks?: Record<string, number | null>
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
    if (pathname === '/rank-pool') {
      return Promise.resolve(
        jsonResponse({
          scope: 'overall',
          sources: [
            {
              ref: 'adp',
              label: 'ADP',
              kind: 'adp',
              depth: 2,
              unresolved_count: 0,
            },
          ],
          players: RANKS.map((r) => ({
            platform_player_id: r.platform_player_id,
            name: r.name,
            position: r.position,
            team: r.team,
            adp: r.adp,
            ranks: { adp: adpRanks[r.platform_player_id] ?? null },
          })),
        }),
      )
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

  it('the + button increments and saves immediately', async () => {
    const fetchMock = mockFetch({
      exposures: [exposureRow()],
      postResponse: { ...exposureRow(), shares: 4 },
    })
    render(<ExposurePage />)
    await chooseRankList()
    const input = await screen.findByLabelText('Shares of Bijan Robinson')
    await waitFor(() => expect(input).toHaveValue(3))

    fireEvent.click(
      screen.getByRole('button', { name: 'Increase shares of Bijan Robinson' }),
    )

    await waitFor(() => {
      expect(input).toHaveValue(4)
    })
    const post = fetchMock.mock.calls.find(
      ([url, init]) =>
        (url as string).endsWith('/exposures') &&
        (init as RequestInit)?.method === 'POST',
    )
    expect(post).toBeDefined()
    const body = JSON.parse((post![1] as RequestInit).body as string) as {
      shares: number
    }
    expect(body.shares).toBe(4)
  })

  it('the - button decrements, deleting the record once it reaches 0', async () => {
    const fetchMock = mockFetch({ exposures: [exposureRow({ shares: 1 })] })
    render(<ExposurePage />)
    await chooseRankList()
    const input = await screen.findByLabelText('Shares of Bijan Robinson')
    await waitFor(() => expect(input).toHaveValue(1))

    fireEvent.click(
      screen.getByRole('button', { name: 'Decrease shares of Bijan Robinson' }),
    )

    await waitFor(() => {
      expect(input).toHaveValue(0)
    })
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          /\/exposures\/1$/.exec(url as string) &&
          (init as RequestInit)?.method === 'DELETE',
      ),
    ).toBe(true)
  })

  it('disables the - button once shares reaches 0', async () => {
    mockFetch({ exposures: [] })
    render(<ExposurePage />)
    await chooseRankList()
    await screen.findByLabelText('Shares of Garrett Wilson')

    expect(
      screen.getByRole('button', { name: 'Decrease shares of Garrett Wilson' }),
    ).toBeDisabled()
  })

  it('the + button acts on an uncommitted typed value, not the last saved one', async () => {
    const fetchMock = mockFetch({ exposures: [] })
    render(<ExposurePage />)
    await chooseRankList()
    const input = await screen.findByLabelText('Shares of Garrett Wilson')

    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.click(
      screen.getByRole('button', { name: 'Increase shares of Garrett Wilson' }),
    )

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
    // Typed 5, then +1 -- must save 6, not silently discard the typed 5 in
    // favour of the last-saved value (0) and save 1 instead.
    expect(body.shares).toBe(6)
  })

  it('shows the raw ADP number as its own column', async () => {
    mockFetch({ exposures: [] })
    render(<ExposurePage />)
    await chooseRankList()
    await screen.findByText('Garrett Wilson')

    expect(screen.getByText('22.0')).toBeInTheDocument()
    expect(screen.getByText('3.0')).toBeInTheDocument()
  })

  it("shows how far ahead of or behind ADP each player's rank is", async () => {
    // ADP's dense rank for Garrett Wilson is 3 (worse than your #1) --
    // you're ahead of ADP on him by 2 spots.
    mockFetch({ exposures: [], adpRanks: { '1': 3, '2': 2 } })
    render(<ExposurePage />)
    await chooseRankList()
    await screen.findByText('Garrett Wilson')

    expect(screen.getByText('3 (+2)')).toBeInTheDocument()
    // Bijan Robinson: ADP dense rank 2 equals your #2 -- no gap.
    expect(screen.getByText('2 (0)')).toBeInTheDocument()
  })

  it('shows a missing chip when a player in the list has no ADP', async () => {
    mockFetch({ exposures: [], adpRanks: { '1': null, '2': 2 } })
    render(<ExposurePage />)
    await chooseRankList()
    await screen.findByText('Garrett Wilson')

    const rows = screen.getAllByRole('row').slice(1)
    const wilsonRow = rows.find((r) =>
      r.textContent?.includes('Garrett Wilson'),
    )
    expect(wilsonRow?.querySelector('[data-missing="true"]')).not.toBeNull()
  })

  it("fetches ADP scoped to the chosen rank list's own format and scope", async () => {
    const fetchMock = mockFetch({ exposures: [] })
    render(<ExposurePage />)
    await chooseRankList()
    await screen.findByText('Garrett Wilson')

    await waitFor(() => {
      const poolCall = fetchMock.mock.calls.find(([url]) =>
        (url as string).includes('/rank-pool'),
      )
      expect(poolCall).toBeDefined()
    })
    const poolCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('/rank-pool'),
    )
    const url = new URL(poolCall![0] as string)
    expect(url.searchParams.get('format')).toBe('half_ppr')
    expect(url.searchParams.get('scope')).toBe('overall')
    expect(url.searchParams.getAll('source_ref')).toEqual(['adp'])
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
