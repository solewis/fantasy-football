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
  limit?: number
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
  limit = 8,
}: BuildCandidateTableProps) {
  const shown = candidates.slice(0, limit)

  return (
    <div className="build-panel">
      <div className="build-panel-head">Filling {slotLabel}</div>

      {loading ? (
        <p className="rankings-status">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="rankings-status">{emptyMessage}</p>
      ) : (
        <>
          <DeltaLegend slot={slot} slotLabel={slotLabel} />
          <div className="build-table-wrapper">
            <table className="build-candidates">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Avg</th>
                  <th>Range</th>
                  <th>Cov</th>
                  <th>Tier</th>
                  {sources.map((source) => (
                    <th key={source.ref} className="build-source-col">
                      {source.label}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((candidate) => (
                  <tr key={candidate.platform_player_id}>
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
                    <td className="build-num">
                      {candidate.min !== null && candidate.max !== null
                        ? `${candidate.min}–${candidate.max}`
                        : '—'}
                    </td>
                    <td className="build-num">
                      {candidate.coverage}/{candidate.sourceCount}
                    </td>
                    <td className="build-num">
                      {candidate.source_tier ?? '—'}
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
                    <td>
                      <button
                        type="button"
                        className="build-pick"
                        onClick={() => onPick(candidate.platform_player_id)}
                      >
                        Pick
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
