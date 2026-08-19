import { useState } from 'react'

import { createDraft, type DraftStatus } from '../../api/draft'
import { FORMATS, SEASON } from '../../lib/formats'
import './draft.css'

interface DraftSetupFormProps {
  onCreated: (status: DraftStatus) => void
}

export function DraftSetupForm({ onCreated }: DraftSetupFormProps) {
  const [numTeams, setNumTeams] = useState(10)
  const [numRounds, setNumRounds] = useState(14)
  const [mySlot, setMySlot] = useState(1)
  const [format, setFormat] = useState('half_ppr')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slotOutOfRange = mySlot < 1 || mySlot > numTeams

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (slotOutOfRange) return

    setCreating(true)
    setError(null)
    try {
      const status = await createDraft({
        season: SEASON,
        format,
        num_teams: numTeams,
        num_rounds: numRounds,
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

      <label>
        Your draft slot
        <input
          type="number"
          min={1}
          max={numTeams}
          value={mySlot}
          onChange={(e) => setMySlot(Number(e.target.value))}
        />
      </label>
      {slotOutOfRange && (
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

      <button type="submit" disabled={creating || slotOutOfRange}>
        {creating ? 'Starting…' : 'Start Draft'}
      </button>
    </form>
  )
}
