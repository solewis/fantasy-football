/** Bucketing a share count into a 5-step highlight level for the Exposure
 * page's gradient.
 *
 * This is a magnitude, not a signed delta -- there's no "arm" to pick, just
 * one hue running light to dark. Reuses DeltaChip's "value" ramp verbatim
 * (see components/delta.css) rather than inventing a new palette: that ramp
 * is already exactly a validated single-hue sequential scale, just applied
 * there to a different quantity.
 *
 * Scaled to whatever the highest share count actually in view is, rather
 * than a fixed ceiling -- a max of 3 across the board should still show a
 * visible gradient, and a max of 30 shouldn't make everything else look
 * uniformly pale by comparison to some arbitrary fixed top end.
 */
export type ShareLevel = 0 | 1 | 2 | 3 | 4 | 5

export function shareLevel(shares: number, maxShares: number): ShareLevel {
  if (shares <= 0 || maxShares <= 0) return 0
  const level = Math.ceil((shares / maxShares) * 5)
  return Math.min(5, Math.max(1, level)) as ShareLevel
}
