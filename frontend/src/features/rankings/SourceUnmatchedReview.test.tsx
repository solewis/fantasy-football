import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SourceUnmatchedReview } from './SourceUnmatchedReview'

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

const UNMATCHED = [
  {
    normalized_name: 'uncle rico',
    source_name_raw: 'Uncle Rico',
    position: 'WR',
    candidates: [
      {
        platform_player_id: '1',
        name: "Ja'Marr Chase",
        position: 'WR',
        team: 'CIN',
        score: 71,
      },
      {
        platform_player_id: '2',
        name: 'Puka Nacua',
        position: 'WR',
        team: 'LAR',
        score: 64,
      },
    ],
  },
]

function mockBackend(unmatched = UNMATCHED) {
  const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
    const { pathname } = new URL(url)
    if (pathname.endsWith('/unmatched'))
      return Promise.resolve(jsonResponse(unmatched))
    if (pathname.endsWith('/mappings'))
      return Promise.resolve(
        jsonResponse({ confirmed: 1, remaining_unmatched: 0 }),
      )
    return Promise.resolve(jsonResponse([]))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function lastConfirmation(fetchMock: ReturnType<typeof mockBackend>) {
  const call = fetchMock.mock.calls
    .filter(([url]) => (url as string).includes('/mappings'))
    .at(-1)
  if (!call) throw new Error('no /mappings call was made')
  const body = JSON.parse((call[1] as RequestInit).body as string) as {
    confirmations: { platform_player_id: string | null }[]
  }
  return body.confirmations[0]
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

async function renderReview() {
  const fetchMock = mockBackend()
  render(
    <SourceUnmatchedReview datasetId={1} platform="sleeper" onDone={vi.fn()} />,
  )
  await screen.findByText('Uncle Rico')
  return fetchMock
}

describe('SourceUnmatchedReview', () => {
  it('shows the unresolved name with ranked candidates', async () => {
    await renderReview()

    expect(screen.getByText('Unmatched names — 1 of 1')).toBeInTheDocument()
    expect(screen.getByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(screen.getByText('71')).toBeInTheDocument()
  })

  it('clicking a candidate confirms it', async () => {
    const fetchMock = await renderReview()

    fireEvent.click(screen.getByText('Puka Nacua'))

    await waitFor(() => {
      expect(lastConfirmation(fetchMock).platform_player_id).toBe('2')
    })
  })

  it('number keys select and Enter confirms', async () => {
    const fetchMock = await renderReview()
    const panel = document.querySelector('.sources-review') as HTMLElement

    fireEvent.keyDown(panel, { key: '2' })
    fireEvent.keyDown(panel, { key: 'Enter' })

    await waitFor(() => {
      expect(lastConfirmation(fetchMock).platform_player_id).toBe('2')
    })
  })

  it('N records a confirmed "not a player" so it is never asked again', async () => {
    const fetchMock = await renderReview()
    const panel = document.querySelector('.sources-review') as HTMLElement

    fireEvent.keyDown(panel, { key: 'n' })

    await waitFor(() => {
      expect(lastConfirmation(fetchMock).platform_player_id).toBeNull()
    })
  })

  it('reports progress once the queue is cleared', async () => {
    await renderReview()

    fireEvent.click(screen.getByText("Ja'Marr Chase"))

    expect(await screen.findByText(/Resolved 1 name\./)).toBeInTheDocument()
  })

  it('says so when there is nothing to review', async () => {
    mockBackend([])
    render(
      <SourceUnmatchedReview
        datasetId={1}
        platform="sleeper"
        onDone={vi.fn()}
      />,
    )

    expect(
      await screen.findByText('Nothing left to review.'),
    ).toBeInTheDocument()
  })
})
