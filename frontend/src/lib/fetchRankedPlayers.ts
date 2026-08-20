import { fetchPlayers } from '../api/players'
import { fetchRanks, type RankRow } from '../api/ranks'

export type RankedSource = 'saved' | 'adp'

export interface RankedPlayersResult {
  rows: RankRow[]
  source: RankedSource
}

/** Your saved ranks for this format if you have any, else ADP order --
 * the same fallback the Rankings builder uses to seed itself. Shared so the
 * draft player pool shows the same "your ranks, or ADP if none yet" list. */
export async function fetchRankedOrAdpFallback(
  season: string,
  format: string,
): Promise<RankedPlayersResult> {
  const savedRows = await fetchRanks({ season, format })
  if (savedRows.length > 0) {
    return { rows: savedRows, source: 'saved' }
  }
  const adpRows = await fetchPlayers({ season, format })
  return { rows: adpRows, source: 'adp' }
}
