import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DraftStatus } from '../../api/draft'
import { DraftBoard } from './DraftBoard'

function makeStatus(overrides: Partial<DraftStatus> = {}): DraftStatus {
  return {
    draft: {
      id: 1,
      platform: 'manual',
      platform_draft_id: null,
      league_id: null,
      season: '2026',
      format: 'half_ppr',
      num_teams: 4,
      num_rounds: 2,
      my_slot: 2,
      rank_set_id: null,
      roster_positions: null,
      team_names: {},
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

  it('labels every cell with its round pick and overall pick', () => {
    render(<DraftBoard status={makeStatus()} />)

    expect(screen.getByText('1.1 (1)')).toBeInTheDocument()
    expect(screen.getByText('1.4 (4)')).toBeInTheDocument()
  })

  it('reverses the pick order in even rounds', () => {
    // 4 teams. A team holds its column all the way down the board, so in
    // round 2 the leftmost column is the round's *last* pick -- it used to be
    // labelled 2.1, which is the wrong end of the snake.
    render(<DraftBoard status={makeStatus()} />)

    const cellFor = (text: string) => screen.getByText(text).closest('td')
    const row2 = screen.getAllByRole('row')[2]
    const labels = Array.from(row2.querySelectorAll('td')).map(
      (td) => td.textContent,
    )

    expect(labels).toEqual(['2.4 (8)', '2.3 (7)', '2.2 (6)', '2.1 (5)'])
    // ...and the overall numbering runs continuously round to round
    expect(cellFor('1.4 (4)')).not.toBeNull()
    expect(cellFor('2.1 (5)')).not.toBeNull()
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

    // The board abbreviates -- truncating to "Jos…" lost the identifying part.
    expect(screen.getByText('J. Allen')).toBeInTheDocument()
    expect(screen.queryByText('1.1')).not.toBeInTheDocument()
  })

  it('highlights the current pick cell', () => {
    const status = makeStatus({ current_round: 2, current_slot: 3 })

    render(<DraftBoard status={status} />)

    // Round 2, slot 3 of 4 is the round's second pick -- overall 6.
    const currentCell = screen.getByText('2.2 (6)').closest('td')
    expect(currentCell).toHaveClass('current')
  })

  it('shows a real team name for a slot when team_names has one', () => {
    const status = makeStatus()
    status.draft.team_names = { '1': 'Bourrow my Toe', '3': 'Rowdy Owls' }

    render(<DraftBoard status={status} />)

    expect(
      screen.getByRole('columnheader', { name: 'Bourrow my Toe' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Rowdy Owls' }),
    ).toBeInTheDocument()
    // slot 4 has no entry in team_names -- falls back to the generic label
    expect(
      screen.getByRole('columnheader', { name: 'Team 4' }),
    ).toBeInTheDocument()
  })
})
