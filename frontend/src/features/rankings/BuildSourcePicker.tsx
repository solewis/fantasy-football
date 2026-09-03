import type { AvailableSource } from '../../api/rankPool'

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
    wantsOverall ? s.supports_overall : s.supports_positional,
  ).length

  return (
    <div className="build-panel build-sources">
      <div className="build-panel-head">
        Sources
        <span className="build-source-count">
          {eligibleCount} of {usableCount}
        </span>
      </div>
      <ul className="build-source-list">
        {sources.map((source, index) => {
          const usable = wantsOverall
            ? source.supports_overall
            : source.supports_positional
          const reason = wantsOverall
            ? 'no overall ranks'
            : 'no positional ranks'
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
                {source.kind === 'rank_set' && source.scope !== 'overall' && (
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
        })}
      </ul>
    </div>
  )
}
