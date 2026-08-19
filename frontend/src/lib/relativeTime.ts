const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 1000 * 60 * 60 * 24 * 365],
  ['month', 1000 * 60 * 60 * 24 * 30],
  ['day', 1000 * 60 * 60 * 24],
  ['hour', 1000 * 60 * 60],
  ['minute', 1000 * 60],
]

const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function formatRelativeTime(
  isoTimestamp: string | null,
  now: Date = new Date(),
): string {
  if (!isoTimestamp) return 'Never'

  const diffMs = new Date(isoTimestamp).getTime() - now.getTime()

  for (const [unit, unitMs] of UNITS) {
    if (Math.abs(diffMs) >= unitMs) {
      return formatter.format(Math.round(diffMs / unitMs), unit)
    }
  }
  return 'Just now'
}
