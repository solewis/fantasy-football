import type { ColumnMapping, ParsedSampleRow } from '../../api/rankDatasets'
import { BUILD_POSITIONS } from '../../lib/formats'

/** Every field a column can feed. "ignore" is the default for columns we don't
 * use (bye weeks, projections, ownership...). */
const FIELDS = [
  { key: 'name', label: 'Player name' },
  { key: 'position', label: 'Position' },
  { key: 'team', label: 'Team' },
  { key: 'overall_rank', label: 'Overall rank' },
  { key: 'position_rank', label: 'Positional rank' },
  { key: 'tier', label: 'Tier' },
] as const

type MappableField = (typeof FIELDS)[number]['key']

interface SourceColumnMapperProps {
  columns: string[]
  mapping: ColumnMapping
  sampleRows: ParsedSampleRow[]
  rowCount: number
  onChange: (mapping: ColumnMapping) => void
}

/** One select per detected column, above sample rows rendered *through* the
 * current mapping -- so a wrong guess is visible before anything is saved. */
export function SourceColumnMapper({
  columns,
  mapping,
  sampleRows,
  rowCount,
  onChange,
}: SourceColumnMapperProps) {
  function fieldForColumn(index: number): MappableField | 'ignore' {
    for (const field of FIELDS) {
      if (mapping[field.key] === index) return field.key
    }
    return 'ignore'
  }

  function assign(index: number, field: MappableField | 'ignore') {
    const next: ColumnMapping = { ...mapping }
    // A column can only feed one field, and a field only one column.
    for (const f of FIELDS) {
      if (next[f.key] === index) next[f.key] = null
    }
    if (field !== 'ignore') next[field] = index
    onChange(next)
  }

  return (
    <div className="sources-mapper">
      <div className="sources-mapper-columns">
        {columns.map((column, index) => (
          <label key={`${column}-${index}`} className="sources-mapper-field">
            <span className="sources-mapper-header">
              {column || `Column ${index + 1}`}
            </span>
            <select
              value={fieldForColumn(index)}
              aria-label={`Column ${index + 1}: ${column}`}
              onChange={(e) =>
                assign(index, e.target.value as MappableField | 'ignore')
              }
            >
              <option value="ignore">Ignore</option>
              {FIELDS.map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <label className="sources-mapper-toggle">
        <input
          type="checkbox"
          checked={mapping.overall_rank_from_row_order}
          onChange={(e) =>
            onChange({
              ...mapping,
              overall_rank_from_row_order: e.target.checked,
            })
          }
        />
        Row order is the rank (the file has no rank column)
      </label>

      {mapping.position === null && mapping.position_rank !== null && (
        <label className="sources-mapper-toggle">
          This file is all one position
          <select
            value={mapping.single_position ?? ''}
            aria-label="Single position"
            onChange={(e) =>
              onChange({ ...mapping, single_position: e.target.value || null })
            }
          >
            <option value="">Choose…</option>
            {BUILD_POSITIONS.map((position) => (
              <option key={position} value={position}>
                {position}
              </option>
            ))}
          </select>
        </label>
      )}

      <p className="sources-mapper-count">
        {rowCount} rows — first {sampleRows.length} shown as they&apos;d import:
      </p>
      <table className="sources-sample">
        <thead>
          <tr>
            <th>Name</th>
            <th>Pos</th>
            <th>Team</th>
            <th>Overall</th>
            <th>Pos rank</th>
            <th>Tier</th>
          </tr>
        </thead>
        <tbody>
          {sampleRows.map((row) => (
            <tr key={row.row_index}>
              <td>{row.source_name_raw}</td>
              <td>{row.position ?? '—'}</td>
              <td>{row.team ?? '—'}</td>
              <td>{row.overall_rank ?? '—'}</td>
              <td>
                {row.position_rank ?? '—'}
                {row.position_rank_derived && (
                  <span
                    className="sources-derived"
                    title="Derived from the overall rank"
                  >
                    der.
                  </span>
                )}
              </td>
              <td>{row.tier ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
