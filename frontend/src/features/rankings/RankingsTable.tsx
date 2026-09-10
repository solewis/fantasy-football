import type { RankRow } from '../../api/ranks'
import { isBelowMidpoint } from '../../lib/reorder'
import { PositionTag } from '../players/PositionTag'

interface RankingsTableProps {
  rows: RankRow[]
  draggedId: string | null
  onDragStartRow: (platformPlayerId: string) => void
  onDragEndRow: () => void
  /** hoveredId null means the move-to-end zone. */
  onDragOverRow: (hoveredId: string | null, insertAfter: boolean) => void
  onMoveUp: (index: number) => void
  onMoveDown: (index: number) => void
}

/** The drag-and-drop rank table.
 *
 * Purely presentational on purpose: it never computes the next order and never
 * holds the list. The reorder logic and its two refs stay in the component that
 * owns the setter, because the subtle part of this table is *why* those refs
 * exist -- dragover can fire before React flushes the state update from
 * dragstart, so a handler closing over state would read a stale value and
 * silently drop the first reorder. Handing this component the list and asking
 * it for the next one would reintroduce that bug through props, which are also
 * a render behind during a fast drag.
 */
export function RankingsTable({
  rows,
  draggedId,
  onDragStartRow,
  onDragEndRow,
  onDragOverRow,
  onMoveUp,
  onMoveDown,
}: RankingsTableProps) {
  return (
    <table className="rankings-table">
      <thead>
        <tr>
          <th>Rk</th>
          <th>ADP</th>
          <th>Name</th>
          <th>Team</th>
          <th>Move</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr
            key={row.platform_player_id}
            draggable
            className={draggedId === row.platform_player_id ? 'dragging' : ''}
            onDragStart={() => onDragStartRow(row.platform_player_id)}
            onDragEnd={onDragEndRow}
            onDragOver={(e) => {
              e.preventDefault()
              const rect = e.currentTarget.getBoundingClientRect()
              const insertAfter = isBelowMidpoint(e.clientY, rect)
              onDragOverRow(row.platform_player_id, insertAfter)
            }}
            onDrop={(e) => {
              e.preventDefault()
              onDragEndRow()
            }}
          >
            <td>{index + 1}</td>
            <td>{row.adp !== null ? row.adp.toFixed(1) : '—'}</td>
            <td>
              <PositionTag position={row.position} />
              <span className="player-name">{row.name}</span>
            </td>
            <td>{row.team ?? '—'}</td>
            <td className="rankings-move-cell">
              <button
                type="button"
                className="rankings-move-btn"
                onClick={() => onMoveUp(index)}
                disabled={index === 0}
                aria-label={`Move ${row.name} up`}
              >
                ▲
              </button>
              <button
                type="button"
                className="rankings-move-btn"
                onClick={() => onMoveDown(index)}
                disabled={index === rows.length - 1}
                aria-label={`Move ${row.name} down`}
              >
                ▼
              </button>
            </td>
          </tr>
        ))}
        <tr
          className="rankings-end-zone"
          onDragOver={(e) => {
            e.preventDefault()
            onDragOverRow(null, false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            onDragEndRow()
          }}
        >
          <td colSpan={5}>Drop here to move to the end</td>
        </tr>
      </tbody>
    </table>
  )
}
