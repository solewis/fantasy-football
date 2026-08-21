import { fetchPlayers } from '../api/players'
import { fetchRanks, fetchRanksForSet, type RankRow } from '../api/ranks'

export type RankedSource = 'saved' | 'adp'

export interface RankedPlayersResult {
  rows: RankRow[]
  source: RankedSource
}

/** Your saved ranks if you have any, else ADP order -- the same fallback the
 * Rankings builder uses to seed itself. Shared so the draft player pool
 * shows the same "your ranks, or ADP if none yet" list.
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
): Promise<RankedPlayersResult> {
  const savedRows =
    rankSetId != null
      ? await fetchRanksForSet(rankSetId)
      : await fetchRanks({ season, format })
  if (savedRows.length > 0) {
    return { rows: savedRows, source: 'saved' }
  }
  const adpRows = await fetchPlayers({ season, format })
  return { rows: adpRows, source: 'adp' }
}
