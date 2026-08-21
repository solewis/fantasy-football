export interface LeagueLookup {
  name: string
  season: string
  num_teams: number
  roster_positions: string[]
  suggested_format: string | null
}

export interface LeagueSummary {
  id: number
  platform: string
  platform_league_id: string
  name: string
  season: string
  format: string
  num_teams: number
  roster_positions: string[]
  team_names: Record<string, string>
  rank_set_id: number | null
}

export interface CreateLeagueParams {
  platform_league_id: string
  format: string
  rank_set_id?: number | null
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

export async function lookupSleeperLeague(
  platformLeagueId: string,
): Promise<LeagueLookup> {
  const query = new URLSearchParams({ platform_league_id: platformLeagueId })
  const response = await fetch(`${API_BASE}/leagues/lookup?${query.toString()}`)
  return parseOrThrow(response, 'Looking up league')
}

export async function fetchLeagues(): Promise<LeagueSummary[]> {
  const response = await fetch(`${API_BASE}/leagues`)
  return parseOrThrow(response, 'Fetching leagues')
}

export async function createLeague(
  params: CreateLeagueParams,
): Promise<LeagueSummary> {
  const response = await fetch(`${API_BASE}/leagues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  return parseOrThrow(response, 'Creating league')
}

export async function syncLeague(leagueId: number): Promise<LeagueSummary> {
  const response = await fetch(`${API_BASE}/leagues/${leagueId}/sync`, {
    method: 'POST',
  })
  return parseOrThrow(response, 'Syncing league')
}

export async function updateLeagueFormat(
  leagueId: number,
  format: string,
): Promise<LeagueSummary> {
  const response = await fetch(`${API_BASE}/leagues/${leagueId}/format`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format }),
  })
  return parseOrThrow(response, 'Updating league format')
}

export async function updateLeagueRankSet(
  leagueId: number,
  rankSetId: number | null,
): Promise<LeagueSummary> {
  const response = await fetch(`${API_BASE}/leagues/${leagueId}/rank-set`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rank_set_id: rankSetId }),
  })
  return parseOrThrow(response, 'Updating league rank set')
}

export async function deleteLeague(leagueId: number): Promise<void> {
  const response = await fetch(`${API_BASE}/leagues/${leagueId}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error(`Deleting league failed: ${response.status}`)
  }
}
