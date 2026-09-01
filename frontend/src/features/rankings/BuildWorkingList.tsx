import { useRef, useState } from 'react'

import type { PoolPlayer } from '../../api/rankPool'
import { tiersForOrder } from '../../lib/rankBuilder'
import { isBelowMidpoint } from '../../lib/reorder'
import { PositionTag } from '../players/PositionTag'

interface BuildWorkingListProps {
  order: string[]
  breakAfterIds: string[]
  insertAt: number | null
  playersById: Map<string, PoolPlayer>
  scope: string
  onRemove: (playerId: string) => void
  onReorder: (
    draggedId: string,
    hoveredId: string | null,
    insertAfter: boolean,
  ) => void
  onToggleTierBreak: (afterPlayerId: string) => void
  onSetInsertAt: (index: number | null) => void
}

/** The list you're building.
 *
 * Drag state uses the same two refs as the Edit view's table and for the same
 * reason: dragover can fire before React flushes the state update from
 * dragstart, so a handler reading state would see null and silently drop the
 * first reorder. The refs never hold the list itself -- only the dragged id
 * and a dedupe key -- so they can't go stale against it.
 */
export function BuildWorkingList({
  order,
  breakAfterIds,
  insertAt,
  playersById,
  scope,
  onRemove,
  onReorder,
  onToggleTierBreak,
  onSetInsertAt,
}: BuildWorkingListProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const draggedIdRef = useRef<string | null>(null)
  const lastHoverKeyRef = useRef<string | null>(null)
  const breaks = new Set(breakAfterIds)
  // Which tier each row lands in, so a divider can name the tier it opens.
  const tierNumbers = tiersForOrder(order, breakAfterIds).map(
    (tier) => tier ?? 1,
  )

  function startDrag(id: string) {
    setDraggedId(id)
    draggedIdRef.current = id
    lastHoverKeyRef.current = null
  }

  function endDrag() {
    setDraggedId(null)
    draggedIdRef.current = null
    lastHoverKeyRef.current = null
  }

  function handleDragOver(hoveredId: string | null, insertAfter: boolean) {
    const dragged = draggedIdRef.current
    if (dragged === null) return
    const key = `${hoveredId ?? ''}:${insertAfter}`
    if (lastHoverKeyRef.current === key) return
    lastHoverKeyRef.current = key
    onReorder(dragged, hoveredId, insertAfter)
  }

  function slotLabel(index: number) {
    return scope === 'overall' ? `${index + 1}` : `${scope}${index + 1}`
  }

  return (
    <div className="build-panel build-working">
      <div className="build-panel-head">
        My list ({order.length})
        {insertAt !== null && (
          <button
            type="button"
            className="build-insert-escape"
            onClick={() => onSetInsertAt(null)}
          >
            ↩ back to end
          </button>
        )}
      </div>

      {order.length === 0 ? (
        <p className="rankings-status">
          Nothing yet — pick from the candidates to start.
        </p>
      ) : (
        <ul className="build-working-list">
          {order.map((playerId, index) => {
            const player = playersById.get(playerId)
            return (
              <li key={playerId}>
                <button
                  type="button"
                  className={`build-insert-here${insertAt === index ? ' active' : ''}`}
                  onClick={() => onSetInsertAt(index)}
                  aria-label={`Insert at ${slotLabel(index)}`}
                >
                  + insert here
                </button>
                <div
                  className={`build-working-row${draggedId === playerId ? ' dragging' : ''}`}
                  draggable
                  onDragStart={() => startDrag(playerId)}
                  onDragEnd={endDrag}
                  onDragOver={(e) => {
                    e.preventDefault()
                    const rect = e.currentTarget.getBoundingClientRect()
                    handleDragOver(playerId, isBelowMidpoint(e.clientY, rect))
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    endDrag()
                  }}
                >
                  <span className="build-slot">{slotLabel(index)}</span>
                  {breakAfterIds.length > 0 && (
                    <span className="build-row-tier">
                      T{tierNumbers[index]}
                    </span>
                  )}
                  <PositionTag position={player?.position ?? null} />
                  <span className="player-name">
                    {player?.name ?? playerId}
                  </span>
                  <button
                    type="button"
                    className={`build-row-action build-break-toggle${
                      breaks.has(playerId) ? ' active' : ''
                    }`}
                    onClick={() => onToggleTierBreak(playerId)}
                    aria-label={`${breaks.has(playerId) ? 'Remove' : 'Add'} tier break after ${player?.name ?? playerId}`}
                    aria-pressed={breaks.has(playerId)}
                    title="Tier break after this player"
                  >
                    ⎯ tier
                  </button>
                  <button
                    type="button"
                    className="build-row-action"
                    onClick={() => onRemove(playerId)}
                    aria-label={`Remove ${player?.name ?? playerId}`}
                  >
                    ✕
                  </button>
                </div>
                {breaks.has(playerId) && (
                  <div className="build-tier-break">
                    <span>Tier {tierNumbers[index] + 1}</span>
                  </div>
                )}
              </li>
            )
          })}
          <li>
            <div
              className="build-end-zone"
              onDragOver={(e) => {
                e.preventDefault()
                handleDragOver(null, false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                endDrag()
              }}
            >
              Drop here to move to the end
            </div>
          </li>
        </ul>
      )}
    </div>
  )
}
