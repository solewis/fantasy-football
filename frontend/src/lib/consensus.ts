/** Summarizing what a set of sources says about each candidate.
 *
 * Everything here is descriptive. There is no recommendation, no blended
 * score standing in for a decision, and no reordering by the tool's own
 * judgment about who *should* go next -- candidates sort by average rank
 * because that's the order asked for, and coverage and spread are shown as
 * facts to weigh rather than used to override it.
 */

import type { PoolPlayer } from '../api/rankPool'

export interface CandidateSummary {
  platform_player_id: string
  name: string
  position: string | null
  team: string | null
  adp: number | null
  /** Mean of the ranks from sources that actually rank them. null when no
   * selected source does. */
  average: number | null
  min: number | null
  max: number | null
  /** max - min. Wide disagreement is itself a signal. */
  spread: number | null
  /** How many of the selected sources rank them at all. A 6.0 average from one
   * source is not a 6.0 from five. */
  coverage: number
  sourceCount: number
  ranks: Record<string, number | null>
}

/** Above this, sources disagree enough to be worth flagging. */
export const CONTESTED_SPREAD = 8

export function isContested(candidate: CandidateSummary): boolean {
  return candidate.spread !== null && candidate.spread >= CONTESTED_SPREAD
}

/** Summarize and order the pool.
 *
 * Missing ranks are never imputed. The average is over the sources that have
 * an opinion, so a source that simply doesn't publish that deep can't drag a
 * player down -- and coverage is reported so the reader can discount a thin
 * average themselves.
 */
export function summarizeCandidates(
  players: PoolPlayer[],
  sourceRefs: string[],
  excludeIds: ReadonlySet<string>,
): CandidateSummary[] {
  const summaries: CandidateSummary[] = []

  for (const player of players) {
    if (excludeIds.has(player.platform_player_id)) continue

    const values: number[] = []
    const ranks: Record<string, number | null> = {}
    for (const ref of sourceRefs) {
      const rank = player.ranks[ref] ?? null
      ranks[ref] = rank
      if (rank !== null) values.push(rank)
    }

    const average =
      values.length > 0
        ? values.reduce((sum, v) => sum + v, 0) / values.length
        : null

    summaries.push({
      platform_player_id: player.platform_player_id,
      name: player.name,
      position: player.position,
      team: player.team,
      adp: player.adp,
      average,
      min: values.length > 0 ? Math.min(...values) : null,
      max: values.length > 0 ? Math.max(...values) : null,
      spread:
        values.length > 0 ? Math.max(...values) - Math.min(...values) : null,
      coverage: values.length,
      sourceCount: sourceRefs.length,
      ranks,
    })
  }

  // Average ascending. A player no selected source ranks has no average and
  // sorts last -- not first, which is what a naive null-as-zero would do.
  summaries.sort((a, b) => {
    if (a.average === null && b.average === null)
      return a.name.localeCompare(b.name)
    if (a.average === null) return 1
    if (b.average === null) return -1
    if (a.average !== b.average) return a.average - b.average
    if (a.coverage !== b.coverage) return b.coverage - a.coverage
    return a.name.localeCompare(b.name)
  })

  return summaries
}
