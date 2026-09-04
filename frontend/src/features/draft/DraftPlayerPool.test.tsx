import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlayerRow } from '../../api/players'
import type { RankRow } from '../../api/ranks'
import { DraftPlayerPool } from './DraftPlayerPool'

const adpPlayers: PlayerRow[] = [
  {
    rank: 1,
    platform_player_id: '3',
    name: "Ja'Marr Chase",
    position: 'WR',
    team: 'CIN',
    adp: 1.0,
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
    adp: 2.0,
    tier: null,
    break_after: null,
    flag: null,
  },
  // Deliberately absent from savedRanks below, so the ADP tail has something
  // to append.
  {
    rank: 3,
    platform_player_id: '4',
    name: 'Puka Nacua',
    position: 'WR',
    team: 'LAR',
    adp: 4.0,
    tier: null,
    break_after: null,
    flag: null,
  },
]

const savedRanks: RankRow[] = [
  {
    rank: 1,
    platform_player_id: '2',
    name: 'Bijan Robinson',
    position: 'RB',
    team: 'ATL',
    adp: 2.0,
    tier: null,
    break_after: null,
    flag: null,
  },
  {
    rank: 2,
    platform_player_id: '3',
    name: "Ja'Marr Chase",
    position: 'WR',
    team: 'CIN',
    adp: 1.0,
    tier: null,
    break_after: null,
    flag: null,
  },
]

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

function mockFetch({
  ranks = [],
  players = adpPlayers,
  rankSetRanks = [],
  rankSets = [],
  ranksBySetId = {},
}: {
  ranks?: RankRow[]
  players?: PlayerRow[]
  rankSetRanks?: RankRow[]
  /** What GET /rank-sets returns -- the pool reads this to find your
   * per-position lists. */
  rankSets?: { id: number; name?: string; scope: string; is_active?: boolean }[]
  ranksBySetId?: Record<number, RankRow[]>
} = {}) {
  const fetchMock = vi.fn((url: string) => {
    const setRanks = /\/rank-sets\/(\d+)\/ranks/.exec(url)
    if (setRanks) {
      const id = Number(setRanks[1])
      return Promise.resolve(jsonResponse(ranksBySetId[id] ?? rankSetRanks))
    }
    if (url.includes('/rank-sets'))
      return Promise.resolve(jsonResponse(rankSets))
    if (url.includes('/ranks')) return Promise.resolve(jsonResponse(ranks))
    return Promise.resolve(jsonResponse(players))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('DraftPlayerPool', () => {
  it('falls back to ADP order when no saved ranks exist', async () => {
    mockFetch({ ranks: [] })

    render(
      <DraftPlayerPool
        format="half_ppr"
        platform="sleeper"
        nextPickNumber={20}
        draftedIds={new Set()}
        queuedIds={new Set()}
        canDraft={true}
        onDraft={vi.fn()}
        onQueue={vi.fn()}
      />,
    )

    expect(await screen.findByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(screen.getByText('Bijan Robinson')).toBeInTheDocument()
  })

  it('reads the assigned rank set directly when rankSetId is given', async () => {
    const fetchMock = mockFetch({ rankSetRanks: savedRanks })

    render(
      <DraftPlayerPool
        format="half_ppr"
        platform="sleeper"
        nextPickNumber={20}
        rankSetId={5}
        draftedIds={new Set()}
        queuedIds={new Set()}
        canDraft={true}
        onDraft={vi.fn()}
        onQueue={vi.fn()}
      />,
    )

    expect(await screen.findByText('Bijan Robinson')).toBeInTheDocument()
    const calledUrls = fetchMock.mock.calls.map(([url]) => url as string)
    expect(calledUrls.some((url) => url.includes('/rank-sets/5/ranks'))).toBe(
      true,
    )
    expect(calledUrls.some((url) => url.includes('/ranks?'))).toBe(false)
  })

  it('keeps a drafted player visible, grayed out, with actions disabled', async () => {
    // Seeing the whole tier -- who's gone, who's left -- is the point;
    // removing drafted players would hide exactly that.
    mockFetch({ ranks: savedRanks })

    render(
      <DraftPlayerPool
        format="half_ppr"
        platform="sleeper"
        nextPickNumber={20}
        draftedIds={new Set(['2'])}
        queuedIds={new Set()}
        canDraft={true}
        onDraft={vi.fn()}
        onQueue={vi.fn()}
      />,
    )

    expect(await screen.findByText("Ja'Marr Chase")).toBeInTheDocument()
    const bijanRow = screen
      .getAllByRole('row')
      .find((r) => r.textContent?.includes('Bijan Robinson'))
    expect(bijanRow).toBeDefined()
    expect(bijanRow?.className).toContain('drafted')
    expect(
      within(bijanRow!).queryByRole('button', { name: 'Draft' }),
    ).toBeNull()
    expect(
      within(bijanRow!).getByRole('button', { name: 'Drafted' }),
    ).toBeDisabled()
  })

  it('Draft button calls onDraft with the player id', async () => {
    mockFetch({ ranks: savedRanks })
    const onDraft = vi.fn()

    render(
      <DraftPlayerPool
        format="half_ppr"
        platform="sleeper"
        nextPickNumber={20}
        draftedIds={new Set()}
        queuedIds={new Set()}
        canDraft={true}
        onDraft={onDraft}
        onQueue={vi.fn()}
      />,
    )
    await screen.findByText('Bijan Robinson')

    fireEvent.click(screen.getAllByRole('button', { name: 'Draft' })[0])

    expect(onDraft).toHaveBeenCalledWith('2')
  })

  it('Queue button calls onQueue and disables once queued', async () => {
    mockFetch({ ranks: savedRanks })
    const onQueue = vi.fn()

    render(
      <DraftPlayerPool
        format="half_ppr"
        platform="sleeper"
        nextPickNumber={20}
        draftedIds={new Set()}
        queuedIds={new Set(['3'])}
        canDraft={true}
        onDraft={vi.fn()}
        onQueue={onQueue}
      />,
    )
    await screen.findByText('Bijan Robinson')

    // Bijan is first; the other Queue buttons belong to Chase (already
    // queued, so disabled) and the ADP tail below the saved ranks.
    fireEvent.click(screen.getAllByRole('button', { name: '+ Queue' })[0])
    expect(onQueue).toHaveBeenCalledWith('2')

    expect(screen.getByRole('button', { name: 'Queued' })).toBeDisabled()
  })

  it('filters by position tab', async () => {
    mockFetch({ ranks: savedRanks })

    render(
      <DraftPlayerPool
        format="half_ppr"
        platform="sleeper"
        nextPickNumber={20}
        draftedIds={new Set()}
        queuedIds={new Set()}
        canDraft={true}
        onDraft={vi.fn()}
        onQueue={vi.fn()}
      />,
    )
    await screen.findByText('Bijan Robinson')

    fireEvent.click(screen.getByRole('tab', { name: 'WR' }))

    expect(screen.getByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(screen.queryByText('Bijan Robinson')).not.toBeInTheDocument()
  })

  it('hides the Draft button when canDraft is false', async () => {
    mockFetch({ ranks: savedRanks })

    render(
      <DraftPlayerPool
        format="half_ppr"
        platform="sleeper"
        nextPickNumber={20}
        draftedIds={new Set()}
        queuedIds={new Set()}
        canDraft={false}
        onDraft={vi.fn()}
        onQueue={vi.fn()}
      />,
    )
    await screen.findByText('Bijan Robinson')

    expect(
      screen.queryByRole('button', { name: 'Draft' }),
    ).not.toBeInTheDocument()
    // Two saved ranks plus the one ADP-tail player they don't cover.
    expect(screen.getAllByRole('button', { name: '+ Queue' })).toHaveLength(3)
  })
})

describe('marks carried through from the rankings builder', () => {
  const markedRanks: RankRow[] = [
    { ...savedRanks[0], flag: 'target', tier: 1, break_after: 'major' },
    { ...savedRanks[1], flag: 'fade', tier: 2 },
  ]

  function renderPool() {
    render(
      <DraftPlayerPool
        format="half_ppr"
        platform="sleeper"
        nextPickNumber={20}
        draftedIds={new Set()}
        queuedIds={new Set()}
        canDraft={true}
        onDraft={vi.fn()}
        onQueue={vi.fn()}
      />,
    )
  }

  it('labels targets and fades in words, not just colour', async () => {
    mockFetch({ ranks: markedRanks })
    renderPool()
    await screen.findByText('Bijan Robinson')

    expect(screen.getByText('target')).toBeInTheDocument()
    expect(screen.getByText('fade')).toBeInTheDocument()
  })

  it('draws a tier break where the tier number changes, as its own divider row', async () => {
    mockFetch({ ranks: markedRanks })
    renderPool()
    await screen.findByText('Bijan Robinson')

    // Bijan (tier 1, carries the major break), the divider, then Chase (tier 2).
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0].className).not.toContain('draft-pool-tier-divider')
    expect(rows[1].className).toContain('draft-pool-tier-divider')
    expect(rows[1].className).toContain('major')
    expect(rows[2].textContent).toContain("Ja'Marr Chase")
    expect(screen.getByText(/Tier 2/)).toBeInTheDocument()
    expect(screen.getByText(/big drop/)).toBeInTheDocument()
  })

  it('still shows tiers for a list saved before break weights existed', async () => {
    // Regression: dividers used to key off break_after, so every list built
    // before that column existed showed tier numbers but no dividers at all.
    const tiersOnly: RankRow[] = [
      { ...savedRanks[0], tier: 1, break_after: null },
      { ...savedRanks[1], tier: 2, break_after: null },
    ]
    mockFetch({ ranks: tiersOnly })
    renderPool()
    await screen.findByText('Bijan Robinson')

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[1].className).toContain('draft-pool-tier-divider')
    expect(rows[1].className).toContain('minor')
  })

  it('keeps the tier divider correctly placed when the player carrying the break is drafted', async () => {
    // The break belongs to a player who is now drafted -- keying off that
    // player's break_after must not lose the divider, and the player himself
    // must not disappear either.
    mockFetch({ ranks: markedRanks })
    render(
      <DraftPlayerPool
        format="half_ppr"
        platform="sleeper"
        nextPickNumber={20}
        draftedIds={new Set(['2'])}
        queuedIds={new Set()}
        canDraft={true}
        onDraft={vi.fn()}
        onQueue={vi.fn()}
      />,
    )
    await screen.findByText("Ja'Marr Chase")

    const bijanRow = screen
      .getAllByRole('row')
      .find((r) => r.textContent?.includes('Bijan Robinson'))
    expect(bijanRow?.className).toContain('drafted')
    expect(screen.getByText(/big drop/)).toBeInTheDocument()
  })

  it('shows no break markers when the rank set has none', async () => {
    mockFetch({ ranks: savedRanks })
    renderPool()
    await screen.findByText('Bijan Robinson')

    expect(document.querySelector('.draft-pool-tier-divider')).toBeNull()
    expect(screen.queryByText(/^Tier \d/)).toBeNull()
    expect(screen.queryByText('target')).toBeNull()
  })
})

describe('the ADP tail below your own ranks', () => {
  it('appends everyone you did not rank, so the pool cannot run dry', async () => {
    // A hand-built list is usually shorter than a draft is long. Without the
    // tail the pool empties out mid-draft with picks still to make.
    mockFetch({ ranks: savedRanks, players: adpPlayers })

    render(
      <DraftPlayerPool
        format="half_ppr"
        platform="sleeper"
        nextPickNumber={20}
        draftedIds={new Set()}
        queuedIds={new Set()}
        canDraft={true}
        onDraft={vi.fn()}
        onQueue={vi.fn()}
      />,
    )
    await screen.findByText('Bijan Robinson')

    // savedRanks covers 2 players; the ADP list has one the ranks don't
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.length).toBeGreaterThan(savedRanks.length)
    expect(screen.getByText(/past your ranks/)).toBeInTheDocument()
  })

  it('does not duplicate a player who is in both lists', async () => {
    mockFetch({ ranks: savedRanks, players: adpPlayers })

    render(
      <DraftPlayerPool
        format="half_ppr"
        platform="sleeper"
        nextPickNumber={20}
        draftedIds={new Set()}
        queuedIds={new Set()}
        canDraft={true}
        onDraft={vi.fn()}
        onQueue={vi.fn()}
      />,
    )
    await screen.findByText('Bijan Robinson')

    expect(screen.getAllByText('Bijan Robinson')).toHaveLength(1)
  })

  it('marks nothing as past-your-ranks when there are no saved ranks', async () => {
    mockFetch({ ranks: [], players: adpPlayers })

    render(
      <DraftPlayerPool
        format="half_ppr"
        platform="sleeper"
        nextPickNumber={20}
        draftedIds={new Set()}
        queuedIds={new Set()}
        canDraft={true}
        onDraft={vi.fn()}
        onQueue={vi.fn()}
      />,
    )
    await screen.findByText("Ja'Marr Chase")

    expect(screen.queryByText(/past your ranks/)).toBeNull()
  })
})

describe('per-position lists', () => {
  // An overall list that ranks Chase above Nacua...
  const overall: RankRow[] = [
    { ...savedRanks[1], rank: 1 },
    {
      rank: 2,
      platform_player_id: '4',
      name: 'Puka Nacua',
      position: 'WR',
      team: 'LAR',
      adp: 4.0,
      tier: null,
      break_after: null,
      flag: null,
    },
  ]

  // ...and a WR list that deliberately disagrees, with marks of its own.
  const wrList: RankRow[] = [
    {
      rank: 1,
      platform_player_id: '4',
      name: 'Puka Nacua',
      position: 'WR',
      team: 'LAR',
      adp: 4.0,
      tier: 1,
      break_after: 'major',
      flag: 'target',
    },
    { ...savedRanks[1], rank: 2, tier: 2, flag: 'fade' },
  ]

  function renderPool() {
    render(
      <DraftPlayerPool
        format="half_ppr"
        platform="sleeper"
        nextPickNumber={20}
        draftedIds={new Set()}
        queuedIds={new Set()}
        canDraft={true}
        onDraft={vi.fn()}
        onQueue={vi.fn()}
      />,
    )
  }

  it('uses your list for that position, not the overall list filtered', async () => {
    mockFetch({
      ranks: overall,
      rankSets: [{ id: 7, scope: 'WR', is_active: true }],
      ranksBySetId: { 7: wrList },
    })
    renderPool()
    await screen.findByText("Ja'Marr Chase")

    // ALL tab follows the overall list: Chase first
    let names = screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent ?? '')
    expect(names[0]).toContain("Ja'Marr Chase")

    fireEvent.click(screen.getByRole('tab', { name: 'WR' }))

    // WR tab follows the WR list, which disagrees: Nacua first
    await waitFor(() => {
      names = screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.textContent ?? '')
      expect(names[0]).toContain('Puka Nacua')
    })
    expect(screen.getByText(/Using your WR list/)).toBeInTheDocument()
  })

  it('shows the marks from that positional list', async () => {
    mockFetch({
      ranks: overall,
      rankSets: [{ id: 7, scope: 'WR', is_active: true }],
      ranksBySetId: { 7: wrList },
    })
    renderPool()
    await screen.findByText("Ja'Marr Chase")
    // no marks on the overall list
    expect(screen.queryByText('target')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'WR' }))

    await waitFor(() => {
      expect(screen.getByText('target')).toBeInTheDocument()
    })
    expect(screen.getByText('fade')).toBeInTheDocument()
    // Puka (tier 1, carries the major break), the divider, then Bijan (tier 2).
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[1].className).toContain('draft-pool-tier-divider')
    expect(rows[1].className).toContain('major')
  })

  it('falls back to filtering the overall list for a position with no list', async () => {
    // K and DEF never get their own lists, and neither does a position you
    // simply haven't built yet.
    mockFetch({
      ranks: overall,
      rankSets: [{ id: 7, scope: 'WR', is_active: true }],
      ranksBySetId: { 7: wrList },
    })
    renderPool()
    await screen.findByText("Ja'Marr Chase")

    fireEvent.click(screen.getByRole('tab', { name: 'RB' }))

    await waitFor(() => {
      expect(screen.queryByText(/Using your RB list/)).toBeNull()
    })
  })
})

describe('which rank set is in use', () => {
  // With more than one rank set possible per format or position, "using your
  // saved ranks" alone doesn't say which one -- this is what was reported as
  // impossible to tell.

  it('names the overall rank set backing the ALL tab', async () => {
    mockFetch({
      ranks: savedRanks,
      rankSets: [{ id: 1, name: 'Half PPR Main', scope: 'overall' }],
    })

    render(
      <DraftPlayerPool
        format="half_ppr"
        platform="sleeper"
        nextPickNumber={20}
        draftedIds={new Set()}
        queuedIds={new Set()}
        canDraft={true}
        onDraft={vi.fn()}
        onQueue={vi.fn()}
      />,
    )
    await screen.findByText('Bijan Robinson')

    expect(screen.getByText(/Half PPR Main/)).toBeInTheDocument()
  })

  it('says so when falling back to ADP, with no saved rank list to name', async () => {
    mockFetch({ ranks: [] })

    render(
      <DraftPlayerPool
        format="half_ppr"
        platform="sleeper"
        nextPickNumber={20}
        draftedIds={new Set()}
        queuedIds={new Set()}
        canDraft={true}
        onDraft={vi.fn()}
        onQueue={vi.fn()}
      />,
    )
    await screen.findByText("Ja'Marr Chase")

    expect(screen.getByText(/Using ADP/)).toBeInTheDocument()
  })

  it('names the positional rank set backing a position tab', async () => {
    mockFetch({
      ranks: savedRanks,
      rankSets: [{ id: 7, name: 'My WRs', scope: 'WR', is_active: true }],
      ranksBySetId: {
        7: [
          {
            rank: 1,
            platform_player_id: '4',
            name: 'Puka Nacua',
            position: 'WR',
            team: 'LAR',
            adp: 4.0,
            tier: null,
            break_after: null,
            flag: null,
          },
        ],
      },
    })

    render(
      <DraftPlayerPool
        format="half_ppr"
        platform="sleeper"
        nextPickNumber={20}
        draftedIds={new Set()}
        queuedIds={new Set()}
        canDraft={true}
        onDraft={vi.fn()}
        onQueue={vi.fn()}
      />,
    )
    await screen.findByText('Bijan Robinson')

    fireEvent.click(screen.getByRole('tab', { name: 'WR' }))

    await waitFor(() => {
      expect(screen.getByText(/My WRs/)).toBeInTheDocument()
    })
  })
})

describe('value vs reach', () => {
  const ranked: RankRow[] = [
    // ADP 60 with the clock on pick 20: taking him now is a 40-pick reach.
    {
      rank: 1,
      platform_player_id: '2',
      name: 'Bijan Robinson',
      position: 'RB',
      team: 'ATL',
      adp: 60.0,
      tier: null,
      break_after: null,
      flag: null,
    },
    // ADP 5 and still here at pick 20: a 15-pick value.
    {
      rank: 2,
      platform_player_id: '3',
      name: "Ja'Marr Chase",
      position: 'WR',
      team: 'CIN',
      adp: 5.0,
      tier: null,
      break_after: null,
      flag: null,
    },
  ]

  function renderAtPick(pick: number) {
    render(
      <DraftPlayerPool
        format="half_ppr"
        platform="sleeper"
        nextPickNumber={pick}
        rankSetId={1}
        draftedIds={new Set()}
        queuedIds={new Set()}
        canDraft={true}
        onDraft={vi.fn()}
        onQueue={vi.fn()}
      />,
    )
  }

  it('reads a player going later than the clock as a reach', async () => {
    mockFetch({ rankSetRanks: ranked })
    renderAtPick(20)
    await screen.findByText('Bijan Robinson')

    const row = screen
      .getAllByRole('row')
      .find((r) => r.textContent?.includes('Bijan Robinson'))
    // ADP 60 against pick 20
    expect(row?.textContent).toContain('+40')
  })

  it('reads a player who has fallen past his ADP as a value', async () => {
    mockFetch({ rankSetRanks: ranked })
    renderAtPick(20)
    await screen.findByText("Ja'Marr Chase")

    const row = screen
      .getAllByRole('row')
      .find((r) => r.textContent?.includes("Ja'Marr Chase"))
    expect(row?.textContent).toContain('-15')
  })

  it('hides the columns inside a position tab', async () => {
    // Rank is a positional rank there (WR7); comparing it to an overall pick
    // number would be nonsense.
    mockFetch({ rankSetRanks: ranked })
    renderAtPick(20)
    await screen.findByText('Bijan Robinson')
    expect(screen.getByText('vs ADP')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'RB' }))

    await waitFor(() => {
      expect(screen.queryByText('vs ADP')).toBeNull()
    })
  })

  it('hides the columns once the draft is over', async () => {
    mockFetch({ rankSetRanks: ranked })
    renderAtPick(0)
    await screen.findByText('Bijan Robinson')

    expect(screen.queryByText('vs ADP')).toBeNull()
  })
})
