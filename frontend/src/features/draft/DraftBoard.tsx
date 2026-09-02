import type { DraftStatus, PickRow } from '../../api/draft'
import { abbreviateName } from '../../lib/playerName'
import { pickLabel } from '../../lib/snake'
import './draft.css'

interface DraftBoardProps {
  status: DraftStatus
}

export function DraftBoard({ status }: DraftBoardProps) {
  const { draft, picks, current_round, current_slot } = status

  const picksByCell = new Map<string, PickRow>()
  for (const pick of picks) {
    picksByCell.set(`${pick.round}-${pick.slot}`, pick)
  }

  const rounds = Array.from({ length: draft.num_rounds }, (_, i) => i + 1)
  const slots = Array.from({ length: draft.num_teams }, (_, i) => i + 1)

  return (
    <div className="draft-board-wrapper">
      <table className="draft-board">
        <thead>
          <tr>
            {slots.map((slot) => (
              <th
                key={slot}
                className={slot === draft.my_slot ? 'my-team' : ''}
              >
                {slot === draft.my_slot
                  ? 'You'
                  : (draft.team_names[String(slot)] ?? `Team ${slot}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rounds.map((round) => (
            <tr key={round}>
              {slots.map((slot) => {
                const pick = picksByCell.get(`${round}-${slot}`)
                // Snake numbering: in even rounds the leftmost column is the
                // round's *last* pick, since a team holds its column all the
                // way down the board.
                const label = pickLabel(round, slot, draft.num_teams)
                const isCurrent =
                  round === current_round && slot === current_slot
                const classNames = [
                  'draft-board-cell',
                  pick?.position ? `pos-${pick.position}` : '',
                  isCurrent && 'current',
                  slot === draft.my_slot && 'my-team',
                ]
                  .filter(Boolean)
                  .join(' ')

                return (
                  <td key={slot} className={classNames}>
                    {pick ? (
                      <span className="draft-board-pick" title={pick.name}>
                        <span className="draft-board-pick-top">
                          <span className="draft-board-player-name">
                            {abbreviateName(pick.name)}
                          </span>
                          <span className="draft-board-pick-no">{label}</span>
                        </span>
                        <span className="draft-board-player-meta">
                          {pick.position ?? '—'} · {pick.team ?? '—'}
                        </span>
                      </span>
                    ) : (
                      <span className="draft-board-pick-label">{label}</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
