export interface PlayerRow {
  rank: number
  platform_player_id: string
  name: string
  position: string | null
  team: string | null
  adp: number
  /** Always null -- ADP has no tiers. Present so a PlayerRow can stand in for
   * a RankRow wherever the frontend swaps an ADP list for a saved one. */
  tier: null
}

export interface FetchPlayersParams {
  platform?: string
  season?: string
  format?: string
  position?: string
  search?: string
}

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000'

export async function fetchPlayers(
  params: FetchPlayersParams,
): Promise<PlayerRow[]> {
  const query = new URLSearchParams()
  if (params.platform) query.set('platform', params.platform)
  if (params.season) query.set('season', params.season)
  if (params.format) query.set('format', params.format)
  if (params.position) query.set('position', params.position)
  if (params.search) query.set('search', params.search)

  const response = await fetch(`${API_BASE}/players?${query.toString()}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch players: ${response.status}`)
  }
  return response.json() as Promise<PlayerRow[]>
}
