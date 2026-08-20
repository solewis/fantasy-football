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
  it('shows every starter slot as Empty when nothing is drafted yet', () => {
    render(<DraftRosterPanel picks={[]} />)

    const labels = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF']
    for (const label of labels) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByText('Empty')).toHaveLength(9)
    expect(screen.getByText('No bench players yet.')).toBeInTheDocument()
  })

  it('fills the matching position slot for a drafted player', () => {
    const picks = [
      pick({ platform_player_id: '1', name: 'Josh Allen', position: 'QB' }),
    ]

    render(<DraftRosterPanel picks={picks} />)

    const qbLabel = screen
      .getAllByText('QB')
      .find((el) => el.classList.contains('draft-roster-slot-label'))
    const qbSlot = qbLabel?.closest('.draft-roster-slot')
    expect(
      within(qbSlot as HTMLElement).getByText('Josh Allen'),
    ).toBeInTheDocument()
  })

  it('sends the extra RB beyond the two RB slots to FLEX', () => {
    const picks = [
      pick({ platform_player_id: '1', name: 'RB One', position: 'RB' }),
      pick({ platform_player_id: '2', name: 'RB Two', position: 'RB' }),
      pick({ platform_player_id: '3', name: 'RB Three', position: 'RB' }),
    ]

    render(<DraftRosterPanel picks={picks} />)

    const flexSlot = screen.getByText('FLEX').closest('.draft-roster-slot')
    expect(
      within(flexSlot as HTMLElement).getByText('RB Three'),
    ).toBeInTheDocument()
  })

  it('sends overflow beyond starters and FLEX to the bench', () => {
    const picks = [
      pick({ platform_player_id: '1', name: 'RB One', position: 'RB' }),
      pick({ platform_player_id: '2', name: 'RB Two', position: 'RB' }),
      pick({ platform_player_id: '3', name: 'RB Three', position: 'RB' }),
      pick({ platform_player_id: '4', name: 'RB Four', position: 'RB' }),
    ]

    render(<DraftRosterPanel picks={picks} />)

    expect(screen.getByText('RB Four')).toBeInTheDocument()
    expect(screen.queryByText('No bench players yet.')).not.toBeInTheDocument()
  })
})
