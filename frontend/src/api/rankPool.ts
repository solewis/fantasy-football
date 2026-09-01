/** The builder's data: which sources exist, and what each says about each
 * player.
 *
 * The backend deliberately returns no averages, no ordering by merit and no
 * suggested pick -- it reports what the sources think and the human decides.
 * Every derived number is computed in src/lib/consensus.ts, which also has to
 * happen client-side anyway since deltas change with every pick.
 */

export type SourceKind = 'adp' | 'dataset' | 'rank_set'

export interface AvailableSource {
  ref: string
  label: string
  kind: SourceKind
  supports_overall: boolean
  supports_positional: boolean
  /** The rank set's own scope, for rank_set sources; null otherwise. */
  scope: string | null
}

export interface PoolSource {
  ref: string
  label: string
  kind: SourceKind
  /** Deepest rank this source publishes on the current axis. Lets the UI tell
   * "left this player off" from "only ranks 150 players". */
  depth: number | null
  unresolved_count: number
}

export interface PoolPlayer {
  platform_player_id: string
  name: string
  position: string | null
  team: string | null
  adp: number | null
  /** Keyed by source ref. null means that source doesn't rank this player --
   * never a substituted number. */
  ranks: Record<string, number | null>
}

export interface RankPool {
  scope: string
  sources: PoolSource[]
  players: PoolPlayer[]
}

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000'

async function parseOrThrow<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    let detail = ''
    try {
      const body = (await response.json()) as { detail?: string }
      detail = body.detail ?? ''
    } catch {
      // response body wasn't JSON -- fall back to just the status code
    }
    throw new Error(
      detail ? `${label}: ${detail}` : `${label} failed: ${response.status}`,
    )
  }
  return response.json() as Promise<T>
}

export async function fetchAvailableSources(params: {
  platform: string
  season: string
  format: string
}): Promise<AvailableSource[]> {
  const query = new URLSearchParams(params)
  const response = await fetch(`${API_BASE}/rank-sources?${query.toString()}`)
  return parseOrThrow(response, 'Fetching rank sources')
}

/** The whole pool in one request, so each pick can recompute locally with no
 * round trip. */
export async function fetchRankPool(params: {
  platform: string
  season: string
  format: string
  scope: string
  sourceRefs: string[]
}): Promise<RankPool> {
  const query = new URLSearchParams({
    platform: params.platform,
    season: params.season,
    format: params.format,
    scope: params.scope,
  })
  for (const ref of params.sourceRefs) query.append('source_ref', ref)
  const response = await fetch(`${API_BASE}/rank-pool?${query.toString()}`)
  return parseOrThrow(response, 'Fetching rank pool')
}
