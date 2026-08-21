import { useEffect, useState } from 'react'

import {
  createDraft,
  createDraftFromLeague,
  createSleeperDraft,
  type DraftStatus,
} from '../../api/draft'
import { fetchLeagues, type LeagueSummary } from '../../api/leagues'
import { FORMATS, SEASON } from '../../lib/formats'
import './draft.css'

interface DraftSetupFormProps {
  onCreated: (status: DraftStatus) => void
}

type Mode = 'manual' | 'sleeper' | 'league'

export function DraftSetupForm({ onCreated }: DraftSetupFormProps) {
  const [mode, setMode] = useState<Mode>('manual')
  const [numTeams, setNumTeams] = useState(10)
  const [numRounds, setNumRounds] = useState(14)
  const [mySlot, setMySlot] = useState(1)
  const [format, setFormat] = useState('half_ppr')
  const [sleeperDraftId, setSleeperDraftId] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [leagues, setLeagues] = useState<LeagueSummary[]>([])
  const [leaguesError, setLeaguesError] = useState<string | null>(null)
  const [selectedLeagueId, setSelectedLeagueId] = useState<number | null>(null)

  useEffect(() => {
    fetchLeagues()
      .then((rows) => {
        setLeagues(rows)
        setSelectedLeagueId((current) => current ?? rows[0]?.id ?? null)
      })
      .catch((err: unknown) =>
        setLeaguesError(
          err instanceof Error ? err.message : 'Failed to load leagues',
        ),
      )
  }, [])

  const selectedLeague = leagues.find((l) => l.id === selectedLeagueId) ?? null

  const slotOutOfRange =
    mySlot < 1 ||
    (mode === 'manual' && mySlot > numTeams) ||
    (mode === 'league' && !!selectedLeague && mySlot > selectedLeague.num_teams)
  const sleeperIdMissing = mode === 'sleeper' && sleeperDraftId.trim() === ''
  const leagueMissing = mode === 'league' && selectedLeagueId === null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (slotOutOfRange || sleeperIdMissing || leagueMissing) return

    setCreating(true)
    setError(null)
    try {
      const status =
        mode === 'manual'
          ? await createDraft({
              season: SEASON,
              format,
              num_teams: numTeams,
              num_rounds: numRounds,
              my_slot: mySlot,
            })
          : mode === 'sleeper'
            ? await createSleeperDraft({
                platform_draft_id: sleeperDraftId.trim(),
                format,
                my_slot: mySlot,
              })
            : await createDraftFromLeague({
                league_id: selectedLeagueId as number,
                my_slot: mySlot,
              })
      onCreated(status)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create draft')
    } finally {
      setCreating(false)
    }
  }

  return (
    <form className="draft-setup-form" onSubmit={handleSubmit}>
      <h2>New draft</h2>

      <div
        className="draft-setup-mode-tabs"
        role="tablist"
        aria-label="Draft setup mode"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'manual'}
          className={`draft-setup-mode-tab${mode === 'manual' ? ' active' : ''}`}
          onClick={() => setMode('manual')}
        >
          Manual entry
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'sleeper'}
          className={`draft-setup-mode-tab${mode === 'sleeper' ? ' active' : ''}`}
          onClick={() => setMode('sleeper')}
        >
          Sync from Sleeper
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'league'}
          className={`draft-setup-mode-tab${mode === 'league' ? ' active' : ''}`}
          onClick={() => setMode('league')}
        >
          From a League
        </button>
      </div>

      {mode === 'sleeper' ? (
        <label>
          Sleeper draft ID
          <input
            type="text"
            value={sleeperDraftId}
            onChange={(e) => setSleeperDraftId(e.target.value)}
            placeholder="e.g. 1124821633228341249"
          />
        </label>
      ) : mode === 'league' ? (
        <>
          {leaguesError && <p className="draft-setup-error">{leaguesError}</p>}
          {leagues.length === 0 && !leaguesError ? (
            <p className="draft-setup-error">
              No leagues yet — add one from the Leagues tab first.
            </p>
          ) : (
            <label>
              League
              <select
                value={selectedLeagueId ?? ''}
                onChange={(e) => setSelectedLeagueId(Number(e.target.value))}
              >
                {leagues.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} (
                    {FORMATS.find((f) => f.value === l.format)?.label ??
                      l.format}
                    , {l.num_teams} teams)
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      ) : (
        <>
          <label>
            Number of teams
            <input
              type="number"
              min={2}
              max={32}
              value={numTeams}
              onChange={(e) => setNumTeams(Number(e.target.value))}
            />
          </label>

          <label>
            Number of rounds
            <input
              type="number"
              min={1}
              max={40}
              value={numRounds}
              onChange={(e) => setNumRounds(Number(e.target.value))}
            />
          </label>
        </>
      )}

      <label>
        Your draft slot
        <input
          type="number"
          min={1}
          max={
            mode === 'manual'
              ? numTeams
              : mode === 'league'
                ? selectedLeague?.num_teams
                : undefined
          }
          value={mySlot}
          onChange={(e) => setMySlot(Number(e.target.value))}
        />
      </label>
      {slotOutOfRange &&
        (mode === 'manual' || (mode === 'league' && selectedLeague)) && (
          <p className="draft-setup-error">
            Slot must be between 1 and{' '}
            {mode === 'manual' ? numTeams : selectedLeague?.num_teams}.
          </p>
        )}

      {mode !== 'league' && (
        <label>
          Scoring format
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            {FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && <p className="draft-setup-error">{error}</p>}

      <button
        type="submit"
        disabled={
          creating || slotOutOfRange || sleeperIdMissing || leagueMissing
        }
      >
        {creating ? 'Starting…' : 'Start Draft'}
      </button>
    </form>
  )
}
