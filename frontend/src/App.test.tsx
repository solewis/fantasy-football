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

  it('defaults to the Players tab', () => {
    render(<App />)

    expect(screen.getByPlaceholderText('Find player')).toBeInTheDocument()
  })

  it('switches to the Rankings tab when clicked', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: 'Rankings' }))

    expect(
      await screen.findByRole('button', { name: 'Load from ADP' }),
    ).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Find player')).not.toBeInTheDocument()
  })
})
