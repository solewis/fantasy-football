import { fetchPlayers } from '../api/players'
import { fetchRanks, fetchRanksForSet, type RankRow } from '../api/ranks'

export type RankedSource = 'saved' | 'adp'

/** A row in the draft pool. `unranked` marks the ADP tail appended past the
 * end of your own list -- still draftable, just not something you ranked. */
export interface PoolRow extends RankRow {
  unranked?: boolean
}

export interface RankedPlayersResult {
  rows: PoolRow[]
  source: RankedSource
  /** How many of `rows` came from your saved ranks. */
  rankedCount: number
}

/** Your saved ranks, then everyone else by ADP underneath.
 *
 * The tail matters: a hand-built list is usually shorter than a draft is long,
 * and without it the pool simply empties out once your ranks run dry -- mid-
 * draft, with picks still to make. Appending the rest by ADP means you can
 * never run out, while your own order still governs everything you ranked.
 *
 * When `rankSetId` is given (a draft created from a League with a rank set
 * assigned), reads that exact set via `GET /rank-sets/{id}/ranks`. Otherwise
 * falls back to the format-based `GET /ranks` resolver (lowest-id-wins per
 * format) used by manual and non-league-linked drafts.
 */
export async function fetchRankedOrAdpFallback(
  season: string,
  format: string,
  rankSetId?: number | null,
  platform?: string,
): Promise<RankedPlayersResult> {
  const savedRows =
    rankSetId != null
      ? await fetchRanksForSet(rankSetId)
      : await fetchRanks({ season, format, platform })

  const adpRows = await fetchPlayers({ season, format, platform })

  if (savedRows.length === 0) {
    return { rows: adpRows, source: 'adp', rankedCount: 0 }
  }

  const ranked = new Set(savedRows.map((row) => row.platform_player_id))
  const tail: PoolRow[] = adpRows
    .filter((row) => !ranked.has(row.platform_player_id))
    // Numbering continues from your list so the Rk column stays a single
    // sequence rather than restarting at 1 partway down.
    .map((row, index) => ({
      ...row,
      rank: savedRows.length + index + 1,
      unranked: true,
    }))

  return {
    rows: [...savedRows, ...tail],
    source: 'saved',
    rankedCount: savedRows.length,
  }
}
