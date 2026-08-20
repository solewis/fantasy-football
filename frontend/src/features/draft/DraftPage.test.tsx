import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DraftStatus, PickRow, QueueRow } from '../../api/draft'
import { DraftPage } from './DraftPage'

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

const PLAYERS: Record<
  string,
  { name: string; position: string; team: string }
> = {
  '1': { name: 'Josh Allen', position: 'QB', team: 'BUF' },
  '2': { name: 'Bijan Robinson', position: 'RB', team: 'ATL' },
  '3': { name: "Ja'Marr Chase", position: 'WR', team: 'CIN' },
}

/** A small in-memory stand-in for the backend: 2 teams, 2 rounds, my_slot 2. */
function mockBackend() {
  let picks: PickRow[] = []
  let queue: QueueRow[] = []
  let platform: 'manual' | 'sleeper' = 'manual'
  let syncedOnce = false
  const numTeams = 2
  const numRounds = 2

  function roundAndSlot(pickNumber: number) {
    const round = Math.floor((pickNumber - 1) / numTeams) + 1
    const positionInRound = (pickNumber - 1) % numTeams
    const slot =
      round % 2 === 1 ? positionInRound + 1 : numTeams - positionInRound
    return { round, slot }
  }

  function status(): DraftStatus {
    const total = numTeams * numRounds
    const nextPickNumber = picks.length + 1
    const isComplete = nextPickNumber > total
    const rs = isComplete
      ? { round: null, slot: null }
      : roundAndSlot(nextPickNumber)
    return {
      draft: {
        id: 1,
        platform,
        platform_draft_id: platform === 'sleeper' ? '999' : null,
        league_id: null,
        season: '2026',
        format: 'half_ppr',
        num_teams: numTeams,
        num_rounds: numRounds,
        my_slot: 2,
        rank_set_id: null,
        roster_positions: null,
        team_names: {},
      },
      picks,
      next_pick_number: isComplete ? null : nextPickNumber,
      current_round: rs.round,
      current_slot: rs.slot,
      is_my_turn: !isComplete && rs.slot === 2,
      is_complete: isComplete,
    }
  }

  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body
      ? (JSON.parse(init.body as string) as Record<string, unknown>)
      : undefined

    if (/\/drafts\/sleeper$/.test(url) && method === 'POST') {
      platform = 'sleeper'
      return Promise.resolve(jsonResponse(status()))
    }
    if (/\/drafts\/\d+\/sync$/.test(url) && method === 'POST') {
      // Simulate one external pick landing on Sleeper, the first time sync runs.
      if (!syncedOnce) {
        syncedOnce = true
        const pickNumber = picks.length + 1
        const rs = roundAndSlot(pickNumber)
        const player = PLAYERS['1']
        picks = [
          ...picks,
          {
            pick_number: pickNumber,
            round: rs.round,
            slot: rs.slot,
            platform_player_id: '1',
            name: player.name,
            position: player.position,
            team: player.team,
          },
        ]
      }
      return Promise.resolve(jsonResponse(status()))
    }
    if (/\/drafts\/\d+\/switch-to-manual$/.test(url) && method === 'POST') {
      platform = 'manual'
      return Promise.resolve(jsonResponse(status()))
    }
    if (/\/drafts$/.test(url) && method === 'POST') {
      return Promise.resolve(jsonResponse(status()))
    }
    if (/\/drafts\/\d+$/.test(url) && method === 'GET') {
      return Promise.resolve(jsonResponse(status()))
    }
    if (/\/drafts\/\d+\/picks$/.test(url) && method === 'POST') {
      const playerId = body?.platform_player_id as string
      const pickNumber = picks.length + 1
      const rs = roundAndSlot(pickNumber)
      const player = PLAYERS[playerId]
      picks = [
        ...picks,
        {
          pick_number: pickNumber,
          round: rs.round,
          slot: rs.slot,
          platform_player_id: playerId,
          name: player.name,
          position: player.position,
          team: player.team,
        },
      ]
      queue = queue.filter((q) => q.platform_player_id !== playerId)
      return Promise.resolve(jsonResponse({ pick_number: pickNumber }))
    }
    if (/\/drafts\/\d+\/picks$/.test(url) && method === 'DELETE') {
      const last = picks.at(-1)
      picks = picks.slice(0, -1)
      return Promise.resolve(
        jsonResponse(last ? { pick_number: last.pick_number } : null),
      )
    }
    if (/\/drafts\/\d+\/queue$/.test(url) && method === 'GET') {
      return Promise.resolve(jsonResponse(queue))
    }
    if (/\/drafts\/\d+\/queue$/.test(url) && method === 'PUT') {
      const ids = (body?.platform_player_ids as string[]) ?? []
      queue = ids.map((id) => ({ platform_player_id: id, ...PLAYERS[id] }))
      return Promise.resolve(jsonResponse({ count: queue.length }))
    }
    if (url.includes('/ranks')) {
      return Promise.resolve(jsonResponse([]))
    }
    if (url.includes('/players')) {
      return Promise.resolve(
        jsonResponse(
          Object.entries(PLAYERS).map(([id, p], i) => ({
            rank: i + 1,
            platform_player_id: id,
            name: p.name,
            position: p.position,
            team: p.team,
            adp: i + 1,
          })),
        ),
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

describe('DraftPage', () => {
  it('shows the setup form when there is no active draft', () => {
    render(<DraftPage />)

    expect(
      screen.getByRole('heading', { name: 'New draft' }),
    ).toBeInTheDocument()
  })

  it('creating a draft shows the board and player pool', async () => {
    mockBackend()
    render(<DraftPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))

    expect(await screen.findByText('Josh Allen')).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'You' }),
    ).toBeInTheDocument()
  })

  it('drafting a player updates the board and shows whose turn it is', async () => {
    mockBackend()
    render(<DraftPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))
    await screen.findByText('Josh Allen')

    fireEvent.click(screen.getAllByRole('button', { name: 'Draft' })[0])

    // pick 1 goes to slot 1; my_slot is 2, so it's now "your pick"
    expect(await screen.findByText('Your pick!')).toBeInTheDocument()
    const board = screen.getAllByRole('table')[0]
    expect(within(board).getByText('Josh Allen')).toBeInTheDocument()
  })

  it('adding a player to the queue shows them under the Queue tab', async () => {
    mockBackend()
    render(<DraftPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))
    await screen.findByText('Josh Allen')

    fireEvent.click(screen.getAllByRole('button', { name: '+ Queue' })[0])

    await screen.findByRole('button', { name: 'Queued' })
    expect(screen.getByRole('listitem')).toHaveTextContent('Josh Allen')
  })

  it('undo removes the last pick', async () => {
    mockBackend()
    render(<DraftPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))
    await screen.findByText('Josh Allen')
    fireEvent.click(screen.getAllByRole('button', { name: 'Draft' })[0])
    await screen.findByText('Your pick!')

    fireEvent.click(screen.getByRole('button', { name: 'Undo last pick' }))

    await screen.findByText(/Team 1 is on the clock/)
    const board = screen.getAllByRole('table')[0]
    expect(within(board).queryByText('Josh Allen')).not.toBeInTheDocument()
  })

  it('New Draft (confirmed) returns to the setup form', async () => {
    mockBackend()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DraftPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))
    await screen.findByText('Josh Allen')

    fireEvent.click(screen.getByRole('button', { name: 'New Draft' }))

    expect(
      screen.getByRole('heading', { name: 'New draft' }),
    ).toBeInTheDocument()
  })

  it('falls back to the setup form if the stored draft id no longer exists', async () => {
    localStorage.setItem('fantasy-draft-app:activeDraftId', '999')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      }),
    )

    render(<DraftPage />)

    expect(
      await screen.findByRole('heading', { name: 'New draft' }),
    ).toBeInTheDocument()
    expect(localStorage.getItem('fantasy-draft-app:activeDraftId')).toBeNull()
  })

  it('creating a Sleeper-synced draft hides manual controls and shows the badge', async () => {
    mockBackend()
    render(<DraftPage />)
    fireEvent.click(screen.getByRole('tab', { name: 'Sync from Sleeper' }))
    fireEvent.change(screen.getByLabelText('Sleeper draft ID'), {
      target: { value: '999' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))

    expect(await screen.findByText('Synced from Sleeper')).toBeInTheDocument()
    await screen.findByText('Josh Allen')
    expect(
      screen.queryByRole('button', { name: 'Undo last pick' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Switch to manual' }),
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: 'Draft' })).toHaveLength(0)
  })

  it('polls Sleeper for new picks and updates the board', async () => {
    vi.useFakeTimers()
    try {
      mockBackend()
      render(<DraftPage />)
      fireEvent.click(screen.getByRole('tab', { name: 'Sync from Sleeper' }))
      fireEvent.change(screen.getByLabelText('Sleeper draft ID'), {
        target: { value: '999' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))

      // Flush the create-draft + initial-load fetch/state chain (no real
      // timers involved yet -- just draining queued microtasks).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByText('Synced from Sleeper')).toBeInTheDocument()
      const board = () => screen.getAllByRole('table')[0]
      expect(within(board()).queryByText('Josh Allen')).not.toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      expect(within(board()).getByText('Josh Allen')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('Switch to manual (confirmed) restores manual controls', async () => {
    mockBackend()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DraftPage />)
    fireEvent.click(screen.getByRole('tab', { name: 'Sync from Sleeper' }))
    fireEvent.change(screen.getByLabelText('Sleeper draft ID'), {
      target: { value: '999' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))
    await screen.findByText('Synced from Sleeper')

    fireEvent.click(screen.getByRole('button', { name: 'Switch to manual' }))

    await screen.findByRole('button', { name: 'Undo last pick' })
    expect(screen.queryByText('Synced from Sleeper')).not.toBeInTheDocument()
  })
})
