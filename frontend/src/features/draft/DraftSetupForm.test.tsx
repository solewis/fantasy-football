import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DraftStatus } from '../../api/draft'
import { DraftSetupForm } from './DraftSetupForm'

const sampleStatus: DraftStatus = {
  draft: {
    id: 1,
    platform: 'manual',
    platform_draft_id: null,
    league_id: null,
    season: '2026',
    format: 'half_ppr',
    num_teams: 10,
    num_rounds: 14,
    my_slot: 1,
    rank_set_id: null,
    roster_positions: null,
    team_names: {},
  },
  picks: [],
  next_pick_number: 1,
  current_round: 1,
  current_slot: 1,
  is_my_turn: true,
  is_complete: false,
}

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

function mockFetch(
  draftResponse: {
    ok: boolean
    status?: number
    json: () => Promise<unknown>
  } = jsonResponse(sampleStatus),
) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    void url
    void init
    return Promise.resolve(draftResponse)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('DraftSetupForm', () => {
  it('submits settings and calls onCreated on success', async () => {
    const fetchMock = mockFetch()
    const onCreated = vi.fn()

    render(<DraftSetupForm onCreated={onCreated} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))

    await vi.waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(sampleStatus)
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/drafts')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({
      season: '2026',
      format: 'half_ppr',
      num_teams: 10,
      num_rounds: 14,
      my_slot: 1,
    })
  })

  it('disables submit and shows an error when the slot is out of range', () => {
    mockFetch()
    render(<DraftSetupForm onCreated={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Your draft slot'), {
      target: { value: '99' },
    })

    expect(
      screen.getByText('Slot must be between 1 and 10.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Draft' })).toBeDisabled()
  })

  it('shows an error message when creation fails', async () => {
    mockFetch({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    })

    render(<DraftSetupForm onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))

    expect(await screen.findByText(/Creating draft/)).toBeInTheDocument()
  })

  it('switching to Sleeper mode swaps in the draft-id field', () => {
    mockFetch()
    render(<DraftSetupForm onCreated={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Sync from Sleeper' }))

    expect(screen.getByLabelText('Sleeper draft ID')).toBeInTheDocument()
    expect(screen.queryByLabelText('Number of teams')).not.toBeInTheDocument()
  })

  it('disables submit until a Sleeper draft ID is entered', () => {
    mockFetch()
    render(<DraftSetupForm onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Sync from Sleeper' }))

    expect(screen.getByRole('button', { name: 'Start Draft' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Sleeper draft ID'), {
      target: { value: '999' },
    })

    expect(screen.getByRole('button', { name: 'Start Draft' })).toBeEnabled()
  })

  it('submits to the Sleeper endpoint with the entered draft ID', async () => {
    const sleeperStatus: DraftStatus = {
      ...sampleStatus,
      draft: {
        ...sampleStatus.draft,
        platform: 'sleeper',
        platform_draft_id: '999',
      },
    }
    const fetchMock = mockFetch(jsonResponse(sleeperStatus))
    const onCreated = vi.fn()

    render(<DraftSetupForm onCreated={onCreated} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Sync from Sleeper' }))
    fireEvent.change(screen.getByLabelText('Sleeper draft ID'), {
      target: { value: '999' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))

    await vi.waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(sleeperStatus)
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/drafts/sleeper')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({
      platform_draft_id: '999',
      format: 'half_ppr',
      my_slot: 1,
    })
  })
})
