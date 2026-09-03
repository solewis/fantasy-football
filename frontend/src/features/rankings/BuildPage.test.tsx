import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BuildPage } from './BuildPage'

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

const SOURCES = [
  {
    ref: 'adp',
    label: 'ADP',
    kind: 'adp',
    supports_overall: true,
    supports_positional: true,
    scope: null,
  },
  {
    ref: 'dataset:1',
    label: 'FantasyPros',
    kind: 'dataset',
    supports_overall: true,
    supports_positional: true,
    scope: null,
  },
  {
    ref: 'dataset:2',
    label: 'WR only',
    kind: 'dataset',
    supports_overall: false,
    supports_positional: true,
    scope: null,
  },
]

const PLAYERS = [
  {
    platform_player_id: '1',
    name: "Ja'Marr Chase",
    position: 'WR',
    team: 'CIN',
    adp: 3.2,
    ranks: { adp: 1, 'dataset:1': 1 },
  },
  {
    platform_player_id: '2',
    name: 'Puka Nacua',
    position: 'WR',
    team: 'LAR',
    adp: 4.7,
    ranks: { adp: 2, 'dataset:1': 3 },
  },
  {
    platform_player_id: '3',
    name: 'Justin Jefferson',
    position: 'WR',
    team: 'MIN',
    adp: 13.9,
    ranks: { adp: 3, 'dataset:1': null },
  },
]

const DEEP_PLAYERS = Array.from({ length: 30 }, (_, i) => ({
  platform_player_id: `d${i}`,
  name: `Deep Player ${i}`,
  position: 'WR',
  team: 'CIN',
  adp: i + 1,
  ranks: { adp: i + 1, 'dataset:1': i + 1 },
}))

function mockBackend(
  players = PLAYERS,
  options: {
    rankSets?: { id: number; name: string; scope: string }[]
    ranksBySetId?: Record<number, unknown[]>
    /** Lets a test simulate the backend rejecting a create, e.g. a duplicate
     * name -- returns this instead of a 200 for POST /rank-sets. */
    createRankSetError?: string
  } = {},
) {
  const { rankSets = [], ranksBySetId = {}, createRankSetError } = options
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const { pathname } = new URL(url)
    if (pathname === '/rank-sources')
      return Promise.resolve(jsonResponse(SOURCES))
    const setRanksMatch = /^\/rank-sets\/(\d+)\/ranks$/.exec(pathname)
    if (setRanksMatch) {
      const id = Number(setRanksMatch[1])
      return Promise.resolve(jsonResponse(ranksBySetId[id] ?? []))
    }
    if (pathname === '/rank-sets' && init?.method === 'POST') {
      if (createRankSetError) {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ detail: createRankSetError }),
        })
      }
      const body = JSON.parse((init.body as string) ?? '{}') as {
        name: string
        scope: string
      }
      return Promise.resolve(
        jsonResponse({
          id: 999,
          name: body.name,
          scope: body.scope,
          platform: 'sleeper',
          season: '2026',
          format: 'half_ppr',
          player_count: 0,
        }),
      )
    }
    if (pathname === '/rank-sets')
      return Promise.resolve(jsonResponse(rankSets))
    if (pathname === '/rank-pool') {
      return Promise.resolve(
        jsonResponse({
          scope: 'overall',
          sources: [
            {
              ref: 'adp',
              label: 'ADP',
              kind: 'adp',
              depth: 3,
              unresolved_count: 0,
            },
            {
              ref: 'dataset:1',
              label: 'FantasyPros',
              kind: 'dataset',
              depth: 3,
              unresolved_count: 0,
            },
          ],
          players,
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
  localStorage.clear()
})

async function renderBuild() {
  mockBackend()
  render(<BuildPage platform="sleeper" format="half_ppr" />)
  await screen.findByText("Ja'Marr Chase")
  // Every usable source is selected on load, so both opinions are already in
  // play without touching the picker -- wait for the second source's column.
  await waitFor(() => {
    expect(
      screen.getByRole('columnheader', { name: 'FantasyPros' }),
    ).toBeInTheDocument()
  })
}

describe('BuildPage', () => {
  it('orders candidates by average rank', async () => {
    await renderBuild()

    const rows = screen.getAllByRole('row').slice(1)
    const names = rows.map((r) => r.textContent ?? '')
    // Chase averages 1, Puka (2 and 3) averages 2.5, Jefferson only ADP ranks
    expect(names[0]).toContain("Ja'Marr Chase")
    expect(names[1]).toContain('Puka Nacua')
    expect(names[2]).toContain('Justin Jefferson')
  })

  it('puts Pick first so it survives a horizontal scroll', async () => {
    // With several sources the table scrolls sideways; the action must not be
    // the thing that scrolls out of reach.
    await renderBuild()

    const firstRow = screen.getAllByRole('row')[1]
    const firstCell = firstRow.querySelectorAll('td')[0]
    expect(firstCell.querySelector('button')).toHaveTextContent('Pick')
  })

  it('picking a candidate moves them into the list and advances the slot', async () => {
    await renderBuild()
    expect(screen.getByText('Filling #1')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Pick' })[0])

    await waitFor(() => {
      expect(screen.getByText('Filling #2')).toBeInTheDocument()
    })
    expect(screen.getByText('My list (1)')).toBeInTheDocument()
    // ...and they're gone from the candidate table
    const pickButtons = screen.getAllByRole('button', { name: 'Pick' })
    expect(pickButtons).toHaveLength(2)
  })

  it('undo reverses a pick exactly', async () => {
    await renderBuild()
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick' })[0])
    await waitFor(() => {
      expect(screen.getByText('Filling #2')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => {
      expect(screen.getByText('Filling #1')).toBeInTheDocument()
    })
    expect(screen.getByText('My list (0)')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Pick' })).toHaveLength(3)
  })

  it('shows a missing chip for a source that does not rank a player', async () => {
    await renderBuild()

    // Jefferson is unranked by FantasyPros
    const jeffersonRow = screen
      .getAllByRole('row')
      .find((r) => r.textContent?.includes('Justin Jefferson'))
    expect(jeffersonRow?.querySelector('[data-missing="true"]')).not.toBeNull()
  })

  it('disables a source that cannot serve the current axis', async () => {
    await renderBuild()

    // "WR only" has no overall ranks, so it can't feed an overall list -- and
    // it stays visible with the reason rather than vanishing.
    const checkbox = screen.getByRole('checkbox', { name: /WR only/ })
    expect(checkbox).toBeDisabled()
    expect(screen.getByText('no overall ranks')).toBeInTheDocument()
  })

  it('selects every usable source on load', async () => {
    // A freshly imported dataset sitting unchecked reads as "my import didn't
    // work" -- you loaded it in order to compare against it.
    await renderBuild()

    expect(screen.getByRole('checkbox', { name: /ADP/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /FantasyPros/ })).toBeChecked()
  })

  it('adds a tier break after the last pick from the toolbar', async () => {
    await renderBuild()
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick' })[0])
    await waitFor(() => {
      expect(screen.getByText('My list (1)')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '+ Tier break' }))

    await waitFor(() => {
      expect(screen.getByText('Tier 2')).toBeInTheDocument()
    })
  })

  it('cycles a per-row tier break through none, small and big', async () => {
    // It used to be opacity:0 until you hovered the row, which meant nobody
    // found it. One button covers both weights rather than needing a menu.
    await renderBuild()
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick' })[0])
    await waitFor(() => {
      expect(screen.getByText('My list (1)')).toBeInTheDocument()
    })

    const toggle = () =>
      screen.getByRole('button', { name: /Tier break after Ja'Marr Chase/ })
    expect(toggle().getAttribute('aria-label')).toContain('currently none')

    fireEvent.click(toggle())
    await waitFor(() => {
      expect(toggle().getAttribute('aria-label')).toContain('currently minor')
    })

    fireEvent.click(toggle())
    await waitFor(() => {
      expect(toggle().getAttribute('aria-label')).toContain('currently major')
    })
    expect(screen.getByText(/big drop/)).toBeInTheDocument()

    fireEvent.click(toggle())
    await waitFor(() => {
      expect(toggle().getAttribute('aria-label')).toContain('currently none')
    })
  })

  it('marks a player as a target and saves the flag', async () => {
    const fetchMock = mockBackend()
    render(<BuildPage platform="sleeper" format="half_ppr" />)
    await screen.findByText("Ja'Marr Chase")
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick' })[0])
    await waitFor(() => {
      expect(screen.getByText('My list (1)')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /^Target Ja'Marr/ }))
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Clear target on Ja'Marr/ }),
      ).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([, init]) => (init as RequestInit)?.method === 'PUT',
        ),
      ).toBe(true)
    })
    const put = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === 'PUT',
    )
    if (!put) throw new Error('no save request was made')
    const body = JSON.parse((put[1] as RequestInit).body as string) as {
      entries: { flag: string | null }[]
    }
    expect(body.entries[0].flag).toBe('target')
  })

  it('saves the tiers implied by the breaks', async () => {
    const fetchMock = mockBackend()
    render(<BuildPage platform="sleeper" format="half_ppr" />)
    await screen.findByText("Ja'Marr Chase")
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick' })[0])
    await waitFor(() => {
      expect(screen.getByText('My list (1)')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '+ Tier break' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick' })[0])
    await waitFor(() => {
      expect(screen.getByText('My list (2)')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit)?.method === 'PUT',
      )
      expect(put).toBeDefined()
    })
    const put = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === 'PUT',
    )
    if (!put) throw new Error('no save request was made')
    const body = JSON.parse((put[1] as RequestInit).body as string) as {
      entries: { platform_player_id: string; tier: number | null }[]
    }
    expect(body.entries.map((e) => e.tier)).toEqual([1, 2])
  })

  it('finds a player who is too deep to be shown', async () => {
    // The table pages at 8; someone ranked 25th by consensus is unreachable
    // without this, and "the guy I want isn't in the top 8" is the normal case
    // when your opinion differs from the sources'.
    mockBackend([...PLAYERS, ...DEEP_PLAYERS])
    render(<BuildPage platform="sleeper" format="half_ppr" />)
    await screen.findByText("Ja'Marr Chase")

    expect(screen.queryByText('Deep Player 25')).toBeNull()

    fireEvent.change(screen.getByLabelText('Find a player'), {
      target: { value: 'Deep Player 25' },
    })

    expect(await screen.findByText('Deep Player 25')).toBeInTheDocument()
  })

  it('clears the search once the player is picked', async () => {
    mockBackend([...PLAYERS, ...DEEP_PLAYERS])
    render(<BuildPage platform="sleeper" format="half_ppr" />)
    await screen.findByText("Ja'Marr Chase")
    fireEvent.change(screen.getByLabelText('Find a player'), {
      target: { value: 'Deep Player 25' },
    })
    await screen.findByText('Deep Player 25')

    fireEvent.click(screen.getByRole('button', { name: 'Pick' }))

    await waitFor(() => {
      expect(screen.getByText('My list (1)')).toBeInTheDocument()
    })
    // ...and the table is back to the normal flow rather than an empty filter
    expect(
      (screen.getByLabelText('Find a player') as HTMLInputElement).value,
    ).toBe('')
    expect(screen.getByText("Ja'Marr Chase")).toBeInTheDocument()
  })

  it('says so when a search matches nobody', async () => {
    await renderBuild()

    fireEvent.change(screen.getByLabelText('Find a player'), {
      target: { value: 'Nobody At All' },
    })

    expect(
      await screen.findByText(/No player matching "Nobody At All"/),
    ).toBeInTheDocument()
  })

  it('can page further down the list', async () => {
    mockBackend([...PLAYERS, ...DEEP_PLAYERS])
    render(<BuildPage platform="sleeper" format="half_ppr" />)
    await screen.findByText("Ja'Marr Chase")

    expect(screen.getByText('Showing 8 of 33')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show 25 more' }))

    await waitFor(() => {
      expect(screen.getByText('Showing 33 of 33')).toBeInTheDocument()
    })
  })

  it('does not recommend anyone', async () => {
    await renderBuild()

    // The tool reports what sources think; it never marks a suggested pick.
    expect(screen.queryByText(/recommend/i)).toBeNull()
    expect(screen.queryByText(/suggested/i)).toBeNull()
  })
})

describe('loading an existing target set', () => {
  const QB_RANKS = [
    {
      rank: 1,
      platform_player_id: 'q1',
      name: 'Josh Allen',
      position: 'QB',
      team: 'BUF',
      adp: 20,
      tier: 1,
      break_after: 'major',
      flag: 'target',
    },
    {
      rank: 2,
      platform_player_id: 'q2',
      name: 'Lamar Jackson',
      position: 'QB',
      team: 'BAL',
      adp: 25,
      tier: 2,
      break_after: null,
      flag: null,
    },
  ]

  it('populates My list from a set that already exists for the scope', async () => {
    // The bug this covers: "My QBs" showed up in the dropdown, correctly
    // selected, but the working list stayed empty -- nothing ever fetched the
    // set's saved contents.
    mockBackend(PLAYERS, {
      rankSets: [{ id: 9, name: 'My QBs', scope: 'QB' }],
      ranksBySetId: { 9: QB_RANKS },
    })
    render(<BuildPage platform="sleeper" format="half_ppr" />)
    await screen.findByText("Ja'Marr Chase")

    fireEvent.click(screen.getByRole('tab', { name: 'QB' }))

    await waitFor(() => {
      expect(screen.getByText('My list (2)')).toBeInTheDocument()
    })
    expect(screen.getByText('Josh Allen')).toBeInTheDocument()
    expect(screen.getByText('Lamar Jackson')).toBeInTheDocument()
  })

  it('carries over tier breaks and flags from the loaded set', async () => {
    mockBackend(PLAYERS, {
      rankSets: [{ id: 9, name: 'My QBs', scope: 'QB' }],
      ranksBySetId: { 9: QB_RANKS },
    })
    render(<BuildPage platform="sleeper" format="half_ppr" />)
    await screen.findByText("Ja'Marr Chase")

    fireEvent.click(screen.getByRole('tab', { name: 'QB' }))

    await waitFor(() => {
      expect(screen.getByText('My list (2)')).toBeInTheDocument()
    })
    // The loaded break is 'major', so the divider reads "Tier 2 · big drop".
    expect(screen.getByText(/Tier 2/)).toBeInTheDocument()
    expect(screen.getByText(/big drop/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Clear target on Josh Allen/ }),
    ).toBeInTheDocument()
  })

  it('starts empty when "+ New rank set…" is chosen despite an existing set', async () => {
    // Related bug: picking "New rank set..." used to silently fall back to
    // whatever set already existed for the scope, because there was no way to
    // distinguish "no explicit choice" from "explicitly wants a new one".
    mockBackend(PLAYERS, {
      rankSets: [{ id: 9, name: 'My QBs', scope: 'QB' }],
      ranksBySetId: { 9: QB_RANKS },
    })
    render(<BuildPage platform="sleeper" format="half_ppr" />)
    await screen.findByText("Ja'Marr Chase")
    fireEvent.click(screen.getByRole('tab', { name: 'QB' }))
    await waitFor(() => {
      expect(screen.getByText('My list (2)')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByRole('combobox', { name: 'Rank set' }), {
      target: { value: 'new' },
    })

    await waitFor(() => {
      expect(screen.getByText('My list (0)')).toBeInTheDocument()
    })
  })

  it('confirms before discarding unsaved picks when switching target sets', async () => {
    mockBackend(PLAYERS, {
      rankSets: [
        { id: 9, name: 'My QBs', scope: 'QB' },
        { id: 10, name: 'My Backup QBs', scope: 'QB' },
      ],
      ranksBySetId: { 9: QB_RANKS, 10: [] },
    })
    render(<BuildPage platform="sleeper" format="half_ppr" />)
    await screen.findByText("Ja'Marr Chase")
    fireEvent.click(screen.getByRole('tab', { name: 'QB' }))
    await waitFor(() => {
      expect(screen.getByText('My list (2)')).toBeInTheDocument()
    })
    // Make an additional, unsaved pick on top of the loaded list.
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick' })[0])
    await waitFor(() => {
      expect(screen.getByText('My list (3)')).toBeInTheDocument()
    })

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.change(screen.getByRole('combobox', { name: 'Rank set' }), {
      target: { value: '10' },
    })

    expect(confirmSpy).toHaveBeenCalled()
    // Declined -- the in-progress list survives untouched.
    expect(screen.getByText('My list (3)')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })
})

describe('source priority order', () => {
  function sourceRowLabels() {
    return screen
      .getAllByRole('checkbox')
      .map((checkbox) => checkbox.closest('label')?.textContent ?? '')
  }

  function columnHeaderOrder() {
    return screen.getAllByRole('columnheader').map((th) => th.textContent ?? '')
  }

  it('lists sources in priority order, and moves a source up', async () => {
    await renderBuild()

    // Default order is whatever the backend returned: ADP, FantasyPros, WR only.
    expect(sourceRowLabels()[0]).toContain('ADP')
    expect(sourceRowLabels()[1]).toContain('FantasyPros')

    fireEvent.click(screen.getByRole('button', { name: 'Move FantasyPros up' }))

    await waitFor(() => {
      expect(sourceRowLabels()[0]).toContain('FantasyPros')
    })
    expect(sourceRowLabels()[1]).toContain('ADP')
  })

  it('reorders the candidate table columns to match', async () => {
    // The whole point: dragging a source up in the picker moves its column
    // left in the table, without needing to refetch the pool.
    await renderBuild()
    expect(columnHeaderOrder().indexOf('ADP')).toBeLessThan(
      columnHeaderOrder().indexOf('FantasyPros'),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Move FantasyPros up' }))

    await waitFor(() => {
      expect(columnHeaderOrder().indexOf('FantasyPros')).toBeLessThan(
        columnHeaderOrder().indexOf('ADP'),
      )
    })
  })

  it('disables the move buttons at each end of the list', async () => {
    await renderBuild()

    expect(screen.getByRole('button', { name: 'Move ADP up' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Move WR only down' }),
    ).toBeDisabled()
  })

  it('keeps the priority order across a remount', async () => {
    // Persisted per platform/format so it doesn't need resetting every visit.
    const { unmount } = await (async () => {
      mockBackend()
      const view = render(<BuildPage platform="sleeper" format="half_ppr" />)
      await screen.findByText("Ja'Marr Chase")
      await waitFor(() => {
        expect(
          screen.getByRole('columnheader', { name: 'FantasyPros' }),
        ).toBeInTheDocument()
      })
      fireEvent.click(
        screen.getByRole('button', { name: 'Move FantasyPros up' }),
      )
      await waitFor(() => {
        expect(columnHeaderOrder().indexOf('FantasyPros')).toBeLessThan(
          columnHeaderOrder().indexOf('ADP'),
        )
      })
      return view
    })()
    unmount()

    mockBackend()
    render(<BuildPage platform="sleeper" format="half_ppr" />)
    await screen.findByText("Ja'Marr Chase")

    await waitFor(() => {
      expect(columnHeaderOrder().indexOf('FantasyPros')).toBeLessThan(
        columnHeaderOrder().indexOf('ADP'),
      )
    })
  })

  it('appends a newly available source at the end rather than resetting the order', async () => {
    // A freshly imported dataset joining at the front would silently bump
    // everything you'd already arranged.
    localStorage.setItem(
      'fantasy-draft-app:sourceOrder:sleeper:half_ppr',
      JSON.stringify(['dataset:2', 'dataset:1']),
    )
    await renderBuild()

    const labels = sourceRowLabels()
    expect(labels[0]).toContain('WR only')
    expect(labels[1]).toContain('FantasyPros')
    expect(labels[2]).toContain('ADP')
  })
})

describe('naming a new rank set', () => {
  it('shows an editable name, pre-filled with a scope-based guess, only when creating new', async () => {
    await renderBuild()

    // Overall scope, nothing existing for it -- "+ New rank set..." is
    // already the effective choice, so the field is visible from the start.
    expect(
      (screen.getByLabelText('New rank set name') as HTMLInputElement).value,
    ).toBe('Built list')
  })

  it('hides the name field once an existing set is the target', async () => {
    mockBackend(PLAYERS, {
      rankSets: [{ id: 9, name: 'My QBs', scope: 'QB' }],
      ranksBySetId: { 9: [] },
    })
    render(<BuildPage platform="sleeper" format="half_ppr" />)
    await screen.findByText("Ja'Marr Chase")
    fireEvent.click(screen.getByRole('tab', { name: 'QB' }))

    await waitFor(() => {
      expect(
        (
          screen.getByRole('combobox', {
            name: 'Rank set',
          }) as HTMLSelectElement
        ).value,
      ).toBe('9')
    })
    expect(screen.queryByLabelText('New rank set name')).toBeNull()
  })

  it('updates the guess when you switch scope', async () => {
    await renderBuild()
    expect(
      (screen.getByLabelText('New rank set name') as HTMLInputElement).value,
    ).toBe('Built list')

    fireEvent.click(screen.getByRole('tab', { name: 'QB' }))

    await waitFor(() => {
      expect(
        (screen.getByLabelText('New rank set name') as HTMLInputElement).value,
      ).toBe('My QBs')
    })
  })

  it('lets you rename it before saving, and creates it under that name', async () => {
    // The bug this covers: the guessed name was the only name a new set could
    // ever get, so a second QB build collided with "My QBs" and had no way to
    // be renamed to something that would save.
    const fetchMock = mockBackend()
    render(<BuildPage platform="sleeper" format="half_ppr" />)
    await screen.findByText("Ja'Marr Chase")
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick' })[0])
    await waitFor(() => {
      expect(screen.getByText('My list (1)')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('New rank set name'), {
      target: { value: 'My QBs (backup)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) =>
          (url as string).endsWith('/rank-sets') &&
          (init as RequestInit)?.method === 'POST',
      )
      expect(post).toBeDefined()
    })
    const post = fetchMock.mock.calls.find(
      ([url, init]) =>
        (url as string).endsWith('/rank-sets') &&
        (init as RequestInit)?.method === 'POST',
    )
    if (!post) throw new Error('no create request was made')
    const body = JSON.parse((post[1] as RequestInit).body as string) as {
      name: string
    }
    expect(body.name).toBe('My QBs (backup)')
  })

  it('refuses to save with a blank name, without hitting the network', async () => {
    const fetchMock = mockBackend()
    render(<BuildPage platform="sleeper" format="half_ppr" />)
    await screen.findByText("Ja'Marr Chase")
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick' })[0])
    await waitFor(() => {
      expect(screen.getByText('My list (1)')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText('New rank set name'), {
      target: { value: '   ' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText('Give the new rank set a name'),
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          (url as string).endsWith('/rank-sets') &&
          (init as RequestInit)?.method === 'POST',
      ),
    ).toBe(false)
  })

  it('surfaces a name collision from the backend so it can be corrected', async () => {
    mockBackend(PLAYERS, {
      createRankSetError:
        "A rank set named 'My QBs' already exists for this format",
    })
    render(<BuildPage platform="sleeper" format="half_ppr" />)
    await screen.findByText("Ja'Marr Chase")
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick' })[0])
    await waitFor(() => {
      expect(screen.getByText('My list (1)')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText(/My QBs' already exists/),
    ).toBeInTheDocument()
    // The field survives the failure -- this is exactly where it needed to be
    // reachable, so the name can be corrected and Save tried again.
    expect(screen.getByLabelText('New rank set name')).toBeInTheDocument()
  })
})
