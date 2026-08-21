import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlayerRow } from '../../api/players'
import type { RankRow, RankSetSummary } from '../../api/ranks'
import { RankingsPage } from './RankingsPage'

const adpPlayers: PlayerRow[] = [
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

const savedRanks: RankRow[] = [
  {
    rank: 1,
    platform_player_id: '2',
    name: 'Bijan Robinson',
    position: 'RB',
    team: 'ATL',
    adp: 2.0,
  },
  {
    rank: 2,
    platform_player_id: '3',
    name: "Ja'Marr Chase",
    position: 'WR',
    team: 'CIN',
    adp: 1.0,
  },
]

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

function noContentResponse() {
  return { ok: true, status: 204, json: () => Promise.resolve(null) }
}

/** jsdom's DragEvent doesn't implement `clientY` at all (comes back
 * `undefined`, not 0), so `fireEvent.dragOver(el, { clientY })` silently has
 * no effect. Force it through via a raw Event + defineProperty instead. */
function dragOverAt(el: Element, clientY: number) {
  const event = new Event('dragover', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clientY', {
    value: clientY,
    configurable: true,
  })
  fireEvent(el, event)
}

/** A small in-memory stand-in for the rank-sets backend: routes by pathname
 * (never raw substring match -- the real URLs carry query strings). */
function mockBackend({
  initialSets = [],
  ranksBySetId = {},
  players = adpPlayers,
}: {
  initialSets?: RankSetSummary[]
  ranksBySetId?: Record<number, RankRow[]>
  players?: PlayerRow[]
} = {}) {
  let sets = [...initialSets]
  let nextId = Math.max(0, ...sets.map((s) => s.id)) + 1
  const ranksById: Record<number, RankRow[]> = { ...ranksBySetId }

  function toRankRow(player: PlayerRow, index: number): RankRow {
    return {
      rank: index + 1,
      platform_player_id: player.platform_player_id,
      name: player.name,
      position: player.position,
      team: player.team,
      adp: player.adp,
    }
  }

  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const { pathname, searchParams } = new URL(url)
    const method = init?.method ?? 'GET'
    const body = init?.body
      ? (JSON.parse(init.body as string) as Record<string, unknown>)
      : undefined

    const ranksMatch = pathname.match(/^\/rank-sets\/(\d+)\/ranks$/)
    if (ranksMatch && method === 'GET') {
      return Promise.resolve(
        jsonResponse(ranksById[Number(ranksMatch[1])] ?? []),
      )
    }
    if (ranksMatch && method === 'PUT') {
      const id = Number(ranksMatch[1])
      const ids = (body?.platform_player_ids as string[]) ?? []
      ranksById[id] = ids.map((pid, i) => {
        const player = players.find((p) => p.platform_player_id === pid)
        return player
          ? toRankRow(player, i)
          : {
              rank: i + 1,
              platform_player_id: pid,
              name: pid,
              position: null,
              team: null,
              adp: null,
            }
      })
      const set = sets.find((s) => s.id === id)
      if (set) set.player_count = ids.length
      return Promise.resolve(jsonResponse({ count: ids.length }))
    }

    const idMatch = pathname.match(/^\/rank-sets\/(\d+)$/)
    if (idMatch && method === 'PATCH') {
      const id = Number(idMatch[1])
      const set = sets.find((s) => s.id === id)
      if (set) set.name = body?.name as string
      return Promise.resolve(jsonResponse(set))
    }
    if (idMatch && method === 'DELETE') {
      const id = Number(idMatch[1])
      sets = sets.filter((s) => s.id !== id)
      delete ranksById[id]
      return Promise.resolve(noContentResponse())
    }

    if (pathname === '/rank-sets' && method === 'POST') {
      const newSet: RankSetSummary = {
        id: nextId++,
        name: body?.name as string,
        platform: (body?.platform as string) ?? 'sleeper',
        season: body?.season as string,
        format: body?.format as string,
        player_count: 0,
      }
      sets.push(newSet)
      if (body?.seed_from_adp) {
        ranksById[newSet.id] = players.map((p, i) => toRankRow(p, i))
        newSet.player_count = players.length
      }
      return Promise.resolve(jsonResponse(newSet))
    }
    if (pathname === '/rank-sets' && method === 'GET') {
      const format = searchParams.get('format')
      return Promise.resolve(
        jsonResponse(sets.filter((s) => !format || s.format === format)),
      )
    }

    if (pathname === '/players') {
      return Promise.resolve(jsonResponse(players))
    }

    return Promise.resolve(jsonResponse([]))
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('RankingsPage', () => {
  it('falls back to ADP order when no rank sets exist yet', async () => {
    mockBackend({ initialSets: [] })

    render(<RankingsPage />)

    expect(await screen.findByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(screen.getByText('Bijan Robinson')).toBeInTheDocument()
    expect(screen.getByText(/Starting from ADP order/)).toBeInTheDocument()
    expect(
      screen.getByText(/No rank sets for this format yet/),
    ).toBeInTheDocument()

    const rows = screen.getAllByRole('row')
    // header + 2 players + end-drop-zone
    expect(within(rows[1]).getByText("Ja'Marr Chase")).toBeInTheDocument()
  })

  it('uses a rank set’s saved order when it has entries, without the ADP fallback note', async () => {
    mockBackend({
      initialSets: [
        {
          id: 1,
          name: 'Main',
          platform: 'sleeper',
          season: '2026',
          format: 'half_ppr',
          player_count: 2,
        },
      ],
      ranksBySetId: { 1: savedRanks },
    })

    render(<RankingsPage />)

    const rows = await screen.findAllByRole('row')
    expect(within(rows[1]).getByText('Bijan Robinson')).toBeInTheDocument()
    expect(within(rows[2]).getByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(
      screen.queryByText(/Starting from ADP order/),
    ).not.toBeInTheDocument()
  })

  it('reorders live during drag, before any drop event fires', async () => {
    mockBackend({
      initialSets: [
        {
          id: 1,
          name: 'Main',
          platform: 'sleeper',
          season: '2026',
          format: 'half_ppr',
          player_count: 2,
        },
      ],
      ranksBySetId: { 1: savedRanks },
    })
    render(<RankingsPage />)
    await screen.findByText('Bijan Robinson')

    const rowsBefore = screen.getAllByRole('row')
    const bijanRow = rowsBefore[1] // rank 1
    const chaseRow = rowsBefore[2] // rank 2

    fireEvent.dragStart(bijanRow)
    // jsdom's getBoundingClientRect is all zeros, so any clientY > 0 reads as
    // "past the row's vertical midpoint" -- i.e. the bottom half.
    dragOverAt(chaseRow, 1)

    const rowsDuringDrag = screen.getAllByRole('row')
    expect(
      within(rowsDuringDrag[1]).getByText("Ja'Marr Chase"),
    ).toBeInTheDocument()
    expect(
      within(rowsDuringDrag[2]).getByText('Bijan Robinson'),
    ).toBeInTheDocument()

    fireEvent.drop(chaseRow)
    fireEvent.dragEnd(bijanRow)

    const rowsAfter = screen.getAllByRole('row')
    expect(within(rowsAfter[1]).getByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(within(rowsAfter[2]).getByText('Bijan Robinson')).toBeInTheDocument()
  })

  it('hovering the very next row’s top half does not move it (regression: moving one spot down)', async () => {
    mockBackend({
      initialSets: [
        {
          id: 1,
          name: 'Main',
          platform: 'sleeper',
          season: '2026',
          format: 'half_ppr',
          player_count: 2,
        },
      ],
      ranksBySetId: { 1: savedRanks },
    })
    render(<RankingsPage />)
    await screen.findByText('Bijan Robinson')

    const rowsBefore = screen.getAllByRole('row')
    const bijanRow = rowsBefore[1]
    const chaseRow = rowsBefore[2]

    fireEvent.dragStart(bijanRow)
    dragOverAt(chaseRow, 0) // top half -- should stay put

    const rowsStillUnchanged = screen.getAllByRole('row')
    expect(
      within(rowsStillUnchanged[1]).getByText('Bijan Robinson'),
    ).toBeInTheDocument()

    dragOverAt(chaseRow, 1) // bottom half -- now it moves

    const rowsMoved = screen.getAllByRole('row')
    expect(within(rowsMoved[1]).getByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(within(rowsMoved[2]).getByText('Bijan Robinson')).toBeInTheDocument()
  })

  it('dragging over the end zone moves the item to the end', async () => {
    mockBackend({
      initialSets: [
        {
          id: 1,
          name: 'Main',
          platform: 'sleeper',
          season: '2026',
          format: 'half_ppr',
          player_count: 2,
        },
      ],
      ranksBySetId: { 1: savedRanks },
    })
    render(<RankingsPage />)
    await screen.findByText('Bijan Robinson')

    const rowsBefore = screen.getAllByRole('row')
    const bijanRow = rowsBefore[1]
    const endZone = rowsBefore[rowsBefore.length - 1]

    fireEvent.dragStart(bijanRow)
    fireEvent.dragOver(endZone)

    const rowsAfter = screen.getAllByRole('row')
    expect(within(rowsAfter[1]).getByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(within(rowsAfter[2]).getByText('Bijan Robinson')).toBeInTheDocument()
  })

  it('move-down button moves a player exactly one spot', async () => {
    mockBackend({
      initialSets: [
        {
          id: 1,
          name: 'Main',
          platform: 'sleeper',
          season: '2026',
          format: 'half_ppr',
          player_count: 2,
        },
      ],
      ranksBySetId: { 1: savedRanks },
    })
    render(<RankingsPage />)
    await screen.findByText('Bijan Robinson')

    fireEvent.click(
      screen.getByRole('button', { name: 'Move Bijan Robinson down' }),
    )

    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(within(rows[2]).getByText('Bijan Robinson')).toBeInTheDocument()
  })

  it('move-up button moves a player exactly one spot', async () => {
    mockBackend({
      initialSets: [
        {
          id: 1,
          name: 'Main',
          platform: 'sleeper',
          season: '2026',
          format: 'half_ppr',
          player_count: 2,
        },
      ],
      ranksBySetId: { 1: savedRanks },
    })
    render(<RankingsPage />)
    await screen.findByText('Bijan Robinson')

    fireEvent.click(
      screen.getByRole('button', { name: "Move Ja'Marr Chase up" }),
    )

    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(within(rows[2]).getByText('Bijan Robinson')).toBeInTheDocument()
  })

  it('disables move-up for the first row and move-down for the last row', async () => {
    mockBackend({
      initialSets: [
        {
          id: 1,
          name: 'Main',
          platform: 'sleeper',
          season: '2026',
          format: 'half_ppr',
          player_count: 2,
        },
      ],
      ranksBySetId: { 1: savedRanks },
    })
    render(<RankingsPage />)
    await screen.findByText('Bijan Robinson')

    expect(
      screen.getByRole('button', { name: 'Move Bijan Robinson up' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: "Move Ja'Marr Chase down" }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Move Bijan Robinson down' }),
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: "Move Ja'Marr Chase up" }),
    ).toBeEnabled()
  })

  it('Load from ADP replaces the working list', async () => {
    mockBackend({
      initialSets: [
        {
          id: 1,
          name: 'Main',
          platform: 'sleeper',
          season: '2026',
          format: 'half_ppr',
          player_count: 2,
        },
      ],
      ranksBySetId: { 1: savedRanks },
      players: adpPlayers,
    })
    render(<RankingsPage />)
    await screen.findByText('Bijan Robinson')

    fireEvent.click(screen.getByRole('button', { name: 'Load from ADP' }))

    await waitFor(() => {
      expect(screen.getByText(/Starting from ADP order/)).toBeInTheDocument()
    })
    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText("Ja'Marr Chase")).toBeInTheDocument()
  })

  it('Save Ranks sends the current order to the selected rank set', async () => {
    const fetchMock = mockBackend({
      initialSets: [
        {
          id: 1,
          name: 'Main',
          platform: 'sleeper',
          season: '2026',
          format: 'half_ppr',
          player_count: 2,
        },
      ],
      ranksBySetId: { 1: savedRanks },
    })
    render(<RankingsPage />)
    await screen.findByText('Bijan Robinson')

    fireEvent.click(screen.getByRole('button', { name: 'Save Ranks' }))

    expect(await screen.findByText('Saved 2 ranks')).toBeInTheDocument()
    const putCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === 'PUT',
    )
    expect(putCall).toBeDefined()
    const [url, init] = putCall as [string, RequestInit]
    expect(url).toContain('/rank-sets/1/ranks')
    const body = JSON.parse(init.body as string) as {
      platform_player_ids: string[]
    }
    expect(body.platform_player_ids).toEqual(['2', '3'])
  })

  it('creating a rank set seeds it from ADP and selects it', async () => {
    mockBackend({ initialSets: [], players: adpPlayers })
    render(<RankingsPage />)
    await screen.findByText(/No rank sets for this format yet/)

    fireEvent.click(screen.getByRole('button', { name: '+ New Rank Set' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(
      await screen.findByRole('option', { name: /Half PPR Ranks \(2\)/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/No rank sets for this format yet/),
    ).not.toBeInTheDocument()
  })

  it('renaming the selected rank set updates its label', async () => {
    mockBackend({
      initialSets: [
        {
          id: 1,
          name: 'Main',
          platform: 'sleeper',
          season: '2026',
          format: 'half_ppr',
          player_count: 2,
        },
      ],
      ranksBySetId: { 1: savedRanks },
    })
    render(<RankingsPage />)
    await screen.findByText('Bijan Robinson')

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Rename rank set'), {
      target: { value: 'Updated' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    expect(
      await screen.findByRole('option', { name: 'Updated (2)' }),
    ).toBeInTheDocument()
  })

  it('deleting the selected rank set requires a confirm click', async () => {
    mockBackend({
      initialSets: [
        {
          id: 1,
          name: 'Main',
          platform: 'sleeper',
          season: '2026',
          format: 'half_ppr',
          player_count: 2,
        },
      ],
      ranksBySetId: { 1: savedRanks },
    })
    render(<RankingsPage />)
    await screen.findByText('Bijan Robinson')

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(
      screen.queryByText(/No rank sets for this format yet/),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete?' }))

    expect(
      await screen.findByText(/No rank sets for this format yet/),
    ).toBeInTheDocument()
  })
})
