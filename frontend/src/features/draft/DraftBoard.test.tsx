import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DraftStatus } from '../../api/draft'
import { DraftBoard } from './DraftBoard'

function makeStatus(overrides: Partial<DraftStatus> = {}): DraftStatus {
  return {
    draft: {
      id: 1,
      season: '2026',
      format: 'half_ppr',
      num_teams: 4,
      num_rounds: 2,
      my_slot: 2,
    },
    picks: [],
    next_pick_number: 1,
    current_round: 1,
    current_slot: 1,
    is_my_turn: false,
    is_complete: false,
    ...overrides,
  }
}

describe('DraftBoard', () => {
  it('renders one column per team, labeling the my_slot column "You"', () => {
    render(<DraftBoard status={makeStatus()} />)

    expect(
      screen.getByRole('columnheader', { name: 'You' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Team 1' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Team 3' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Team 4' }),
    ).toBeInTheDocument()
  })

  it('shows an empty pick label for unfilled cells as round.slot', () => {
    render(<DraftBoard status={makeStatus()} />)

    expect(screen.getByText('1.1')).toBeInTheDocument()
    expect(screen.getByText('2.4')).toBeInTheDocument()
  })

  it('shows a picked player in the cell matching their round/slot', () => {
    const status = makeStatus({
      picks: [
        {
          pick_number: 1,
          round: 1,
          slot: 1,
          platform_player_id: '9',
          name: 'Josh Allen',
          position: 'QB',
          team: 'BUF',
        },
      ],
    })

    render(<DraftBoard status={status} />)

    expect(screen.getByText('Josh Allen')).toBeInTheDocument()
    expect(screen.queryByText('1.1')).not.toBeInTheDocument()
  })

  it('highlights the current pick cell', () => {
    const status = makeStatus({ current_round: 2, current_slot: 3 })

    render(<DraftBoard status={status} />)

    const currentCell = screen.getByText('2.3').closest('td')
    expect(currentCell).toHaveClass('current')
  })
})
