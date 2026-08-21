import { useState } from 'react'

import { createDraftFromLeague } from '../../api/draft'
import {
  deleteLeague,
  syncLeague,
  updateLeagueRankSet,
  type LeagueSummary,
} from '../../api/leagues'
import {
  draftSummaryFromStatus,
  type DraftSummary,
} from '../../lib/draftSummary'
import { FORMATS } from '../../lib/formats'
import { DraftRoom } from '../draft/DraftRoom'
import { RankSetPicker } from './RankSetPicker'
import './leagues.css'

interface LeagueDetailPageProps {
  league: LeagueSummary
  draft: DraftSummary | null
  onBack: () => void
  onLeagueUpdated: (updated: LeagueSummary) => void
  onLeagueDeleted: () => void
  onDraftChanged: () => void
}

export function LeagueDetailPage({
  league,
  draft: initialDraft,
  onBack,
  onLeagueUpdated,
  onLeagueDeleted,
  onDraftChanged,
}: LeagueDetailPageProps) {
  const [draft, setDraft] = useState<DraftSummary | null>(initialDraft)
  const [showDraft, setShowDraft] = useState(false)
  const [mySlot, setMySlot] = useState(1)
  const [creatingDraft, setCreatingDraft] = useState(false)
  const [confirmingStartOver, setConfirmingStartOver] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)

  const [syncing, setSyncing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slotOutOfRange = mySlot < 1 || mySlot > league.num_teams

  async function handleStartDraft() {
    if (slotOutOfRange) return
    setCreatingDraft(true)
    setDraftError(null)
    try {
      const status = await createDraftFromLeague({
        league_id: league.id,
        my_slot: mySlot,
      })
      setDraft(draftSummaryFromStatus(status))
      setShowDraft(true)
      setConfirmingStartOver(false)
      onDraftChanged()
    } catch (err) {
      setDraftError(
        err instanceof Error ? err.message : 'Failed to start draft',
      )
    } finally {
      setCreatingDraft(false)
    }
  }

  function handleDraftUnavailable() {
    setDraft(null)
    setShowDraft(false)
    onDraftChanged()
  }

  async function handleSync() {
    setSyncing(true)
    setError(null)
    try {
      const updated = await syncLeague(league.id)
      onLeagueUpdated(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync league')
    } finally {
      setSyncing(false)
    }
  }

  async function handleDelete() {
    setError(null)
    try {
      await deleteLeague(league.id)
      onLeagueDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete league')
      setConfirmingDelete(false)
    }
  }

  async function handleRankSetChange(rankSetId: number | null) {
    setError(null)
    try {
      const updated = await updateLeagueRankSet(league.id, rankSetId)
      onLeagueUpdated(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rank set')
    }
  }

  if (showDraft && draft) {
    return (
      <DraftRoom
        draftId={draft.id}
        headerActions={
          <button type="button" onClick={() => setShowDraft(false)}>
            ← {league.name}
          </button>
        }
        onUnavailable={handleDraftUnavailable}
      />
    )
  }

  return (
    <div className="leagues-page">
      <button type="button" className="league-detail-back" onClick={onBack}>
        ← Leagues
      </button>

      {error && <p className="leagues-error">{error}</p>}

      <div className="league-card">
        <div className="league-card-header">
          <strong>{league.name}</strong>
          <span className="league-card-meta">
            {FORMATS.find((f) => f.value === league.format)?.label ??
              league.format}{' '}
            · {league.num_teams} teams
          </span>
        </div>

        <label className="league-card-rankset">
          Rank set
          <RankSetPicker
            season={league.season}
            format={league.format}
            value={league.rank_set_id}
            onChange={handleRankSetChange}
          />
        </label>

        {Object.keys(league.team_names).length > 0 && (
          <div className="league-card-teams">
            {Object.entries(league.team_names).map(([rosterId, name]) => (
              <span key={rosterId} className="league-team-chip">
                {name}
              </span>
            ))}
          </div>
        )}

        <div className="league-card-actions">
          <button type="button" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync from Sleeper'}
          </button>
          {confirmingDelete ? (
            <>
              <button type="button" onClick={handleDelete}>
                {draft
                  ? 'Confirm delete? (also deletes its draft)'
                  : 'Confirm delete?'}
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmingDelete(true)}>
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="league-detail-draft">
        <h3>Draft</h3>
        {draft ? (
          <>
            <p>
              {draft.is_complete
                ? 'Draft complete'
                : `Round ${draft.current_round}, Pick ${draft.next_pick_number}`}
            </p>
            <div className="league-card-actions">
              <button type="button" onClick={() => setShowDraft(true)}>
                Resume
              </button>
              {confirmingStartOver ? (
                <>
                  <button
                    type="button"
                    onClick={handleStartDraft}
                    disabled={creatingDraft}
                  >
                    {creatingDraft ? 'Starting…' : 'Confirm start over?'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingStartOver(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingStartOver(true)}
                >
                  Start over
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <label>
              Your draft slot
              <input
                type="number"
                min={1}
                max={league.num_teams}
                value={mySlot}
                onChange={(e) => setMySlot(Number(e.target.value))}
              />
            </label>
            {slotOutOfRange && (
              <p className="leagues-error">
                Slot must be between 1 and {league.num_teams}.
              </p>
            )}
            <button
              type="button"
              onClick={handleStartDraft}
              disabled={creatingDraft || slotOutOfRange}
            >
              {creatingDraft ? 'Starting…' : 'Start Draft'}
            </button>
          </>
        )}
        {draftError && <p className="leagues-error">{draftError}</p>}
      </div>
    </div>
  )
}
