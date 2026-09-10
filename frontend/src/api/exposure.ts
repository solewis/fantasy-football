export interface ExposureRow {
  id: number
  platform: string
  season: string
  platform_player_id: string
  name: string
  position: string | null
  team: string | null
  shares: number
  updated_at: string
}

export interface SetExposureParams {
  platform?: string
  season?: string
  platform_player_id: string
  shares: number
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

export async function fetchExposures(params: {
  platform?: string
  season?: string
}): Promise<ExposureRow[]> {
  const query = new URLSearchParams()
  if (params.platform) query.set('platform', params.platform)
  if (params.season) query.set('season', params.season)
  const response = await fetch(`${API_BASE}/exposures?${query.toString()}`)
  return parseOrThrow(response, 'Fetching exposures')
}

/** Create or update your share count for a player -- upsert, not a plain
 * create, so re-submitting the same form after editing shares is the same
 * request as adding a new one. */
export async function setExposure(
  params: SetExposureParams,
): Promise<ExposureRow> {
  const response = await fetch(`${API_BASE}/exposures`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  return parseOrThrow(response, 'Saving exposure')
}

export async function deleteExposure(exposureId: number): Promise<void> {
  const response = await fetch(`${API_BASE}/exposures/${exposureId}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error(`Deleting exposure failed: ${response.status}`)
  }
}
