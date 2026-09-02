import { useRef, useState } from 'react'

import type { PoolPlayer } from '../../api/rankPool'
import {
  tiersForOrder,
  type BreakStrength,
  type PlayerFlag,
} from '../../lib/rankBuilder'
import { isBelowMidpoint } from '../../lib/reorder'
import { PositionTag } from '../players/PositionTag'

interface BuildWorkingListProps {
  order: string[]
  breaks: Record<string, BreakStrength>
  flags: Record<string, PlayerFlag>
  insertAt: number | null
  playersById: Map<string, PoolPlayer>
  scope: string
  onRemove: (playerId: string) => void
  onReorder: (
    draggedId: string,
    hoveredId: string | null,
    insertAfter: boolean,
  ) => void
  onSetTierBreak: (
    afterPlayerId: string,
    strength: BreakStrength | null,
  ) => void
  onSetFlag: (playerId: string, flag: PlayerFlag | null) => void
  onSetInsertAt: (index: number | null) => void
}

/** Clicking the break control walks none -> minor -> major -> none, so one
 * button covers both weights without a menu. */
const NEXT_BREAK: Record<string, BreakStrength | null> = {
  none: 'minor',
  minor: 'major',
  major: null,
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
  breaks,
  flags,
  insertAt,
  playersById,
  scope,
  onRemove,
  onReorder,
  onSetTierBreak,
  onSetFlag,
  onSetInsertAt,
}: BuildWorkingListProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const draggedIdRef = useRef<string | null>(null)
  const lastHoverKeyRef = useRef<string | null>(null)
  // Which tier each row lands in, so a divider can name the tier it opens.
  const tierNumbers = tiersForOrder(order, breaks).map((tier) => tier ?? 1)
  const hasBreaks = Object.keys(breaks).length > 0

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
                  className={`build-working-row${draggedId === playerId ? ' dragging' : ''}${
                    flags[playerId] ? ` flag-${flags[playerId]}` : ''
                  }`}
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
                  {hasBreaks && (
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
                    className={`build-row-action build-flag build-flag-target${
                      flags[playerId] === 'target' ? ' active' : ''
                    }`}
                    onClick={() =>
                      onSetFlag(
                        playerId,
                        flags[playerId] === 'target' ? null : 'target',
                      )
                    }
                    aria-pressed={flags[playerId] === 'target'}
                    aria-label={`${flags[playerId] === 'target' ? 'Clear target on' : 'Target'} ${player?.name ?? playerId}`}
                    title="Target — happy to reach for him"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className={`build-row-action build-flag build-flag-fade${
                      flags[playerId] === 'fade' ? ' active' : ''
                    }`}
                    onClick={() =>
                      onSetFlag(
                        playerId,
                        flags[playerId] === 'fade' ? null : 'fade',
                      )
                    }
                    aria-pressed={flags[playerId] === 'fade'}
                    aria-label={`${flags[playerId] === 'fade' ? 'Clear fade on' : 'Fade'} ${player?.name ?? playerId}`}
                    title="Fade — would rather not"
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className={`build-row-action build-break-toggle${
                      breaks[playerId] ? ` active ${breaks[playerId]}` : ''
                    }`}
                    onClick={() =>
                      onSetTierBreak(
                        playerId,
                        NEXT_BREAK[breaks[playerId] ?? 'none'],
                      )
                    }
                    aria-label={`Tier break after ${player?.name ?? playerId}: currently ${breaks[playerId] ?? 'none'}`}
                    title="Tier break after this player — click to cycle none / small / big"
                  >
                    {breaks[playerId] === 'major' ? '═' : '⌐'}
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
                {breaks[playerId] && (
                  <div className={`build-tier-break ${breaks[playerId]}`}>
                    <span>
                      Tier {tierNumbers[index] + 1}
                      {breaks[playerId] === 'major' && ' · big drop'}
                    </span>
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
