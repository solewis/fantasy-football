import { useEffect, useState } from 'react'

import { fetchPlayers, type PlayerRow } from '../../api/players'
import { PositionTag } from './PositionTag'
import { SyncPanel } from './SyncPanel'
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

export function PlayersPage() {
  const [position, setPosition] = useState<PositionFilter>('ALL')
  const [format, setFormat] = useState<string>('half_ppr')
  const [search, setSearch] = useState('')

  // Fetched once per format -- position/search are filtered client-side below,
  // since the backend already returns the full unpaginated set for a format
  // and re-hitting the network on every keystroke/tab click has no benefit.
  const [allPlayers, setAllPlayers] = useState<PlayerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)

  function selectFormat(next: string) {
    setLoading(true)
    setFormat(next)
  }

  useEffect(() => {
    let cancelled = false

    fetchPlayers({ season: SEASON, format })
      .then((rows) => {
        if (cancelled) return
        setAllPlayers(rows)
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
  }, [format, refreshNonce])

  const searchTerm = search.trim().toLowerCase()
  const players = allPlayers.filter((row) => {
    if (position !== 'ALL' && row.position !== position) return false
    if (searchTerm && !row.name.toLowerCase().includes(searchTerm)) return false
    return true
  })

  return (
    <div className="players-page">
      <SyncPanel
        season={SEASON}
        onSyncComplete={() => setRefreshNonce((n) => n + 1)}
      />

      <div className="players-toolbar">
        <input
          className="players-search"
          type="text"
          placeholder="Find player"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
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
            onClick={() => setPosition(p)}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="players-table-wrapper">
        {loading && allPlayers.length === 0 ? (
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
