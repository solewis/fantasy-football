import { useEffect, useState } from 'react'

import { fetchRanksForSet, type RankSetSummary } from '../../api/ranks'
import type { SupportedPlatform } from '../../components/PlatformTabs'
import { BUILD_POSITIONS } from '../../lib/formats'
import { PositionTag } from '../players/PositionTag'

interface BuildPositionalNextUpProps {
  platform: SupportedPlatform
  format: string
  sets: RankSetSummary[]
  placed: ReadonlySet<string>
  onPick: (playerId: string) => void
}

interface NextUpEntry {
  platform_player_id: string
  name: string
  position: string | null
  team: string | null
  positional_rank: number
  tier: number | null
}

const PER_POSITION = 3

/** The next few players from your *own* positional lists, when building overall.
 *
 * Deliberately carries no delta chips: this isn't a consensus view, it's your
 * own ranking, so there's nothing to agree or disagree with. Showing positional
 * rank and tier only is what keeps it visually distinct from the consensus
 * table below it.
 */
export function BuildPositionalNextUp({
  platform,
  format,
  sets,
  placed,
  onPick,
}: BuildPositionalNextUpProps) {
  const [byPosition, setByPosition] = useState<Record<string, NextUpEntry[]>>(
    {},
  )

  const setsKey = sets.map((s) => `${s.id}:${s.scope}`).join(',')

  useEffect(() => {
    let cancelled = false

    async function load() {
      const result: Record<string, NextUpEntry[]> = {}
      for (const set of sets) {
        const rows = await fetchRanksForSet(set.id)
        result[set.scope] = rows.map((row) => ({
          platform_player_id: row.platform_player_id,
          name: row.name,
          position: row.position,
          team: row.team,
          positional_rank: row.rank,
          tier: row.tier,
        }))
      }
      if (!cancelled) setByPosition(result)
    }

    void load()
    return () => {
      cancelled = true
    }
    // setsKey rather than `sets` alone so a parent that rebuilds an equal array
    // doesn't refetch; `sets` is listed to satisfy the dependency check.
  }, [setsKey, sets, platform, format])

  const positions = BUILD_POSITIONS.filter((p) => byPosition[p]?.length)
  if (positions.length === 0) return null

  return (
    <div className="build-panel is-mine">
      <div className="build-panel-head">From your positional lists</div>
      <div className="build-nextup">
        {positions.map((position) => {
          const remaining = (byPosition[position] ?? [])
            .filter((entry) => !placed.has(entry.platform_player_id))
            .slice(0, PER_POSITION)
          return (
            <div key={position} className="build-nextup-col">
              <div className="build-nextup-head">
                <PositionTag position={position} />
              </div>
              {remaining.length === 0 ? (
                <p className="build-nextup-empty">—</p>
              ) : (
                remaining.map((entry) => (
                  <button
                    key={entry.platform_player_id}
                    type="button"
                    className="build-nextup-row"
                    onClick={() => onPick(entry.platform_player_id)}
                  >
                    <span className="build-nextup-rank">
                      {position}
                      {entry.positional_rank}
                    </span>
                    <span className="player-name">{entry.name}</span>
                    {entry.tier !== null && (
                      <span className="build-nextup-tier">T{entry.tier}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
