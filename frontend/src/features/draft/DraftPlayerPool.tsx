import { useEffect, useState } from 'react'

import {
  fetchRankedOrAdpFallback,
  type PoolRow,
} from '../../lib/fetchRankedPlayers'
import { POSITIONS, SEASON, type PositionFilter } from '../../lib/formats'
import { PositionTag } from '../players/PositionTag'
import '../players/players.css'
import './draft.css'

interface DraftPlayerPoolProps {
  format: string
  /** The draft's own platform (already resolved from "manual" to a real
   * platform by the caller -- see DraftRoom), used to fetch the right
   * player/ADP pool. */
  platform: string
  /** The League's assigned rank set, if this draft was created from one.
   * When set, reads that exact rank set instead of the format-based
   * "whichever set was created first" resolver. */
  rankSetId?: number | null
  draftedIds: Set<string>
  queuedIds: Set<string>
  canDraft: boolean
  onDraft: (playerId: string) => void
  onQueue: (playerId: string) => void
}

export function DraftPlayerPool({
  format,
  platform,
  rankSetId,
  draftedIds,
  queuedIds,
  canDraft,
  onDraft,
  onQueue,
}: DraftPlayerPoolProps) {
  const [position, setPosition] = useState<PositionFilter>('ALL')
  const [search, setSearch] = useState('')
  const [allRows, setAllRows] = useState<PoolRow[]>([])
  const [error, setError] = useState<string | null>(null)
  // format/platform/rankSetId are props here (owned by the parent's draft
  // setup), not a local selector, so there's no local event handler to set a
  // "loading" flag from synchronously. Instead, "loading" is derived below
  // from whether the most recently *loaded* key (set only from the async
  // callbacks) matches the current one.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const currentKey = `${platform}:${format}:${rankSetId ?? 'none'}`

  useEffect(() => {
    let cancelled = false
    const key = `${platform}:${format}:${rankSetId ?? 'none'}`

    fetchRankedOrAdpFallback(SEASON, format, rankSetId, platform)
      .then((result) => {
        if (cancelled) return
        setAllRows(result.rows)
        setError(null)
        setLoadedKey(key)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load players')
        setLoadedKey(key)
      })

    return () => {
      cancelled = true
    }
  }, [format, platform, rankSetId])

  const loading = loadedKey !== currentKey

  const searchTerm = search.trim().toLowerCase()
  const rows = allRows.filter((row) => {
    if (draftedIds.has(row.platform_player_id)) return false
    if (position !== 'ALL' && row.position !== position) return false
    if (searchTerm && !row.name.toLowerCase().includes(searchTerm)) return false
    return true
  })

  return (
    <div className="draft-pool">
      <div className="draft-pool-toolbar">
        <input
          className="draft-pool-search"
          type="text"
          placeholder="Find player"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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

      <div className="draft-pool-table-wrapper">
        {loading && allRows.length === 0 ? (
          <p className="draft-pool-status">Loading…</p>
        ) : error ? (
          <p className="draft-pool-error">{error}</p>
        ) : rows.length === 0 ? (
          <p className="draft-pool-status">No players left.</p>
        ) : (
          <table className="draft-pool-table">
            <thead>
              <tr>
                <th>Rk</th>
                <th>ADP</th>
                <th>Name</th>
                <th>Team</th>
                <th aria-hidden="true"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.platform_player_id}
                  className={[
                    row.flag ? `flag-${row.flag}` : '',
                    // A break belongs to the player it follows, but the line
                    // is drawn above the *next* row -- otherwise the last
                    // visible player would trail a divider into nothing when
                    // the tier below is fully drafted or filtered out.
                    index > 0 && rows[index - 1].break_after
                      ? `tier-break-${rows[index - 1].break_after}`
                      : '',
                    row.unranked ? 'unranked' : '',
                    // The first row past your own list, so you can see at a
                    // glance that you're off the end of your ranks.
                    row.unranked && index > 0 && !rows[index - 1].unranked
                      ? 'unranked-start'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <td>{row.rank}</td>
                  <td>{row.adp !== null ? row.adp.toFixed(1) : '—'}</td>
                  <td>
                    <PositionTag position={row.position} />
                    <span className="player-name">{row.name}</span>
                    {row.flag === 'target' && (
                      <span
                        className="draft-pool-flag target"
                        title="You marked this player a target"
                      >
                        target
                      </span>
                    )}
                    {row.flag === 'fade' && (
                      <span
                        className="draft-pool-flag fade"
                        title="You marked this player a fade"
                      >
                        fade
                      </span>
                    )}
                    {row.unranked && index > 0 && !rows[index - 1].unranked && (
                      <span className="draft-pool-unranked-note">
                        past your ranks — ADP order below
                      </span>
                    )}
                  </td>
                  <td>{row.team ?? '—'}</td>
                  <td className="draft-pool-actions">
                    {canDraft && (
                      <button
                        type="button"
                        onClick={() => onDraft(row.platform_player_id)}
                      >
                        Draft
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onQueue(row.platform_player_id)}
                      disabled={queuedIds.has(row.platform_player_id)}
                    >
                      {queuedIds.has(row.platform_player_id)
                        ? 'Queued'
                        : '+ Queue'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
