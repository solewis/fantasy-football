import { useState } from 'react'

import {
  createDraft,
  createSleeperDraft,
  type DraftStatus,
} from '../../api/draft'
import { FORMATS, SEASON } from '../../lib/formats'
import './draft.css'

interface DraftSetupFormProps {
  onCreated: (status: DraftStatus) => void
}

type Mode = 'manual' | 'sleeper'

export function DraftSetupForm({ onCreated }: DraftSetupFormProps) {
  const [mode, setMode] = useState<Mode>('manual')
  const [numTeams, setNumTeams] = useState(10)
  const [numRounds, setNumRounds] = useState(14)
  const [mySlot, setMySlot] = useState(1)
  const [format, setFormat] = useState('half_ppr')
  const [sleeperDraftId, setSleeperDraftId] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slotOutOfRange = mySlot < 1 || (mode === 'manual' && mySlot > numTeams)
  const sleeperIdMissing = mode === 'sleeper' && sleeperDraftId.trim() === ''

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (slotOutOfRange || sleeperIdMissing) return

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
          : await createSleeperDraft({
              platform_draft_id: sleeperDraftId.trim(),
              format,
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
          max={mode === 'manual' ? numTeams : undefined}
          value={mySlot}
          onChange={(e) => setMySlot(Number(e.target.value))}
        />
      </label>
      {mode === 'manual' && slotOutOfRange && (
        <p className="draft-setup-error">
          Slot must be between 1 and {numTeams}.
        </p>
      )}

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

      {error && <p className="draft-setup-error">{error}</p>}

      <button
        type="submit"
        disabled={creating || slotOutOfRange || sleeperIdMissing}
      >
        {creating ? 'Starting…' : 'Start Draft'}
      </button>
    </form>
  )
}
