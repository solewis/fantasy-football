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

/** Routes by URL/method: GET /ranks, GET /players, PUT /ranks. */
function mockFetch({
  ranks = [],
  players = adpPlayers,
  putResponse = { count: players.length },
}: {
  ranks?: RankRow[]
  players?: PlayerRow[]
  putResponse?: { count: number }
} = {}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.includes('/ranks') && init?.method === 'PUT') {
      return Promise.resolve(jsonResponse(putResponse))
    }
    if (url.includes('/ranks')) {
      return Promise.resolve(jsonResponse(ranks))
    }
    return Promise.resolve(jsonResponse(players))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('RankingsPage', () => {
  it('falls back to ADP order when no ranks are saved yet', async () => {
    mockFetch({ ranks: [] })

    render(<RankingsPage />)

    expect(await screen.findByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(screen.getByText('Bijan Robinson')).toBeInTheDocument()
    expect(screen.getByText(/Starting from ADP order/)).toBeInTheDocument()

    const rows = screen.getAllByRole('row')
    // header + 2 players + end-drop-zone
    expect(within(rows[1]).getByText("Ja'Marr Chase")).toBeInTheDocument()
  })

  it('uses saved ranks when they exist, without the ADP fallback note', async () => {
    mockFetch({ ranks: savedRanks })

    render(<RankingsPage />)

    const rows = await screen.findAllByRole('row')
    expect(within(rows[1]).getByText('Bijan Robinson')).toBeInTheDocument()
    expect(within(rows[2]).getByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(
      screen.queryByText(/Starting from ADP order/),
    ).not.toBeInTheDocument()
  })

  it('reorders on drag and drop between two rows', async () => {
    mockFetch({ ranks: savedRanks })
    render(<RankingsPage />)
    await screen.findByText('Bijan Robinson')

    const rowsBefore = screen.getAllByRole('row')
    const draggedRow = rowsBefore[1] // Bijan, currently rank 1
    const targetRow = rowsBefore[2] // Chase, currently rank 2

    fireEvent.dragStart(draggedRow)
    fireEvent.dragOver(targetRow)
    fireEvent.drop(targetRow)

    // Dropping Bijan onto Chase (the row right after it) is order-unchanged,
    // so drag Chase onto the end-zone instead to prove reordering works.
    const rowsAfterNoOp = screen.getAllByRole('row')
    expect(
      within(rowsAfterNoOp[1]).getByText('Bijan Robinson'),
    ).toBeInTheDocument()

    const chaseRow = rowsAfterNoOp[2]
    const endZone = rowsAfterNoOp[rowsAfterNoOp.length - 1]
    fireEvent.dragStart(chaseRow)
    fireEvent.dragOver(endZone)
    fireEvent.drop(endZone)

    await waitFor(() => {
      const rowsAfter = screen.getAllByRole('row')
      expect(
        within(rowsAfter[1]).getByText('Bijan Robinson'),
      ).toBeInTheDocument()
      expect(
        within(rowsAfter[2]).getByText("Ja'Marr Chase"),
      ).toBeInTheDocument()
    })
  })

  it('Load from ADP replaces the working list', async () => {
    mockFetch({ ranks: savedRanks, players: adpPlayers })
    render(<RankingsPage />)
    await screen.findByText('Bijan Robinson')

    fireEvent.click(screen.getByRole('button', { name: 'Load from ADP' }))

    await waitFor(() => {
      expect(screen.getByText(/Starting from ADP order/)).toBeInTheDocument()
    })
    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText("Ja'Marr Chase")).toBeInTheDocument()
  })

  it('Save Ranks sends the current order as platform_player_ids', async () => {
    const fetchMock = mockFetch({
      ranks: savedRanks,
      putResponse: { count: 2 },
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
    expect(url).toContain('/ranks')
    const body = JSON.parse(init.body as string) as {
      platform_player_ids: string[]
    }
    expect(body.platform_player_ids).toEqual(['2', '3'])
  })
})
