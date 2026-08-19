import { useEffect, useState } from 'react'

import { fetchPlayers, type PlayerRow } from '../../api/players'
import { PositionTag } from './PositionTag'
import './players.css'

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
type PositionFilter = (typeof POSITIONS)[number]

const FORMATS = [
  { value: 'std', label: 'Standard' },
  { value: 'ppr', label: 'PPR' },
  { value: 'half_ppr', label: 'Half PPR' },
  { value: '2qb', label: '2QB / Superflex' },
  { value: 'dynasty_std', label: 'Dynasty (Std)' },
  { value: 'dynasty_ppr', label: 'Dynasty (PPR)' },
  { value: 'dynasty_half_ppr', label: 'Dynasty (Half PPR)' },
] as const

const SEASON = '2026'
const SEARCH_DEBOUNCE_MS = 300

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}

export function PlayersPage() {
  const [position, setPosition] = useState<PositionFilter>('ALL')
  const [format, setFormat] = useState<string>('half_ppr')
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS)

  const [players, setPlayers] = useState<PlayerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function selectPosition(next: PositionFilter) {
    setLoading(true)
    setPosition(next)
  }

  function selectFormat(next: string) {
    setLoading(true)
    setFormat(next)
  }

  function updateSearchInput(next: string) {
    setLoading(true)
    setSearchInput(next)
  }

  useEffect(() => {
    let cancelled = false

    fetchPlayers({
      season: SEASON,
      format,
      position: position === 'ALL' ? undefined : position,
      search: search || undefined,
    })
      .then((rows) => {
        if (cancelled) return
        setPlayers(rows)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load players')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [position, format, search])

  return (
    <div className="players-page">
      <div className="players-toolbar">
        <input
          className="players-search"
          type="text"
          placeholder="Find player"
          value={searchInput}
          onChange={(e) => updateSearchInput(e.target.value)}
        />
        <select
          className="players-format"
          value={format}
          onChange={(e) => selectFormat(e.target.value)}
          aria-label="Scoring format"
        >
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <div
        className="position-tabs"
        role="tablist"
        aria-label="Filter by position"
      >
        {POSITIONS.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={position === p}
            className={`position-tab${position === p ? ' active' : ''}`}
            onClick={() => selectPosition(p)}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="players-table-wrapper">
        {loading && players.length === 0 ? (
          <p className="players-status">Loading players…</p>
        ) : error ? (
          <p className="players-error">{error}</p>
        ) : players.length === 0 ? (
          <p className="players-status">No players found.</p>
        ) : (
          <table className="players-table">
            <thead>
              <tr>
                <th>Rk</th>
                <th>ADP</th>
                <th>Name</th>
                <th>Team</th>
              </tr>
            </thead>
            <tbody>
              {players.map((row) => (
                <tr key={row.platform_player_id}>
                  <td>{row.rank}</td>
                  <td>{row.adp.toFixed(1)}</td>
                  <td>
                    <PositionTag position={row.position} />
                    <span className="player-name">{row.name}</span>
                  </td>
                  <td>{row.team ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
