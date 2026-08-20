import type { DraftStatus, PickRow } from '../../api/draft'
import { PositionTag } from '../players/PositionTag'
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
                {slot === draft.my_slot ? 'You' : `Team ${slot}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rounds.map((round) => (
            <tr key={round}>
              {slots.map((slot) => {
                const pick = picksByCell.get(`${round}-${slot}`)
                const isCurrent =
                  round === current_round && slot === current_slot
                const classNames = [
                  'draft-board-cell',
                  isCurrent && 'current',
                  slot === draft.my_slot && 'my-team',
                ]
                  .filter(Boolean)
                  .join(' ')

                return (
                  <td key={slot} className={classNames}>
                    {pick ? (
                      <>
                        <PositionTag position={pick.position} />
                        <span className="draft-board-player-name">
                          {pick.name}
                        </span>
                      </>
                    ) : (
                      <span className="draft-board-pick-label">
                        {round}.{slot}
                      </span>
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
