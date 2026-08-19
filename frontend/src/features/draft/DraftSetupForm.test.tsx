import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DraftStatus } from '../../api/draft'
import { DraftSetupForm } from './DraftSetupForm'

const sampleStatus: DraftStatus = {
  draft: {
    id: 1,
    season: '2026',
    format: 'half_ppr',
    num_teams: 10,
    num_rounds: 14,
    my_slot: 1,
  },
  picks: [],
  next_pick_number: 1,
  current_round: 1,
  current_slot: 1,
  is_my_turn: true,
  is_complete: false,
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('DraftSetupForm', () => {
  it('submits settings and calls onCreated on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(sampleStatus),
    })
    vi.stubGlobal('fetch', fetchMock)
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      }),
    )

    render(<DraftSetupForm onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Draft' }))

    expect(await screen.findByText(/Creating draft/)).toBeInTheDocument()
  })
})
