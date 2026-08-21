import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  ApiError,
  fetchDraftStatus,
  fetchQueue,
  makePick,
  saveQueue,
  switchToManual,
  syncSleeperDraft,
  undoLastPick,
  type DraftStatus,
  type QueueRow,
} from '../../api/draft'
import { DraftBoard } from './DraftBoard'
import { DraftPlayerPool } from './DraftPlayerPool'
import { DraftSidePanel } from './DraftSidePanel'
import './draft.css'

const SYNC_INTERVAL_MS = 5000

interface DraftRoomProps {
  draftId: number
  /** Rendered inside the existing .draft-page-header-actions slot, alongside
   * this room's own Switch-to-manual/Undo controls -- lets each caller supply
   * its own "leave" chrome (a confirm-gated "New Draft" for the ad-hoc path,
   * a plain "back to League" link for the nested path) without DraftRoom
   * needing to know which one it is. */
  headerActions?: ReactNode
  /** Called when the draft id genuinely no longer resolves to anything (a
   * 404 fetching status -- e.g. it was deleted). Deliberately NOT called for
   * other failures (a network/server hiccup mid-draft): treating those the
   * same as "gone" would tempt the caller into re-creating the draft. */
  onUnavailable: () => void
}

export function DraftRoom({
  draftId,
  headerActions,
  onUnavailable,
}: DraftRoomProps) {
  const [status, setStatus] = useState<DraftStatus | null>(null)
  const [queue, setQueue] = useState<QueueRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirmingSwitchToManual, setConfirmingSwitchToManual] =
    useState(false)

  // A plain "latest ref" so the initial-fetch effect below only needs to key
  // off draftId, not the caller's onUnavailable identity -- otherwise a
  // parent re-render that hands down a fresh inline callback would re-fetch
  // status/queue for no reason. Synced via its own effect (not written
  // during render) since refs shouldn't be mutated while rendering.
  const onUnavailableRef = useRef(onUnavailable)
  useEffect(() => {
    onUnavailableRef.current = onUnavailable
  }, [onUnavailable])

  useEffect(() => {
    let cancelled = false

    Promise.all([fetchDraftStatus(draftId), fetchQueue(draftId)])
      .then(([statusResult, queueResult]) => {
        if (cancelled) return
        setStatus(statusResult)
        setQueue(queueResult)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          onUnavailableRef.current()
          return
        }
        setError(err instanceof Error ? err.message : 'Failed to load draft')
      })

    return () => {
      cancelled = true
    }
  }, [draftId])

  useEffect(() => {
    if (status?.draft.platform !== 'sleeper' || status.is_complete) return

    const interval = setInterval(() => {
      Promise.all([syncSleeperDraft(draftId), fetchQueue(draftId)])
        .then(([statusResult, queueResult]) => {
          setStatus(statusResult)
          setQueue(queueResult)
          setError(null)
        })
        .catch((err: unknown) => {
          setError(
            err instanceof Error ? err.message : 'Failed to sync from Sleeper',
          )
        })
    }, SYNC_INTERVAL_MS)

    return () => {
      clearInterval(interval)
    }
  }, [draftId, status?.draft.platform, status?.is_complete])

  function handleSwitchToManual() {
    switchToManual(draftId)
      .then((s) => {
        setStatus(s)
        setConfirmingSwitchToManual(false)
      })
      .catch((err: unknown) =>
        setError(
          err instanceof Error ? err.message : 'Failed to switch to manual',
        ),
      )
  }

  async function refetchAll() {
    const [statusResult, queueResult] = await Promise.all([
      fetchDraftStatus(draftId),
      fetchQueue(draftId),
    ])
    setStatus(statusResult)
    setQueue(queueResult)
  }

  async function handleDraftPlayer(playerId: string) {
    try {
      await makePick(draftId, playerId)
      await refetchAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to make pick')
    }
  }

  async function handleUndo() {
    try {
      await undoLastPick(draftId)
      await refetchAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to undo pick')
    }
  }

  function handleAddToQueue(playerId: string) {
    if (queue.some((row) => row.platform_player_id === playerId)) return

    const nextIds = [...queue.map((row) => row.platform_player_id), playerId]
    saveQueue(draftId, nextIds)
      .then(() => fetchQueue(draftId))
      .then(setQueue)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to update queue'),
      )
  }

  function handleReorderQueue(next: QueueRow[]) {
    setQueue(next)
    saveQueue(
      draftId,
      next.map((row) => row.platform_player_id),
    ).catch(() => {
      fetchQueue(draftId)
        .then(setQueue)
        .catch(() => undefined)
    })
  }

  function handleRemoveFromQueue(playerId: string) {
    const next = queue.filter((row) => row.platform_player_id !== playerId)
    setQueue(next)
    saveQueue(
      draftId,
      next.map((row) => row.platform_player_id),
    ).catch(() => {
      fetchQueue(draftId)
        .then(setQueue)
        .catch(() => undefined)
    })
  }

  if (!status) {
    return (
      <div className="draft-page">
        <div className="draft-page-header">
          <p className="draft-page-status">{error ?? 'Loading draft…'}</p>
          {headerActions && (
            <div className="draft-page-header-actions">{headerActions}</div>
          )}
        </div>
      </div>
    )
  }

  const draftedIds = new Set(
    status.picks.map((pick) => pick.platform_player_id),
  )
  const queuedIds = new Set(queue.map((row) => row.platform_player_id))
  const myPicks = status.picks.filter(
    (pick) => pick.slot === status.draft.my_slot,
  )
  const isSleeperSynced = status.draft.platform === 'sleeper'

  return (
    <div className="draft-page">
      {error && <p className="draft-page-inline-error">{error}</p>}

      <div className="draft-page-header">
        <div className="draft-page-status-line">
          {isSleeperSynced && (
            <span className="draft-page-sleeper-badge">
              Synced from Sleeper
            </span>
          )}
          {status.is_complete ? (
            <strong>Draft complete</strong>
          ) : (
            <>
              <strong>
                Round {status.current_round}, Pick {status.next_pick_number}
              </strong>{' '}
              —{' '}
              {status.is_my_turn ? (
                <span className="draft-my-turn">Your pick!</span>
              ) : (
                `Team ${status.current_slot} is on the clock`
              )}
            </>
          )}
        </div>
        <div className="draft-page-header-actions">
          {isSleeperSynced ? (
            confirmingSwitchToManual ? (
              <>
                <button type="button" onClick={handleSwitchToManual}>
                  Confirm switch?
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingSwitchToManual(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingSwitchToManual(true)}
              >
                Switch to manual
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={handleUndo}
              disabled={status.picks.length === 0}
            >
              Undo last pick
            </button>
          )}
          {headerActions}
        </div>
      </div>

      <DraftBoard status={status} />

      <div className="draft-page-lower">
        <DraftPlayerPool
          format={status.draft.format}
          rankSetId={status.draft.rank_set_id}
          draftedIds={draftedIds}
          queuedIds={queuedIds}
          canDraft={!isSleeperSynced}
          onDraft={handleDraftPlayer}
          onQueue={handleAddToQueue}
        />
        <DraftSidePanel
          queue={queue}
          myPicks={myPicks}
          canDraft={!isSleeperSynced}
          rosterPositions={status.draft.roster_positions ?? undefined}
          onReorderQueue={handleReorderQueue}
          onRemoveFromQueue={handleRemoveFromQueue}
          onDraftFromQueue={handleDraftPlayer}
        />
      </div>
    </div>
  )
}
