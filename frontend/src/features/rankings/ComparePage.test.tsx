import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ComparePage } from './ComparePage'

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

const RANK_SETS = [
  {
    id: 1,
    name: 'My WRs',
    platform: 'sleeper',
    season: '2026',
    format: 'half_ppr',
    scope: 'WR',
    is_active: true,
    player_count: 2,
  },
  {
    id: 2,
    name: 'My QBs',
    platform: 'sleeper',
    season: '2026',
    format: 'half_ppr',
    scope: 'QB',
    is_active: true,
    player_count: 1,
  },
]

const SOURCES = [
  {
    ref: 'adp',
    label: 'ADP',
    kind: 'adp',
    supports_overall: true,
    supports_positional: true,
    scope: null,
    is_active: null,
  },
  {
    ref: 'dataset:1',
    label: 'FantasyPros',
    kind: 'dataset',
    supports_overall: true,
    supports_positional: true,
    scope: null,
    is_active: null,
  },
  {
    ref: 'rank_set:1',
    label: 'My WRs',
    kind: 'rank_set',
    supports_overall: false,
    supports_positional: true,
    scope: 'WR',
    is_active: true,
  },
  {
    ref: 'rank_set:2',
    label: 'My QBs',
    kind: 'rank_set',
    supports_overall: false,
    supports_positional: true,
    scope: 'QB',
    is_active: true,
  },
]

const WR_RANKS = [
  {
    rank: 1,
    platform_player_id: 'w1',
    name: 'Garrett Wilson',
    position: 'WR',
    team: 'NYJ',
    adp: 22.0,
    tier: 1,
    break_after: null,
    flag: null,
  },
  {
    rank: 2,
    platform_player_id: 'w2',
    name: 'Puka Nacua',
    position: 'WR',
    team: 'LAR',
    adp: 4.0,
    tier: 2,
    break_after: null,
    flag: null,
  },
]

function mockFetch({
  ranksBySetId = {},
  poolPlayers = [],
}: {
  ranksBySetId?: Record<number, unknown[]>
  poolPlayers?: unknown[]
} = {}) {
  const fetchMock = vi.fn((url: string) => {
    const { pathname } = new URL(url)
    if (pathname === '/rank-sets')
      return Promise.resolve(jsonResponse(RANK_SETS))
    if (pathname === '/rank-sources')
      return Promise.resolve(jsonResponse(SOURCES))
    const setRanksMatch = /^\/rank-sets\/(\d+)\/ranks$/.exec(pathname)
    if (setRanksMatch) {
      const id = Number(setRanksMatch[1])
      return Promise.resolve(jsonResponse(ranksBySetId[id] ?? []))
    }
    if (pathname === '/rank-pool') {
      return Promise.resolve(
        jsonResponse({
          scope: 'WR',
          sources: [],
          players: poolPlayers,
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

describe('ComparePage', () => {
  it('prompts to choose a rank set before showing anything else', async () => {
    mockFetch()
    render(<ComparePage platform="sleeper" format="half_ppr" />)

    expect(
      await screen.findByText(/choose one of your rank sets/i),
    ).toBeInTheDocument()
  })

  it('loads the chosen rank set and lists its players', async () => {
    mockFetch({ ranksBySetId: { 1: WR_RANKS } })
    render(<ComparePage platform="sleeper" format="half_ppr" />)

    fireEvent.change(
      await screen.findByRole('combobox', { name: 'My rank set' }),
      {
        target: { value: '1' },
      },
    )

    expect(await screen.findByText('Garrett Wilson')).toBeInTheDocument()
    expect(screen.getByText('Puka Nacua')).toBeInTheDocument()
  })

  it("excludes the baseline set's own ref from the source picker", async () => {
    mockFetch({ ranksBySetId: { 1: WR_RANKS } })
    render(<ComparePage platform="sleeper" format="half_ppr" />)
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'My rank set' }),
      {
        target: { value: '1' },
      },
    )
    await screen.findByText('Garrett Wilson')

    expect(screen.queryByRole('checkbox', { name: /My WRs/ })).toBeNull()
    expect(screen.getByRole('checkbox', { name: /ADP/ })).toBeInTheDocument()
  })

  it('only offers sources matching the baseline scope', async () => {
    mockFetch({ ranksBySetId: { 1: WR_RANKS } })
    render(<ComparePage platform="sleeper" format="half_ppr" />)
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'My rank set' }),
      {
        target: { value: '1' },
      },
    )
    await screen.findByText('Garrett Wilson')

    // A QB list is not a sensible comparison source for a WR list.
    expect(screen.queryByRole('checkbox', { name: /My QBs/ })).toBeNull()
  })

  it("shows each source rank against the player's own rank, not a single fixed slot", async () => {
    mockFetch({
      ranksBySetId: { 1: WR_RANKS },
      poolPlayers: [
        {
          platform_player_id: 'w1',
          name: 'Garrett Wilson',
          position: 'WR',
          team: 'NYJ',
          adp: 22.0,
          ranks: { adp: 4 },
        },
        {
          platform_player_id: 'w2',
          name: 'Puka Nacua',
          position: 'WR',
          team: 'LAR',
          adp: 4.0,
          ranks: { adp: 6 },
        },
      ],
    })
    render(<ComparePage platform="sleeper" format="half_ppr" />)
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'My rank set' }),
      {
        target: { value: '1' },
      },
    )
    await screen.findByText('Garrett Wilson')

    fireEvent.click(screen.getByRole('checkbox', { name: /ADP/ }))

    // Garrett Wilson: your rank 1, ADP rank 4 -> +3.
    // Puka Nacua: your rank 2, ADP rank 6 -> +4.
    await waitFor(() => {
      expect(screen.getByText('4 (+3)')).toBeInTheDocument()
    })
    expect(screen.getByText('6 (+4)')).toBeInTheDocument()
  })

  it('shows an average across the checked sources, excluding ADP', async () => {
    mockFetch({
      ranksBySetId: { 1: WR_RANKS },
      poolPlayers: [
        {
          platform_player_id: 'w1',
          name: 'Garrett Wilson',
          position: 'WR',
          team: 'NYJ',
          adp: 22.0,
          ranks: { adp: 999, 'dataset:1': 3 },
        },
      ],
    })
    render(<ComparePage platform="sleeper" format="half_ppr" />)
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'My rank set' }),
      { target: { value: '1' } },
    )
    await screen.findByText('Garrett Wilson')

    fireEvent.click(screen.getByRole('checkbox', { name: /ADP/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /FantasyPros/ }))

    // Only FantasyPros (3) counts -- ADP's wildly different 999 must not
    // drag the average anywhere near it.
    await waitFor(() => {
      expect(screen.getByText('3.0')).toBeInTheDocument()
    })
  })

  it('hides the average column entirely when no source is checked', async () => {
    mockFetch({ ranksBySetId: { 1: WR_RANKS } })
    render(<ComparePage platform="sleeper" format="half_ppr" />)
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'My rank set' }),
      { target: { value: '1' } },
    )
    await screen.findByText('Garrett Wilson')

    expect(screen.queryByRole('columnheader', { name: 'Avg' })).toBeNull()
  })

  it('draws a tier break where the tier number changes, as its own divider row', async () => {
    mockFetch({ ranksBySetId: { 1: WR_RANKS } })
    render(<ComparePage platform="sleeper" format="half_ppr" />)
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'My rank set' }),
      { target: { value: '1' } },
    )
    await screen.findByText('Garrett Wilson')

    const rows = screen.getAllByRole('row').slice(1)
    // Wilson (tier 1), the divider, then Nacua (tier 2).
    expect(rows[0].className).not.toContain('compare-tier-divider')
    expect(rows[1].className).toContain('compare-tier-divider')
    expect(rows[1].className).toContain('minor')
    expect(rows[2].textContent).toContain('Puka Nacua')
    expect(screen.getByText(/Tier 2/)).toBeInTheDocument()
  })

  it('marks a major break more prominently than a minor one', async () => {
    const majorBreak = [{ ...WR_RANKS[0], break_after: 'major' }, WR_RANKS[1]]
    mockFetch({ ranksBySetId: { 1: majorBreak } })
    render(<ComparePage platform="sleeper" format="half_ppr" />)
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'My rank set' }),
      { target: { value: '1' } },
    )
    await screen.findByText('Garrett Wilson')

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[1].className).toContain('compare-tier-divider')
    expect(rows[1].className).toContain('major')
    expect(screen.getByText(/big drop/)).toBeInTheDocument()
  })

  it('filters players by name', async () => {
    mockFetch({ ranksBySetId: { 1: WR_RANKS } })
    render(<ComparePage platform="sleeper" format="half_ppr" />)
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'My rank set' }),
      {
        target: { value: '1' },
      },
    )
    await screen.findByText('Garrett Wilson')

    fireEvent.change(screen.getByLabelText('Find a player'), {
      target: { value: 'Puka' },
    })

    expect(screen.queryByText('Garrett Wilson')).toBeNull()
    expect(screen.getByText('Puka Nacua')).toBeInTheDocument()
  })

  it('resets the source selection when switching to a different rank set', async () => {
    mockFetch({ ranksBySetId: { 1: WR_RANKS, 2: [] } })
    render(<ComparePage platform="sleeper" format="half_ppr" />)
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'My rank set' }),
      {
        target: { value: '1' },
      },
    )
    await screen.findByText('Garrett Wilson')
    fireEvent.click(screen.getByRole('checkbox', { name: /ADP/ }))
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /ADP/ })).toBeChecked()
    })

    fireEvent.change(screen.getByRole('combobox', { name: 'My rank set' }), {
      target: { value: '2' },
    })

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /ADP/ })).not.toBeChecked()
    })
  })

  it('shows the list immediately, with a hint to pick a source for comparison columns', async () => {
    mockFetch({ ranksBySetId: { 1: WR_RANKS } })
    render(<ComparePage platform="sleeper" format="half_ppr" />)
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'My rank set' }),
      {
        target: { value: '1' },
      },
    )

    expect(await screen.findByText('Garrett Wilson')).toBeInTheDocument()
    expect(screen.getByText(/pick a source/i)).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'ADP' })).toBeNull()
  })
})
