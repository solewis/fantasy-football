import {
  isPositionalRankSetSource,
  isSourceEligibleForScope,
  type AvailableSource,
} from '../../api/rankPool'

interface BuildSourcePickerProps {
  /** Already in priority order -- top of the list is furthest left in the
   * candidate table. */
  sources: AvailableSource[]
  selectedRefs: string[]
  /** How many are actually feeding the table right now -- shown in the header
   * so "no columns appeared" is never a mystery. */
  eligibleCount: number
  scope: string
  onToggle: (ref: string) => void
  onMove: (ref: string, direction: 'up' | 'down') => void
}

/** Which sources to compare against, and in what priority order.
 *
 * A source that can't serve the current axis is disabled with the reason
 * shown, rather than hidden -- "this file only has positional ranks" is useful
 * information, and silently omitting it looks like the import failed. It stays
 * reorderable too: an order set here shouldn't reshuffle itself the moment you
 * switch to a scope where that source happens to be unusable.
 *
 * Your own positional lists (QB/RB/WR/TE) render in a separate section below
 * the main list, and only the one active per position appears there -- and
 * only while building overall. They aren't a source you'd compare a different
 * position's build against, and multiple lists for the same position is
 * exactly the ambiguity the active flag exists to remove.
 */
export function BuildSourcePicker({
  sources,
  selectedRefs,
  eligibleCount,
  scope,
  onToggle,
  onMove,
}: BuildSourcePickerProps) {
  const wantsOverall = scope === 'overall'
  const usableCount = sources.filter((s) =>
    isSourceEligibleForScope(s, scope),
  ).length

  // Indices are computed against the full, still-ordered list so the up/down
  // buttons disable at the true top/bottom and keep moving the one shared
  // priority order underneath -- splitting into two visual sections must not
  // split the ordering itself.
  const indexByRef = new Map(sources.map((s, i) => [s.ref, i]))
  const mainSources = sources.filter((s) => !isPositionalRankSetSource(s))
  const positionalSources = wantsOverall
    ? sources.filter(
        (s) => isPositionalRankSetSource(s) && s.is_active === true,
      )
    : []

  function renderRow(source: AvailableSource) {
    const usable = isSourceEligibleForScope(source, scope)
    const reason = isPositionalRankSetSource(source)
      ? wantsOverall
        ? 'not the active list for this position'
        : 'your positional lists only feed the overall build'
      : wantsOverall
        ? 'no overall ranks'
        : 'no positional ranks'
    const index = indexByRef.get(source.ref) ?? 0
    return (
      <li key={source.ref} className="build-source-row">
        <label
          className={`build-source${usable ? '' : ' disabled'}`}
          title={usable ? undefined : `Can't be used here — ${reason}`}
        >
          <input
            type="checkbox"
            checked={usable && selectedRefs.includes(source.ref)}
            disabled={!usable}
            onChange={() => onToggle(source.ref)}
          />
          <span>{source.label}</span>
          {isPositionalRankSetSource(source) && (
            <span className="build-source-tag">{source.scope}</span>
          )}
          {!usable && <span className="build-source-note">{reason}</span>}
        </label>
        <span className="build-source-move">
          <button
            type="button"
            className="build-source-move-btn"
            onClick={() => onMove(source.ref, 'up')}
            disabled={index === 0}
            aria-label={`Move ${source.label} up`}
            title="Higher priority -- shows further left when selected"
          >
            ▲
          </button>
          <button
            type="button"
            className="build-source-move-btn"
            onClick={() => onMove(source.ref, 'down')}
            disabled={index === sources.length - 1}
            aria-label={`Move ${source.label} down`}
            title="Lower priority -- shows further right when selected"
          >
            ▼
          </button>
        </span>
      </li>
    )
  }

  return (
    <div className="build-panel build-sources">
      <div className="build-panel-head">
        Sources
        <span className="build-source-count">
          {eligibleCount} of {usableCount}
        </span>
      </div>
      <ul className="build-source-list">{mainSources.map(renderRow)}</ul>

      {positionalSources.length > 0 && (
        <>
          <div className="build-panel-head build-panel-subhead">
            Your positional lists
          </div>
          <ul className="build-source-list">
            {positionalSources.map(renderRow)}
          </ul>
        </>
      )}
    </div>
  )
}
