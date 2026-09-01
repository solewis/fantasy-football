import { useState } from 'react'

import type { PoolSource } from '../../api/rankPool'
import { isContested, type CandidateSummary } from '../../lib/consensus'
import { PositionTag } from '../players/PositionTag'
import { DeltaChip } from './DeltaChip'
import { DeltaLegend } from './DeltaLegend'

interface BuildCandidateTableProps {
  candidates: CandidateSummary[]
  sources: PoolSource[]
  slot: number
  slotLabel: string
  loading: boolean
  emptyMessage: string
  onPick: (playerId: string) => void
  /** How many rows to show before "Show more". Search overrides it, so a
   * player ranked 200th by consensus is still reachable by name. */
  pageSize?: number
}

/** What each source thinks about the next few candidates.
 *
 * Ordered by average rank -- a sort, not a recommendation. Coverage and spread
 * sit alongside as facts to weigh: a 6.0 average from one source is not a 6.0
 * from five, and wide disagreement is itself worth seeing. Nothing here picks.
 */
export function BuildCandidateTable({
  candidates,
  sources,
  slot,
  slotLabel,
  loading,
  emptyMessage,
  onPick,
  pageSize = 8,
}: BuildCandidateTableProps) {
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(pageSize)

  const query = search.trim().toLowerCase()
  const filtered = query
    ? candidates.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          (c.team ?? '').toLowerCase().includes(query),
      )
    : candidates
  // A search is a request for a specific player, so it isn't paged -- being
  // told "no results" because your guy is 40th by consensus would be worse
  // than useless.
  const shown = query ? filtered.slice(0, 50) : filtered.slice(0, limit)

  function handlePick(playerId: string) {
    // The search was for one player; once they're placed the slot has moved on
    // and leaving the filter up would show an empty table.
    setSearch('')
    setLimit(pageSize)
    onPick(playerId)
  }

  return (
    <div className="build-panel">
      <div className="build-panel-head">
        <span>Filling {slotLabel}</span>
        <input
          className="build-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a player…"
          aria-label="Find a player"
        />
      </div>

      {loading ? (
        <p className="rankings-status">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="rankings-status">
          {query ? `No player matching "${search.trim()}".` : emptyMessage}
        </p>
      ) : (
        <>
          <DeltaLegend slot={slot} slotLabel={slotLabel} />
          <div className="build-table-wrapper">
            <table className="build-candidates">
              <thead>
                <tr>
                  <th />
                  <th>Player</th>
                  <th>Avg</th>
                  {sources.map((source) => (
                    <th
                      key={source.ref}
                      className="build-source-col"
                      title={source.label}
                    >
                      {source.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((candidate) => (
                  <tr key={candidate.platform_player_id}>
                    <td>
                      <button
                        type="button"
                        className="build-pick"
                        onClick={() => handlePick(candidate.platform_player_id)}
                      >
                        Pick
                      </button>
                    </td>
                    <td>
                      <PositionTag position={candidate.position} />
                      <span className="player-name">{candidate.name}</span>
                      <span className="build-team">
                        {candidate.team ?? '—'}
                      </span>
                      {isContested(candidate) && (
                        <span
                          className="build-contested"
                          title="Sources disagree sharply about this player"
                        >
                          contested
                        </span>
                      )}
                    </td>
                    <td className="build-num">
                      {candidate.average?.toFixed(1) ?? '—'}
                    </td>
                    {sources.map((source) => {
                      const rank = candidate.ranks[source.ref] ?? null
                      return (
                        <td key={source.ref}>
                          <DeltaChip
                            sourceRank={rank}
                            slot={slot}
                            sourceLabel={source.label}
                            slotLabel={slotLabel}
                            beyondDepth={
                              rank === null &&
                              source.depth !== null &&
                              slot > source.depth
                            }
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="build-table-footer">
            <span>
              Showing {shown.length} of {filtered.length}
            </span>
            {!query && shown.length < filtered.length && (
              <>
                <button type="button" onClick={() => setLimit((n) => n + 25)}>
                  Show 25 more
                </button>
                <button type="button" onClick={() => setLimit(filtered.length)}>
                  Show all
                </button>
              </>
            )}
            {limit > pageSize && !query && (
              <button type="button" onClick={() => setLimit(pageSize)}>
                Collapse
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
