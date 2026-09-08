import { useEffect, useState } from 'react'

import {
  deleteExposure,
  fetchExposures,
  setExposure,
  type ExposureRow,
} from '../../api/exposure'
import { fetchPlayers, type PlayerRow } from '../../api/players'
import {
  PlatformTabs,
  type SupportedPlatform,
} from '../../components/PlatformTabs'
import { SEASON } from '../../lib/formats'
import { PositionTag } from '../players/PositionTag'
import '../players/players.css'
import './exposure.css'

// Candidates are searched against a fixed format rather than exposing a
// format picker on this page -- exposure is season-scoped, not
// format-scoped (a share is a roster spot, not a scoring rule), but the
// underlying player search only has players with a real ADP entry for
// *some* format to search against. half_ppr covers every skill-position
// player who'd realistically be tracked here.
const SEARCH_FORMAT = 'half_ppr'

/** How many shares of each player you have, across however many leagues and
 * drafts -- manually entered for now, not derived from actual League
 * rosters. One count per player per season; adding a player you already
 * track edits their row instead of creating a second one.
 */
export function ExposurePage() {
  const [platform, setPlatform] = useState<SupportedPlatform>('sleeper')
  const [exposures, setExposures] = useState<ExposureRow[]>([])
  const [allPlayers, setAllPlayers] = useState<PlayerRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Per-row in-progress edit text, keyed by exposure id -- lets the input
  // hold whatever's being typed (including a momentarily invalid value)
  // without touching saved state until it's actually committed.
  const [draftShares, setDraftShares] = useState<Record<number, string>>({})

  function selectPlatform(next: SupportedPlatform) {
    setLoading(true)
    setPlatform(next)
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchExposures({ platform, season: SEASON }),
      fetchPlayers({ platform, season: SEASON, format: SEARCH_FORMAT }),
    ])
      .then(([exposureRows, playerRows]) => {
        if (cancelled) return
        setExposures(exposureRows)
        setAllPlayers(playerRows)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [platform])

  const trackedIds = new Set(exposures.map((e) => e.platform_player_id))
  const searchTerm = search.trim().toLowerCase()
  const candidates = searchTerm
    ? allPlayers
        .filter(
          (p) =>
            !trackedIds.has(p.platform_player_id) &&
            p.name.toLowerCase().includes(searchTerm),
        )
        .slice(0, 8)
    : []

  async function addPlayer(player: PlayerRow) {
    try {
      const created = await setExposure({
        platform,
        season: SEASON,
        platform_player_id: player.platform_player_id,
        shares: 1,
      })
      setExposures((rows) =>
        [...rows, created].sort(
          (a, b) => b.shares - a.shares || a.name.localeCompare(b.name),
        ),
      )
      setSearch('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add player')
    }
  }

  async function commitShares(row: ExposureRow) {
    const raw = draftShares[row.id]
    if (raw === undefined) return
    const parsed = Number(raw)
    // An invalid or non-positive entry just reverts -- silently, since it's
    // almost always a stray keystroke rather than something worth an error
    // message for a single-user manual-entry field.
    if (!Number.isInteger(parsed) || parsed < 1) {
      setDraftShares(({ [row.id]: _discard, ...rest }) => rest)
      return
    }
    setDraftShares(({ [row.id]: _discard, ...rest }) => rest)
    if (parsed === row.shares) return
    try {
      const updated = await setExposure({
        platform,
        season: SEASON,
        platform_player_id: row.platform_player_id,
        shares: parsed,
      })
      setExposures((rows) =>
        rows
          .map((r) => (r.id === row.id ? updated : r))
          .sort((a, b) => b.shares - a.shares || a.name.localeCompare(b.name)),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update shares')
    }
  }

  async function removePlayer(row: ExposureRow) {
    try {
      await deleteExposure(row.id)
      setExposures((rows) => rows.filter((r) => r.id !== row.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove player')
    }
  }

  return (
    <div className="exposure-page">
      <div className="exposure-toolbar">
        <PlatformTabs value={platform} onChange={selectPlatform} />
        <div className="exposure-search-wrap">
          <input
            className="exposure-search"
            type="text"
            placeholder="Add a player…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Add a player"
          />
          {candidates.length > 0 && (
            <ul className="exposure-candidates">
              {candidates.map((player) => (
                <li key={player.platform_player_id}>
                  <button type="button" onClick={() => addPlayer(player)}>
                    <PositionTag position={player.position} />
                    <span className="player-name">{player.name}</span>
                    <span className="exposure-team">{player.team ?? '—'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searchTerm && candidates.length === 0 && (
            <p className="exposure-no-candidates">
              No unadded player matching "{search.trim()}".
            </p>
          )}
        </div>
      </div>

      {error && <p className="exposure-error">{error}</p>}

      {loading && exposures.length === 0 ? (
        <p className="exposure-status">Loading…</p>
      ) : exposures.length === 0 ? (
        <p className="exposure-status">
          You haven't tracked any exposure yet -- search above to add a player.
        </p>
      ) : (
        <table className="exposure-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Team</th>
              <th>Shares</th>
              <th aria-hidden="true"></th>
            </tr>
          </thead>
          <tbody>
            {exposures.map((row) => (
              <tr key={row.id}>
                <td>
                  <PositionTag position={row.position} />
                  <span className="player-name">{row.name}</span>
                </td>
                <td>{row.team ?? '—'}</td>
                <td>
                  <input
                    className="exposure-shares-input"
                    type="number"
                    min={1}
                    inputMode="numeric"
                    aria-label={`Shares of ${row.name}`}
                    value={draftShares[row.id] ?? String(row.shares)}
                    onChange={(e) =>
                      setDraftShares((prev) => ({
                        ...prev,
                        [row.id]: e.target.value,
                      }))
                    }
                    onBlur={() => commitShares(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                  />
                </td>
                <td>
                  <button type="button" onClick={() => removePlayer(row)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
