/** User-facing platform names -- "espn".toUpperCase() would give "ESPN" but
 * a naive capitalize() gives "Espn", so this is spelled out explicitly per
 * platform rather than derived. Mirrors app/ingest/platforms.py's
 * DISPLAY_NAMES on the backend.
 */
export const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
}

export function platformDisplayName(platform: string): string {
  return PLATFORM_DISPLAY_NAMES[platform] ?? platform
}
