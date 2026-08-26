import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BuildPage } from './BuildPage'

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

const SOURCES = [
  {
    ref: 'adp',
    label: 'ADP',
    kind: 'adp',
    supports_overall: true,
    supports_positional: true,
    scope: null,
  },
  {
    ref: 'dataset:1',
    label: 'FantasyPros',
    kind: 'dataset',
    supports_overall: true,
    supports_positional: true,
    scope: null,
  },
  {
    ref: 'dataset:2',
    label: 'WR only',
    kind: 'dataset',
    supports_overall: false,
    supports_positional: true,
    scope: null,
  },
]

const PLAYERS = [
  {
    platform_player_id: '1',
    name: "Ja'Marr Chase",
    position: 'WR',
    team: 'CIN',
    adp: 3.2,
    ranks: { adp: 1, 'dataset:1': 1 },
    source_tier: 1,
  },
  {
    platform_player_id: '2',
    name: 'Puka Nacua',
    position: 'WR',
    team: 'LAR',
    adp: 4.7,
    ranks: { adp: 2, 'dataset:1': 3 },
    source_tier: 2,
  },
  {
    platform_player_id: '3',
    name: 'Justin Jefferson',
    position: 'WR',
    team: 'MIN',
    adp: 13.9,
    ranks: { adp: 3, 'dataset:1': null },
    source_tier: null,
  },
]

function mockBackend() {
  const fetchMock = vi.fn((url: string) => {
    const { pathname } = new URL(url)
    if (pathname === '/rank-sources')
      return Promise.resolve(jsonResponse(SOURCES))
    if (pathname === '/rank-sets') return Promise.resolve(jsonResponse([]))
    if (pathname === '/rank-pool') {
      return Promise.resolve(
        jsonResponse({
          scope: 'overall',
          sources: [
            {
              ref: 'adp',
              label: 'ADP',
              kind: 'adp',
              depth: 3,
              unresolved_count: 0,
            },
            {
              ref: 'dataset:1',
              label: 'FantasyPros',
              kind: 'dataset',
              depth: 3,
              unresolved_count: 0,
            },
          ],
          players: PLAYERS,
        }),
      )
    }
    return Promise.resolve(jsonResponse([]))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

async function renderBuild() {
  mockBackend()
  render(<BuildPage platform="sleeper" format="half_ppr" />)
  // ADP is selected by default; add the dataset so there are two opinions to
  // compare, which is the case the view exists for.
  await screen.findByText("Ja'Marr Chase")
  fireEvent.click(screen.getByRole('checkbox', { name: /FantasyPros/ }))
  await waitFor(() => {
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })
}

describe('BuildPage', () => {
  it('orders candidates by average rank and shows coverage', async () => {
    await renderBuild()

    const rows = screen.getAllByRole('row').slice(1)
    const names = rows.map((r) => r.textContent ?? '')
    expect(names[0]).toContain("Ja'Marr Chase")
    // Chase averages 1, Puka (2 and 3) averages 2.5, Jefferson only ADP ranks
    expect(names[1]).toContain('Puka Nacua')
    expect(names[2]).toContain('Justin Jefferson')
    // Jefferson is ranked by 1 of the 2 selected sources
    expect(names[2]).toContain('1/2')
  })

  it('picking a candidate moves them into the list and advances the slot', async () => {
    await renderBuild()
    expect(screen.getByText('Filling #1')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Pick' })[0])

    await waitFor(() => {
      expect(screen.getByText('Filling #2')).toBeInTheDocument()
    })
    expect(screen.getByText('My list (1)')).toBeInTheDocument()
    // ...and they're gone from the candidate table
    const pickButtons = screen.getAllByRole('button', { name: 'Pick' })
    expect(pickButtons).toHaveLength(2)
  })

  it('undo reverses a pick exactly', async () => {
    await renderBuild()
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick' })[0])
    await waitFor(() => {
      expect(screen.getByText('Filling #2')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => {
      expect(screen.getByText('Filling #1')).toBeInTheDocument()
    })
    expect(screen.getByText('My list (0)')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Pick' })).toHaveLength(3)
  })

  it('shows a missing chip for a source that does not rank a player', async () => {
    await renderBuild()

    // Jefferson is unranked by FantasyPros
    const jeffersonRow = screen
      .getAllByRole('row')
      .find((r) => r.textContent?.includes('Justin Jefferson'))
    expect(
      jeffersonRow?.querySelector('[data-bucket="missing"]'),
    ).not.toBeNull()
  })

  it('disables a source that cannot serve the current axis', async () => {
    await renderBuild()

    // "WR only" has no overall ranks, so it can't feed an overall list -- and
    // it stays visible with the reason rather than vanishing.
    const checkbox = screen.getByRole('checkbox', { name: /WR only/ })
    expect(checkbox).toBeDisabled()
    expect(screen.getByText('no overall ranks')).toBeInTheDocument()
  })

  it('does not recommend anyone', async () => {
    await renderBuild()

    // The tool reports what sources think; it never marks a suggested pick.
    expect(screen.queryByText(/recommend/i)).toBeNull()
    expect(screen.queryByText(/suggested/i)).toBeNull()
  })
})
