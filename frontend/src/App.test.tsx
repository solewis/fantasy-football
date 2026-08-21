import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'

const emptySyncStatus = {
  players: { last_synced_at: null, record_count: 0 },
  adp: { season: '2026', last_synced_at: null, record_count: 0 },
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('/sync/status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(emptySyncStatus),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('renders the app heading', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: 'Fantasy Draft Assistant' }),
    ).toBeInTheDocument()
  })

  it('defaults to the Leagues tab', async () => {
    render(<App />)

    expect(await screen.findByText(/No leagues yet/)).toBeInTheDocument()
  })

  it('switches to the Rankings tab when clicked', async () => {
    render(<App />)
    await screen.findByText(/No leagues yet/)

    fireEvent.click(screen.getByRole('tab', { name: 'Rankings' }))

    expect(
      await screen.findByRole('button', { name: 'Load from ADP' }),
    ).toBeInTheDocument()
  })

  it('the Players tab is still reachable', async () => {
    render(<App />)
    await screen.findByText(/No leagues yet/)

    fireEvent.click(screen.getByRole('tab', { name: 'Players' }))

    expect(
      await screen.findByPlaceholderText('Find player'),
    ).toBeInTheDocument()
  })
})
