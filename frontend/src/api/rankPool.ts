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
  /** Whether this is the one positional set used for its position by the
   * overall builder and the draft room. null for adp/dataset sources and for
   * an overall-scoped rank set -- neither has an "active" concept. */
  is_active: boolean | null
}

/** A source that is one of your own positional lists (QB/RB/WR/TE), as
 * opposed to ADP, an imported dataset, or one of your own overall lists. */
export function isPositionalRankSetSource(source: AvailableSource): boolean {
  return (
    source.kind === 'rank_set' &&
    source.scope !== null &&
    source.scope !== 'overall'
  )
}

/** Whether a source can feed the build currently in progress.
 *
 * Shared by the source picker (what's shown checked/disabled) and the pool
 * fetch (what's actually sent to the backend) so the two can never disagree
 * about what "usable" means -- that mismatch is exactly the class of bug this
 * function exists to prevent.
 *
 * Your own positional lists are a special case: they only feed an *overall*
 * build, and only the one list marked active for that position. Comparing an
 * RB list's ranks against QB candidates is meaningless (the players don't
 * even overlap), and showing every list for a position here is the exact
 * ambiguity the active flag exists to remove.
 */
export function isSourceEligibleForScope(
  source: AvailableSource,
  scope: string,
): boolean {
  if (isPositionalRankSetSource(source)) {
    return scope === 'overall' && source.is_active === true
  }
  return scope === 'overall'
    ? source.supports_overall
    : source.supports_positional
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
