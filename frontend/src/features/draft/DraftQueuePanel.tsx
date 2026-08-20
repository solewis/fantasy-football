import type { QueueRow } from '../../api/draft'
import { reorderList } from '../../lib/reorder'
import { PositionTag } from '../players/PositionTag'
import './draft.css'

interface DraftQueuePanelProps {
  queue: QueueRow[]
  canDraft: boolean
  onReorder: (next: QueueRow[]) => void
  onRemove: (playerId: string) => void
  onDraft: (playerId: string) => void
}

export function DraftQueuePanel({
  queue,
  canDraft,
  onReorder,
  onRemove,
  onDraft,
}: DraftQueuePanelProps) {
  function moveUp(index: number) {
    if (index <= 0) return
    onReorder(
      reorderList(
        queue,
        queue[index].platform_player_id,
        queue[index - 1].platform_player_id,
        false,
      ),
    )
  }

  function moveDown(index: number) {
    if (index >= queue.length - 1) return
    onReorder(
      reorderList(
        queue,
        queue[index].platform_player_id,
        queue[index + 1].platform_player_id,
        true,
      ),
    )
  }

  if (queue.length === 0) {
    return (
      <p className="draft-queue-empty">
        No players in your queue. Add some from the player pool.
      </p>
    )
  }

  return (
    <ul className="draft-queue-list">
      {queue.map((row, index) => (
        <li key={row.platform_player_id} className="draft-queue-row">
          <span className="draft-queue-rank">{index + 1}</span>
          <PositionTag position={row.position} />
          <span className="draft-queue-name">{row.name}</span>
          <div className="draft-queue-actions">
            <button
              type="button"
              onClick={() => moveUp(index)}
              disabled={index === 0}
              aria-label={`Move ${row.name} up`}
            >
              ▲
            </button>
            <button
              type="button"
              onClick={() => moveDown(index)}
              disabled={index === queue.length - 1}
              aria-label={`Move ${row.name} down`}
            >
              ▼
            </button>
            {canDraft && (
              <button
                type="button"
                onClick={() => onDraft(row.platform_player_id)}
              >
                Draft
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemove(row.platform_player_id)}
              aria-label={`Remove ${row.name} from queue`}
            >
              ✕
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
