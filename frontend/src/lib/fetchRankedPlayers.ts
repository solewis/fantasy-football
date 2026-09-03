import { fetchPlayers } from '../api/players'
import {
  fetchRanks,
  fetchRankSets,
  fetchRanksForSet,
  type RankRow,
} from '../api/ranks'
import { BUILD_POSITIONS, type BuildPosition } from './formats'

export type RankedSource = 'saved' | 'adp'

/** A row in the draft pool. `unranked` marks the ADP tail appended past the
 * end of your own list -- still draftable, just not something you ranked. */
export interface PoolRow extends RankRow {
  unranked?: boolean
}

export interface DraftPools {
  /** The ALL tab: your overall ranks, then everyone else by ADP. */
  overall: PoolRow[]
  /** Per position, your own list for that position followed by its ADP tail.
   * Absent for a position you haven't built a list for, in which case the
   * caller filters `overall` instead. */
  byPosition: Partial<Record<BuildPosition, PoolRow[]>>
  source: RankedSource
}

/** Append everyone else by ADP below a list you built.
 *
 * A hand-built list is almost always shorter than a draft is long, and without
 * this the pool simply empties out mid-draft with picks still to make.
 * Numbering continues from your list so the Rk column stays one sequence.
 */
function withAdpTail(saved: RankRow[], adp: RankRow[]): PoolRow[] {
  const ranked = new Set(saved.map((row) => row.platform_player_id))
  const tail: PoolRow[] = adp
    .filter((row) => !ranked.has(row.platform_player_id))
    .map((row, index) => ({
      ...row,
      rank: saved.length + index + 1,
      unranked: true,
    }))
  return [...saved, ...tail]
}

/** Everything the draft pool needs, fetched once.
 *
 * All of it up front rather than per tab: switching positions on the clock
 * should be instant, and these lists are small. It also means a tab switch
 * can't fail halfway through a draft.
 *
 * `rankSetId` (a draft created from a League with a rank set assigned) reads
 * that exact set for the overall list; otherwise the format-based `GET /ranks`
 * resolver applies. Positional lists always come from the resolver's rule --
 * lowest id wins per scope -- since a League only ever points at an overall
 * set.
 */
export async function fetchDraftPools(
  season: string,
  format: string,
  rankSetId?: number | null,
  platform?: string,
): Promise<DraftPools> {
  const [savedOverall, adpRows, rankSets] = await Promise.all([
    rankSetId != null
      ? fetchRanksForSet(rankSetId)
      : fetchRanks({ season, format, platform }),
    fetchPlayers({ season, format, platform }),
    fetchRankSets({ season, format, platform }),
  ])

  const positionalSets = BUILD_POSITIONS.map((position) => ({
    position,
    // The one set marked active for this position -- with multiple named
    // lists now possible per position, "first found" would silently pin the
    // draft room to whichever list happened to be created first, even after
    // a different one is later marked active in the builder.
    set: rankSets.find((s) => s.scope === position && s.is_active) ?? null,
  })).filter((entry) => entry.set !== null)

  const positionalRanks = await Promise.all(
    positionalSets.map((entry) => fetchRanksForSet(entry.set!.id)),
  )

  const byPosition: Partial<Record<BuildPosition, PoolRow[]>> = {}
  positionalSets.forEach((entry, index) => {
    const saved = positionalRanks[index]
    if (saved.length === 0) return
    byPosition[entry.position] = withAdpTail(
      saved,
      adpRows.filter((row) => row.position === entry.position),
    )
  })

  if (savedOverall.length === 0) {
    return { overall: adpRows, byPosition, source: 'adp' }
  }
  return {
    overall: withAdpTail(savedOverall, adpRows),
    byPosition,
    source: 'saved',
  }
}
