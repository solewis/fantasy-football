import { useEffect, useState } from 'react'

import {
  fetchDraftStatus,
  fetchQueue,
  makePick,
  saveQueue,
  undoLastPick,
  type DraftStatus,
  type QueueRow,
} from '../../api/draft'
import { DraftBoard } from './DraftBoard'
import { DraftPlayerPool } from './DraftPlayerPool'
import { DraftSetupForm } from './DraftSetupForm'
import { DraftSidePanel } from './DraftSidePanel'
import './draft.css'

const ACTIVE_DRAFT_KEY = 'fantasy-draft-app:activeDraftId'

export function DraftPage() {
  const [draftId, setDraftId] = useState<number | null>(() => {
    const stored = localStorage.getItem(ACTIVE_DRAFT_KEY)
    return stored ? Number(stored) : null
  })
  const [status, setStatus] = useState<DraftStatus | null>(null)
  const [queue, setQueue] = useState<QueueRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (draftId === null) return
    let cancelled = false

    Promise.all([fetchDraftStatus(draftId), fetchQueue(draftId)])
      .then(([statusResult, queueResult]) => {
        if (cancelled) return
        setStatus(statusResult)
        setQueue(queueResult)
        setError(null)
      })
      .catch(() => {
        if (cancelled) return
        // The stored draft id no longer resolves to anything real (e.g. it
        // was deleted) -- rather than stranding the user on a dead-end error
        // page with no way back, quietly fall back to the setup form.
        localStorage.removeItem(ACTIVE_DRAFT_KEY)
        setDraftId(null)
        setStatus(null)
        setQueue([])
      })

    return () => {
      cancelled = true
    }
  }, [draftId])

  function handleCreated(newStatus: DraftStatus) {
    localStorage.setItem(ACTIVE_DRAFT_KEY, String(newStatus.draft.id))
    setDraftId(newStatus.draft.id)
    setStatus(newStatus)
    setQueue([])
  }

  function handleNewDraft() {
    if (
      !window.confirm(
        'Start a new draft? Your current draft is kept, you just switch away from it.',
      )
    ) {
      return
    }
    localStorage.removeItem(ACTIVE_DRAFT_KEY)
    setDraftId(null)
    setStatus(null)
    setQueue([])
    setError(null)
  }

  async function refetchAll(id: number) {
    const [statusResult, queueResult] = await Promise.all([
      fetchDraftStatus(id),
      fetchQueue(id),
    ])
    setStatus(statusResult)
    setQueue(queueResult)
  }

  async function handleDraftPlayer(playerId: string) {
    if (draftId === null) return
    try {
      await makePick(draftId, playerId)
      await refetchAll(draftId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to make pick')
    }
  }

  async function handleUndo() {
    if (draftId === null) return
    try {
      await undoLastPick(draftId)
      await refetchAll(draftId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to undo pick')
    }
  }

  function handleAddToQueue(playerId: string) {
    if (draftId === null) return
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
    if (draftId === null) return
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
    if (draftId === null) return
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

  if (draftId === null) {
    return <DraftSetupForm onCreated={handleCreated} />
  }

  if (!status) {
    return <p className="draft-page-status">Loading draft…</p>
  }

  const draftedIds = new Set(
    status.picks.map((pick) => pick.platform_player_id),
  )
  const queuedIds = new Set(queue.map((row) => row.platform_player_id))
  const myPicks = status.picks.filter(
    (pick) => pick.slot === status.draft.my_slot,
  )

  return (
    <div className="draft-page">
      {error && <p className="draft-page-inline-error">{error}</p>}

      <div className="draft-page-header">
        <div className="draft-page-status-line">
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
          <button
            type="button"
            onClick={handleUndo}
            disabled={status.picks.length === 0}
          >
            Undo last pick
          </button>
          <button type="button" onClick={handleNewDraft}>
            New Draft
          </button>
        </div>
      </div>

      <DraftBoard status={status} />

      <div className="draft-page-lower">
        <DraftPlayerPool
          format={status.draft.format}
          draftedIds={draftedIds}
          queuedIds={queuedIds}
          onDraft={handleDraftPlayer}
          onQueue={handleAddToQueue}
        />
        <DraftSidePanel
          queue={queue}
          myPicks={myPicks}
          onReorderQueue={handleReorderQueue}
          onRemoveFromQueue={handleRemoveFromQueue}
          onDraftFromQueue={handleDraftPlayer}
        />
      </div>
    </div>
  )
}
