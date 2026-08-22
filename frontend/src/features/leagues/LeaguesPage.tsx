import { useState } from 'react'

import {
  createLeague,
  lookupLeague,
  type LeagueLookup,
  type LeagueSummary,
} from '../../api/leagues'
import type { DraftSummary } from '../../lib/draftSummary'
import { FORMATS, SEASON } from '../../lib/formats'
import { platformDisplayName } from '../../lib/platforms'
import { RankSetPicker } from './RankSetPicker'
import './leagues.css'

type Platform = 'sleeper' | 'espn'

const PLATFORM_LABELS: Record<
  Platform,
  { idLabel: string; idPlaceholder: string }
> = {
  sleeper: {
    idLabel: 'Sleeper league ID',
    idPlaceholder: 'e.g. 1390886581291749376',
  },
  espn: {
    idLabel: 'ESPN league ID',
    idPlaceholder: 'e.g. 1963950844',
  },
}

interface LeaguesPageProps {
  leagues: LeagueSummary[]
  loading: boolean
  error: string | null
  draftsByLeague: Map<number, DraftSummary>
  onLeagueCreated: (created: LeagueSummary) => void
  onSelectLeague: (leagueId: number) => void
  onStartAdHoc: () => void
}

/** The Leagues list -- the app's home screen. Drilling into a league (its
 * rank set, team names, sync/delete, and its draft) lives on
 * LeagueDetailPage; this page only lists leagues and lets you add a new
 * one. A draft with no saved League still has a way in, via the de-emphasized
 * footer link -- kept secondary on purpose, since a saved League is now the
 * primary path into a draft. */
export function LeaguesPage({
  leagues,
  loading,
  error,
  draftsByLeague,
  onLeagueCreated,
  onSelectLeague,
  onStartAdHoc,
}: LeaguesPageProps) {
  const [adding, setAdding] = useState(false)
  const [platform, setPlatform] = useState<Platform>('sleeper')
  const [leagueIdInput, setLeagueIdInput] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookupResult, setLookupResult] = useState<LeagueLookup | null>(null)
  const [confirmFormat, setConfirmFormat] = useState('half_ppr')
  const [confirmRankSetId, setConfirmRankSetId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  function startAdd() {
    setAdding(true)
    setPlatform('sleeper')
    setLeagueIdInput('')
    setLookupResult(null)
    setLookupError(null)
    setConfirmFormat('half_ppr')
    setConfirmRankSetId(null)
  }

  function cancelAdd() {
    setAdding(false)
    setLookupResult(null)
  }

  async function handleLookup() {
    if (leagueIdInput.trim() === '') return
    setLookingUp(true)
    setLookupError(null)
    try {
      const result = await lookupLeague(platform, leagueIdInput.trim())
      setLookupResult(result)
      setConfirmFormat(result.suggested_format ?? 'half_ppr')
      setConfirmRankSetId(null)
    } catch (err) {
      setLookupError(
        err instanceof Error ? err.message : 'Failed to look up league',
      )
    } finally {
      setLookingUp(false)
    }
  }

  async function handleCreate() {
    setCreating(true)
    setCreateError(null)
    try {
      const created = await createLeague({
        platform,
        platform_league_id: leagueIdInput.trim(),
        format: confirmFormat,
        rank_set_id: confirmRankSetId,
      })
      onLeagueCreated(created)
      setAdding(false)
      setLookupResult(null)
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : 'Failed to create league',
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="leagues-page">
      {error && <p className="leagues-error">{error}</p>}
      {createError && <p className="leagues-error">{createError}</p>}

      {!adding && (
        <div className="leagues-toolbar">
          <button type="button" onClick={startAdd}>
            + Add League
          </button>
        </div>
      )}

      {adding && (
        <div className="league-add-form">
          <div
            className="league-add-platform-tabs"
            role="tablist"
            aria-label="League platform"
          >
            {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={platform === p}
                className={`league-add-platform-tab${platform === p ? ' active' : ''}`}
                onClick={() => setPlatform(p)}
              >
                {platformDisplayName(p)}
              </button>
            ))}
          </div>
          <label>
            {PLATFORM_LABELS[platform].idLabel}
            <input
              value={leagueIdInput}
              onChange={(e) => setLeagueIdInput(e.target.value)}
              placeholder={PLATFORM_LABELS[platform].idPlaceholder}
            />
          </label>
          <button
            type="button"
            onClick={handleLookup}
            disabled={lookingUp || leagueIdInput.trim() === ''}
          >
            {lookingUp ? 'Looking up…' : 'Look Up'}
          </button>
          <button type="button" onClick={cancelAdd}>
            Cancel
          </button>
          {lookupError && <p className="leagues-error">{lookupError}</p>}

          {lookupResult && (
            <div className="league-confirm">
              <p>
                <strong>{lookupResult.name}</strong> — {lookupResult.num_teams}{' '}
                teams
              </p>
              <label>
                Scoring format
                <select
                  value={confirmFormat}
                  onChange={(e) => setConfirmFormat(e.target.value)}
                >
                  {FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Rank set
                <RankSetPicker
                  season={SEASON}
                  format={confirmFormat}
                  platform={platform}
                  value={confirmRankSetId}
                  onChange={setConfirmRankSetId}
                />
              </label>
              <button type="button" onClick={handleCreate} disabled={creating}>
                {creating ? 'Adding…' : 'Add League'}
              </button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p className="leagues-status">Loading…</p>
      ) : leagues.length === 0 ? (
        <p className="leagues-status">
          No leagues yet — add one to get started.
        </p>
      ) : (
        <ul className="leagues-list">
          {leagues.map((l) => {
            const draft = draftsByLeague.get(l.id)
            return (
              <li key={l.id}>
                <button
                  type="button"
                  className="league-card league-card-button"
                  onClick={() => onSelectLeague(l.id)}
                >
                  <div className="league-card-header">
                    <strong>{l.name}</strong>
                    <span className="league-card-meta">
                      {FORMATS.find((f) => f.value === l.format)?.label ??
                        l.format}{' '}
                      · {l.num_teams} teams
                    </span>
                  </div>
                  {draft && (
                    <span className="league-card-draft-badge">
                      {draft.is_complete
                        ? 'Draft complete'
                        : draft.pick_count > 0
                          ? `Draft in progress · Round ${draft.current_round}, Pick ${draft.next_pick_number}`
                          : 'Ready to draft'}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <p className="leagues-adhoc-link">
        <button type="button" onClick={onStartAdHoc}>
          Start a draft without a league →
        </button>
      </p>
    </div>
  )
}
