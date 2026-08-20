import { useEffect, useState } from 'react'

import {
  createLeague,
  deleteLeague,
  fetchLeagues,
  lookupSleeperLeague,
  syncLeague,
  updateLeagueRankSet,
  type LeagueLookup,
  type LeagueSummary,
} from '../../api/leagues'
import { FORMATS, SEASON } from '../../lib/formats'
import { RankSetPicker } from './RankSetPicker'
import './leagues.css'

export function LeaguesPage() {
  const [leagues, setLeagues] = useState<LeagueSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [adding, setAdding] = useState(false)
  const [leagueIdInput, setLeagueIdInput] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookupResult, setLookupResult] = useState<LeagueLookup | null>(null)
  const [confirmFormat, setConfirmFormat] = useState('half_ppr')
  const [confirmRankSetId, setConfirmRankSetId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(
    null,
  )

  useEffect(() => {
    fetchLeagues()
      .then(setLeagues)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load leagues'),
      )
      .finally(() => setLoading(false))
  }, [])

  function startAdd() {
    setAdding(true)
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
      const result = await lookupSleeperLeague(leagueIdInput.trim())
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
    setError(null)
    try {
      const created = await createLeague({
        platform_league_id: leagueIdInput.trim(),
        format: confirmFormat,
        rank_set_id: confirmRankSetId,
      })
      setLeagues((prev) => [...prev, created])
      setAdding(false)
      setLookupResult(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create league')
    } finally {
      setCreating(false)
    }
  }

  async function handleSync(leagueId: number) {
    setSyncingId(leagueId)
    setError(null)
    try {
      const updated = await syncLeague(leagueId)
      setLeagues((prev) => prev.map((l) => (l.id === leagueId ? updated : l)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync league')
    } finally {
      setSyncingId(null)
    }
  }

  async function handleDelete(leagueId: number) {
    setError(null)
    try {
      await deleteLeague(leagueId)
      setLeagues((prev) => prev.filter((l) => l.id !== leagueId))
      setConfirmingDeleteId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete league')
    }
  }

  async function handleRankSetChange(
    leagueId: number,
    rankSetId: number | null,
  ) {
    setError(null)
    try {
      const updated = await updateLeagueRankSet(leagueId, rankSetId)
      setLeagues((prev) => prev.map((l) => (l.id === leagueId ? updated : l)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rank set')
    }
  }

  return (
    <div className="leagues-page">
      {error && <p className="leagues-error">{error}</p>}

      {!adding && (
        <div className="leagues-toolbar">
          <button type="button" onClick={startAdd}>
            + Add League
          </button>
        </div>
      )}

      {adding && (
        <div className="league-add-form">
          <label>
            Sleeper league ID
            <input
              value={leagueIdInput}
              onChange={(e) => setLeagueIdInput(e.target.value)}
              placeholder="e.g. 1390886581291749376"
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
          {leagues.map((l) => (
            <li key={l.id} className="league-card">
              <div className="league-card-header">
                <strong>{l.name}</strong>
                <span className="league-card-meta">
                  {FORMATS.find((f) => f.value === l.format)?.label ?? l.format}{' '}
                  · {l.num_teams} teams
                </span>
              </div>

              <label className="league-card-rankset">
                Rank set
                <RankSetPicker
                  season={l.season}
                  format={l.format}
                  value={l.rank_set_id}
                  onChange={(id) => handleRankSetChange(l.id, id)}
                />
              </label>

              {Object.keys(l.team_names).length > 0 && (
                <div className="league-card-teams">
                  {Object.entries(l.team_names).map(([rosterId, name]) => (
                    <span key={rosterId} className="league-team-chip">
                      {name}
                    </span>
                  ))}
                </div>
              )}

              <div className="league-card-actions">
                <button
                  type="button"
                  onClick={() => handleSync(l.id)}
                  disabled={syncingId === l.id}
                >
                  {syncingId === l.id ? 'Syncing…' : 'Sync from Sleeper'}
                </button>
                {confirmingDeleteId === l.id ? (
                  <>
                    <button type="button" onClick={() => handleDelete(l.id)}>
                      Confirm delete?
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteId(l.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
