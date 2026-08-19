import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SyncPanel } from './SyncPanel'

const statusResponse = {
  players: { last_synced_at: '2026-08-19T10:00:00Z', record_count: 12221 },
  adp: {
    season: '2026',
    last_synced_at: '2026-08-19T11:00:00Z',
    record_count: 6799,
  },
}

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('SyncPanel', () => {
  it('renders status once loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(statusResponse)),
    )

    render(<SyncPanel season="2026" onSyncComplete={vi.fn()} />)

    expect(await screen.findByText(/12221 players/)).toBeInTheDocument()
    expect(screen.getByText(/6799 rows/)).toBeInTheDocument()
  })

  it('triggers a players sync and calls onSyncComplete on success', async () => {
    const onSyncComplete = vi.fn()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(statusResponse))
      .mockResolvedValueOnce(
        jsonResponse({
          last_synced_at: '2026-08-19T12:00:00Z',
          record_count: 12300,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    render(<SyncPanel season="2026" onSyncComplete={onSyncComplete} />)
    await screen.findByText(/12221 players/)

    fireEvent.click(screen.getByRole('button', { name: 'Sync players' }))

    await waitFor(() => {
      expect(screen.getByText(/12300 players/)).toBeInTheDocument()
    })
    expect(onSyncComplete).toHaveBeenCalledTimes(1)
    const lastCall = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    expect(lastCall[0]).toContain('/sync/players')
    expect(lastCall[1]).toMatchObject({ method: 'POST' })
  })

  it('triggers an ADP sync and calls onSyncComplete on success', async () => {
    const onSyncComplete = vi.fn()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(statusResponse))
      .mockResolvedValueOnce(
        jsonResponse({
          season: '2026',
          last_synced_at: '2026-08-19T12:00:00Z',
          record_count: 7000,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    render(<SyncPanel season="2026" onSyncComplete={onSyncComplete} />)
    await screen.findByText(/6799 rows/)

    fireEvent.click(screen.getByRole('button', { name: 'Sync ADP' }))

    await waitFor(() => {
      expect(screen.getByText(/7000 rows/)).toBeInTheDocument()
    })
    expect(onSyncComplete).toHaveBeenCalledTimes(1)
    const lastCall = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    expect(lastCall[0]).toContain('/sync/adp')
    expect(lastCall[1]).toMatchObject({ method: 'POST' })
  })

  it('shows an error and does not call onSyncComplete when a sync fails', async () => {
    const onSyncComplete = vi.fn()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(statusResponse))
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<SyncPanel season="2026" onSyncComplete={onSyncComplete} />)
    await screen.findByText(/12221 players/)

    fireEvent.click(screen.getByRole('button', { name: 'Sync players' }))

    expect(
      await screen.findByText(/Syncing players failed/),
    ).toBeInTheDocument()
    expect(onSyncComplete).not.toHaveBeenCalled()
  })
})
