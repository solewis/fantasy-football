import type { AvailableSource } from '../../api/rankPool'

interface BuildSourcePickerProps {
  sources: AvailableSource[]
  selectedRefs: string[]
  scope: string
  onToggle: (ref: string) => void
}

/** Which sources to compare against.
 *
 * A source that can't serve the current axis is disabled with the reason
 * shown, rather than hidden -- "this file only has positional ranks" is useful
 * information, and silently omitting it looks like the import failed.
 */
export function BuildSourcePicker({
  sources,
  selectedRefs,
  scope,
  onToggle,
}: BuildSourcePickerProps) {
  const wantsOverall = scope === 'overall'

  return (
    <div className="build-panel build-sources">
      <div className="build-panel-head">Sources</div>
      <ul className="build-source-list">
        {sources.map((source) => {
          const usable = wantsOverall
            ? source.supports_overall
            : source.supports_positional
          const reason = wantsOverall
            ? 'no overall ranks'
            : 'no positional ranks'
          return (
            <li key={source.ref}>
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
            </li>
          )
        })}
      </ul>
    </div>
  )
}
