/** Autosaving the in-progress build to localStorage.
 *
 * Rankings is a top-level tab: switching to Leagues or Players fully unmounts
 * BuildPage (see App.tsx -- there's no router keeping it alive offscreen), so
 * every in-memory state -- picks, tier breaks, flags, which sources were
 * checked -- was gone the moment you navigated away and came back, even
 * though nothing had been explicitly discarded. This is restored silently on
 * mount rather than prompted, since the whole point is that it should feel
 * like nothing was ever lost.
 */

import type { BreakStrength, PlayerFlag } from './rankBuilder'

export interface StoredBuildDraft {
  scope: string
  targetChoice: number | 'new' | null
  newSetName: string
  order: string[]
  breaks: Record<string, BreakStrength>
  flags: Record<string, PlayerFlag>
  /** Whether this order has unsaved changes on top of whatever's in the
   * backend. Restored as-is, so the existing "you'll lose unsaved picks"
   * confirmation still fires correctly on the next scope/target switch after
   * a restore -- without it, a restored-but-still-unsaved draft would read as
   * clean and switch away silently. */
  dirty: boolean
  selectedRefs: string[]
  /** Every source ref that existed the last time this was saved, so a source
   * that's brand new since then can still default to checked -- see
   * reconcileSelection. */
  knownRefs: string[]
}

/** Parses a stored draft, tolerating anything that isn't a well-formed one
 * (nothing saved yet, corrupted JSON, a shape from a future version) by
 * falling back to null rather than throwing -- restoring progress is a nice
 * touch, and it should never itself be the thing that breaks the page. */
export function parseStoredBuildDraft(
  raw: string | null,
): StoredBuildDraft | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { order?: unknown }).order) &&
      (parsed as { order: unknown[] }).order.every((v) => typeof v === 'string')
    ) {
      return parsed as StoredBuildDraft
    }
    return null
  } catch {
    return null
  }
}

/** Merge a persisted selection with what's actually available: a ref you'd
 * already made a deliberate choice about (checked or not) keeps that choice,
 * and anything new since the persisted snapshot defaults to checked --
 * matching the existing "a freshly imported dataset joins already selected"
 * convenience, rather than sitting unchecked and looking broken.
 *
 * On a first-ever visit (nothing persisted, so `previouslyKnownRefs` is
 * empty), every available ref counts as "new" and the result is everything --
 * the same default as before any of this was persisted.
 */
export function reconcileSelection(
  persistedSelection: string[],
  previouslyKnownRefs: string[],
  availableRefs: string[],
): string[] {
  const stillAvailable = new Set(availableRefs)
  const known = new Set(previouslyKnownRefs)
  const kept = persistedSelection.filter((ref) => stillAvailable.has(ref))
  const fresh = availableRefs.filter((ref) => !known.has(ref))
  return [...new Set([...kept, ...fresh])]
}
