import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DraftStatus } from '../../api/draft'
import { DraftPage } from './DraftPage'

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

const sampleStatus: DraftStatus = {
  draft: {
    id: 1,
    platform: 'manual',
    platform_draft_id: null,
    league_id: null,
    season: '2026',
    format: 'half_ppr',
    num_teams: 2,
    num_rounds: 2,
    my_slot: 2,
    rank_set_id: null,
    roster_positions: null,
    team_names: {},
  },
  picks: [],
  next_pick_number: 1,
  current_round: 1,
  current_slot: 1,
  is_my_turn: false,
  is_complete: false,
}

/** A minimal in-memory stand-in -- DraftPage's own tests only cover the
 * ad-hoc setup-form flow and the localStorage-pointer lifecycle. The actual
 * drafting/board/polling behavior lives in DraftRoom.test.tsx now that
 * DraftPage just wraps DraftRoom for the non-league path. */
function mockBackend() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (/\/drafts$/.test(url) && method === 'POST') {
      return Promise.resolve(jsonResponse(sampleStatus))
    }
    if (/\/drafts\/\d+$/.test(url) && method === 'GET') {
      return Promise.resolve(jsonResponse(sampleStatus))
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

  it('creating a draft shows the board and stores the active draft id', async () => {
    mockBackend()
    render(<DraftPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))

    expect(
      await screen.findByRole('columnheader', { name: 'You' }),
    ).toBeInTheDocument()
    expect(localStorage.getItem('fantasy-draft-app:activeDraftId')).toBe('1')
  })

  it('New Draft requires a confirm click, then returns to the setup form', async () => {
    mockBackend()
    render(<DraftPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))
    await screen.findByRole('columnheader', { name: 'You' })

    fireEvent.click(screen.getByRole('button', { name: 'New Draft' }))
    // still on the board -- only showed a confirm prompt, not reset yet
    expect(
      screen.getByRole('columnheader', { name: 'You' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm new draft?' }))

    expect(
      screen.getByRole('heading', { name: 'New draft' }),
    ).toBeInTheDocument()
    expect(localStorage.getItem('fantasy-draft-app:activeDraftId')).toBeNull()
  })

  it('New Draft can be cancelled without losing the current draft', async () => {
    mockBackend()
    render(<DraftPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))
    await screen.findByRole('columnheader', { name: 'You' })

    fireEvent.click(screen.getByRole('button', { name: 'New Draft' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(
      screen.getByRole('columnheader', { name: 'You' }),
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
})
