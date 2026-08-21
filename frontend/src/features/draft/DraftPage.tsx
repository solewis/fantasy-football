import { useState } from 'react'

import type { DraftStatus } from '../../api/draft'
import { DraftRoom } from './DraftRoom'
import { DraftSetupForm } from './DraftSetupForm'
import './draft.css'

const ACTIVE_DRAFT_KEY = 'fantasy-draft-app:activeDraftId'

/** The ad-hoc draft entry point (manual entry / raw Sleeper draft ID) --
 * reachable as a secondary path off the Leagues page, not a top-level tab.
 * Tracks "the" active ad-hoc draft via a single localStorage slot, same as
 * before Draft nested under League -- there's still only ever one ad-hoc
 * draft in flight at a time, unlike leagues' drafts (each league's current
 * draft is discoverable via GET /drafts?league_id=, no client-side pointer
 * needed there).
 */
export function DraftPage() {
  const [draftId, setDraftId] = useState<number | null>(() => {
    const stored = localStorage.getItem(ACTIVE_DRAFT_KEY)
    return stored ? Number(stored) : null
  })
  const [confirmingNewDraft, setConfirmingNewDraft] = useState(false)

  function handleCreated(newStatus: DraftStatus) {
    localStorage.setItem(ACTIVE_DRAFT_KEY, String(newStatus.draft.id))
    setDraftId(newStatus.draft.id)
  }

  function handleUnavailable() {
    localStorage.removeItem(ACTIVE_DRAFT_KEY)
    setDraftId(null)
  }

  function handleNewDraft() {
    localStorage.removeItem(ACTIVE_DRAFT_KEY)
    setDraftId(null)
    setConfirmingNewDraft(false)
  }

  if (draftId === null) {
    return <DraftSetupForm onCreated={handleCreated} />
  }

  const newDraftControl = confirmingNewDraft ? (
    <>
      <button type="button" onClick={handleNewDraft}>
        Confirm new draft?
      </button>
      <button type="button" onClick={() => setConfirmingNewDraft(false)}>
        Cancel
      </button>
    </>
  ) : (
    <button type="button" onClick={() => setConfirmingNewDraft(true)}>
      New Draft
    </button>
  )

  return (
    <DraftRoom
      draftId={draftId}
      headerActions={newDraftControl}
      onUnavailable={handleUnavailable}
    />
  )
}
