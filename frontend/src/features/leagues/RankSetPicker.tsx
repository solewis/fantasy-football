import { useEffect, useState } from 'react'

import {
  createRankSet,
  fetchRankSets,
  type RankSetSummary,
} from '../../api/ranks'
import { FORMATS } from '../../lib/formats'
import './leagues.css'

interface RankSetPickerProps {
  season: string
  format: string
  value: number | null
  onChange: (rankSetId: number | null) => void
}

/** Select an existing rank set for this format, or create a new one (seeded
 * from ADP) inline. Deliberately separate from RankingsPage's own toolbar --
 * that page also needs rename/delete, which this picker doesn't. */
export function RankSetPicker({
  season,
  format,
  value,
  onChange,
}: RankSetPickerProps) {
  const [rankSets, setRankSets] = useState<RankSetSummary[]>([])
  const [creatingName, setCreatingName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    fetchRankSets({ season, format })
      .then((sets) => {
        if (cancelled) return
        setRankSets(sets)
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'Failed to load rank sets',
          )
      })

    return () => {
      cancelled = true
    }
  }, [season, format])

  async function confirmCreate() {
    if (!creatingName || creatingName.trim() === '') return
    setError(null)
    try {
      const created = await createRankSet({
        name: creatingName,
        season,
        format,
        seed_from_adp: true,
      })
      setRankSets((prev) => [...prev, created])
      onChange(created.id)
      setCreatingName(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rank set')
    }
  }

  if (creatingName !== null) {
    return (
      <span className="rank-set-picker">
        <input
          className="rank-set-picker-input"
          value={creatingName}
          onChange={(e) => setCreatingName(e.target.value)}
          aria-label="New rank set name"
          autoFocus
        />
        <button type="button" onClick={confirmCreate}>
          Create
        </button>
        <button type="button" onClick={() => setCreatingName(null)}>
          Cancel
        </button>
        {error && <span className="leagues-error">{error}</span>}
      </span>
    )
  }

  return (
    <span className="rank-set-picker">
      <select
        value={value ?? ''}
        onChange={(e) =>
          onChange(e.target.value === '' ? null : Number(e.target.value))
        }
        aria-label="Rank set"
      >
        <option value="">No rank set</option>
        {rankSets.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.player_count})
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          const formatLabel =
            FORMATS.find((f) => f.value === format)?.label ?? format
          setCreatingName(`${formatLabel} Ranks`)
        }}
      >
        + New Rank Set
      </button>
      {error && <span className="leagues-error">{error}</span>}
    </span>
  )
}
