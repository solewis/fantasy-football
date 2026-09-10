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
  /** The rank set backing `overall`, when source === 'saved'. With more than
   * one overall list possible, "using your saved ranks" alone doesn't say
   * which one -- this names it. Null when source === 'adp', since there's no
   * set to name. */
  overallSourceName: string | null
  /** The rank set backing each position's list in `byPosition`, by the same
   * reasoning -- which of possibly several QB/RB/WR/TE lists is in play. */
  positionalSourceNames: Partial<Record<BuildPosition, string>>
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
  const positionalSourceNames: Partial<Record<BuildPosition, string>> = {}
  positionalSets.forEach((entry, index) => {
    const saved = positionalRanks[index]
    if (saved.length === 0) return
    byPosition[entry.position] = withAdpTail(
      saved,
      adpRows.filter((row) => row.position === entry.position),
    )
    positionalSourceNames[entry.position] = entry.set!.name
  })

  // Which set backs the overall list: the one a League explicitly assigned,
  // or -- mirroring the backend resolver's own rule (resolve_rank_set) --
  // whichever overall set is active, so an ad-hoc draft (no League to assign
  // a rank_set_id from) actually reflects the set_active_rank_set choice
  // instead of silently always using whichever one happens to have the
  // lowest id. Falls back to the first overall set found, matching the
  // resolver's own fallback for data that predates the active flag.
  const overallSet =
    rankSetId != null
      ? rankSets.find((s) => s.id === rankSetId)
      : (rankSets.find((s) => s.scope === 'overall' && s.is_active) ??
        rankSets.find((s) => s.scope === 'overall'))

  if (savedOverall.length === 0) {
    return {
      overall: adpRows,
      byPosition,
      source: 'adp',
      overallSourceName: null,
      positionalSourceNames,
    }
  }
  return {
    overall: withAdpTail(savedOverall, adpRows),
    byPosition,
    source: 'saved',
    overallSourceName: overallSet?.name ?? null,
    positionalSourceNames,
  }
}
