import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { PickRow } from '../../api/draft'
import { DraftRosterPanel } from './DraftRosterPanel'

function pick(overrides: Partial<PickRow>): PickRow {
  return {
    pick_number: 1,
    round: 1,
    slot: 1,
    platform_player_id: '1',
    name: 'Player',
    position: 'RB',
    team: 'XXX',
    ...overrides,
  }
}

describe('DraftRosterPanel', () => {
  it('shows an empty message when nothing is drafted yet', () => {
    render(<DraftRosterPanel picks={[]} />)

    expect(screen.getByText('No players drafted yet.')).toBeInTheDocument()
  })

  it('groups picks by position', () => {
    const picks = [
      pick({ platform_player_id: '1', name: 'Josh Allen', position: 'QB' }),
      pick({ platform_player_id: '2', name: 'Bijan Robinson', position: 'RB' }),
      pick({ platform_player_id: '3', name: "Ja'Marr Chase", position: 'WR' }),
    ]

    render(<DraftRosterPanel picks={picks} />)

    const qbGroup = screen
      .getByRole('heading', { name: 'QB' })
      .closest('.draft-roster-group')
    expect(qbGroup).not.toBeNull()
    expect(
      within(qbGroup as HTMLElement).getByText('Josh Allen'),
    ).toBeInTheDocument()

    const rbGroup = screen
      .getByRole('heading', { name: 'RB' })
      .closest('.draft-roster-group')
    expect(
      within(rbGroup as HTMLElement).getByText('Bijan Robinson'),
    ).toBeInTheDocument()
  })

  it('orders known position groups QB/RB/WR/TE/K/DEF', () => {
    const picks = [
      pick({ platform_player_id: '1', name: 'A Kicker', position: 'K' }),
      pick({ platform_player_id: '2', name: 'A QB', position: 'QB' }),
      pick({ platform_player_id: '3', name: 'A WR', position: 'WR' }),
    ]

    render(<DraftRosterPanel picks={picks} />)

    const headings = screen
      .getAllByRole('heading', { level: 4 })
      .map((h) => h.textContent)
    expect(headings).toEqual(['QB', 'WR', 'K'])
  })
})
