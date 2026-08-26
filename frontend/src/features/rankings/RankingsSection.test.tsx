import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RankingsSection } from './RankingsSection'

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

function mockBackend() {
  const fetchMock = vi.fn((_url: string) => Promise.resolve(jsonResponse([])))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('RankingsSection', () => {
  it('renders the platform tabs and format select exactly once', async () => {
    mockBackend()
    render(<RankingsSection />)

    // Regression guard: if a sub-view grows its own copy you end up with two
    // platform togglers that can disagree with each other.
    await waitFor(() => {
      expect(screen.getAllByRole('tab', { name: 'Sleeper' })).toHaveLength(1)
    })
    expect(screen.getAllByLabelText('Scoring format')).toHaveLength(1)
  })

  it('switches between the three sub-views', async () => {
    mockBackend()
    render(<RankingsSection />)

    fireEvent.click(screen.getByRole('tab', { name: 'Sources' }))
    expect(
      await screen.findByRole('button', { name: '+ Import Rankings' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Build' }))
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Overall' })).toBeInTheDocument()
    })
  })

  it('remembers the sub-view across reloads', async () => {
    mockBackend()
    const { unmount } = render(<RankingsSection />)
    fireEvent.click(screen.getByRole('tab', { name: 'Sources' }))
    await screen.findByRole('button', { name: '+ Import Rankings' })
    unmount()

    render(<RankingsSection />)

    expect(
      await screen.findByRole('button', { name: '+ Import Rankings' }),
    ).toBeInTheDocument()
  })

  it('threads the platform choice into the active sub-view', async () => {
    const fetchMock = mockBackend()
    render(<RankingsSection />)
    fireEvent.click(screen.getByRole('tab', { name: 'Build' }))
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Overall' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('tab', { name: 'ESPN' }))

    await waitFor(() => {
      const espnCalls = fetchMock.mock.calls
        .map(([url]) => new URL(url as string))
        .filter((u) => u.searchParams.get('platform') === 'espn')
      expect(espnCalls.length).toBeGreaterThan(0)
    })
  })
})
