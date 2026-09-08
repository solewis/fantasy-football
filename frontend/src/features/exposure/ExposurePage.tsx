import { useEffect, useState } from 'react'

import {
  deleteExposure,
  fetchExposures,
  setExposure,
  type ExposureRow,
} from '../../api/exposure'
import {
  fetchRanksForSet,
  fetchRankSets,
  type RankRow,
  type RankSetSummary,
} from '../../api/ranks'
import {
  PlatformTabs,
  type SupportedPlatform,
} from '../../components/PlatformTabs'
import { shareLevel } from '../../lib/exposureLevels'
import { SEASON } from '../../lib/formats'
import { PositionTag } from '../players/PositionTag'
import '../players/players.css'
import './exposure.css'

/** How many shares of each player you have, across however many leagues and
 * drafts -- manually entered for now, not derived from actual League
 * rosters.
 *
 * Shows every player in a rank list you choose, in that list's order,
 * defaulting anyone with no recorded shares to 0 -- editing a row's shares
 * is the whole interaction; there's no separate add/remove step, since
 * membership in the list is what decides who shows up here, not whether
 * you've touched their share count yet. Zeroing a row back out deletes its
 * underlying exposure record rather than leaving a stray "0" row behind.
 */
export function ExposurePage() {
  const [platform, setPlatform] = useState<SupportedPlatform>('sleeper')
  const [rankSets, setRankSets] = useState<RankSetSummary[]>([])
  const [rankSetId, setRankSetId] = useState<number | null>(null)
  const [rows, setRows] = useState<RankRow[]>([])
  const [exposuresById, setExposuresById] = useState<Map<string, ExposureRow>>(
    new Map(),
  )
  const [search, setSearch] = useState('')
  const [loadingRankSets, setLoadingRankSets] = useState(true)
  const [loadingRows, setLoadingRows] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Per-row in-progress edit text, keyed by platform_player_id -- lets the
  // input hold whatever's being typed (including a momentarily invalid
  // value) without touching saved state until it's actually committed.
  const [draftShares, setDraftShares] = useState<Record<string, string>>({})

  function selectPlatform(next: SupportedPlatform) {
    setLoadingRankSets(true)
    setPlatform(next)
    setRankSetId(null)
  }

  // Rank sets (any format/scope -- this page has no format concept of its
  // own) and this platform's exposure records load independently: which
  // rank list you're viewing has no bearing on which players you've
  // recorded shares for.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchRankSets({ platform, season: SEASON }),
      fetchExposures({ platform, season: SEASON }),
    ])
      .then(([sets, exposureRows]) => {
        if (cancelled) return
        setRankSets(sets)
        setExposuresById(
          new Map(exposureRows.map((e) => [e.platform_player_id, e])),
        )
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoadingRankSets(false)
      })
    return () => {
      cancelled = true
    }
  }, [platform])

  useEffect(() => {
    // Nothing to fetch -- and nothing reads `rows` while rankSetId is null,
    // since the render branches on that first (the "choose a rank list"
    // prompt), so there's no staleness to clear here either.
    if (rankSetId === null) return
    let cancelled = false
    fetchRanksForSet(rankSetId)
      .then((result) => {
        if (!cancelled) {
          setRows(result)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'Failed to load rank set',
          )
      })
      .finally(() => {
        if (!cancelled) setLoadingRows(false)
      })
    return () => {
      cancelled = true
    }
  }, [rankSetId])

  const maxShares = Math.max(
    0,
    ...rows.map(
      (row) => exposuresById.get(row.platform_player_id)?.shares ?? 0,
    ),
  )

  const searchTerm = search.trim().toLowerCase()
  const visibleRows = rows.filter(
    (row) => !searchTerm || row.name.toLowerCase().includes(searchTerm),
  )

  // Shared by the text box (on blur) and the +/- steppers -- both eventually
  // just want "make this row's saved share count equal newValue".
  async function applyShares(row: RankRow, newValue: number) {
    const current = exposuresById.get(row.platform_player_id)
    if (newValue === (current?.shares ?? 0)) return

    try {
      if (newValue === 0) {
        if (current) {
          await deleteExposure(current.id)
          setExposuresById((prev) => {
            const next = new Map(prev)
            next.delete(row.platform_player_id)
            return next
          })
        }
        return
      }
      const updated = await setExposure({
        platform,
        season: SEASON,
        platform_player_id: row.platform_player_id,
        shares: newValue,
      })
      setExposuresById((prev) =>
        new Map(prev).set(row.platform_player_id, updated),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update shares')
    }
  }

  async function commitShares(row: RankRow) {
    const raw = draftShares[row.platform_player_id]
    if (raw === undefined) return
    setDraftShares(({ [row.platform_player_id]: _discard, ...rest }) => rest)

    const parsed = Number(raw)
    // An invalid entry just reverts -- silently, since it's almost always a
    // stray keystroke rather than something worth an error message for a
    // single-user manual-entry field.
    if (!Number.isInteger(parsed) || parsed < 0) return
    await applyShares(row, parsed)
  }

  // Acts on whatever's currently showing, including an uncommitted typed
  // edit -- clicking + right after typing "5" should save 6, not silently
  // discard the typed value in favour of whatever was last saved.
  function bumpShares(row: RankRow, delta: number, displayed: number) {
    setDraftShares(({ [row.platform_player_id]: _discard, ...rest }) => rest)
    void applyShares(row, Math.max(0, displayed + delta))
  }

  return (
    <div className="exposure-page">
      <div className="exposure-toolbar">
        <PlatformTabs value={platform} onChange={selectPlatform} />
        <select
          value={rankSetId ?? ''}
          onChange={(e) => {
            const next = e.target.value ? Number(e.target.value) : null
            if (next !== null) setLoadingRows(true)
            setRankSetId(next)
          }}
          aria-label="Rank list"
        >
          <option value="">Choose a rank list…</option>
          {rankSets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.scope}
            </option>
          ))}
        </select>
        {rankSetId !== null && (
          <input
            className="exposure-search"
            type="text"
            placeholder="Find player"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Find player"
          />
        )}
      </div>

      {error && <p className="exposure-error">{error}</p>}

      {rankSetId === null ? (
        <p className="exposure-status">
          {loadingRankSets
            ? 'Loading…'
            : rankSets.length === 0
              ? 'No rank lists yet -- build one in Rankings first.'
              : 'Choose a rank list above to see every player in it and record your shares.'}
        </p>
      ) : loadingRows && rows.length === 0 ? (
        <p className="exposure-status">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="exposure-status">This rank list is empty.</p>
      ) : visibleRows.length === 0 ? (
        <p className="exposure-status">No player matching "{search.trim()}".</p>
      ) : (
        <table className="exposure-table">
          <thead>
            <tr>
              <th>Rk</th>
              <th>Name</th>
              <th>Team</th>
              <th>Shares</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const shares =
                exposuresById.get(row.platform_player_id)?.shares ?? 0
              const level = shareLevel(shares, maxShares)
              const raw = draftShares[row.platform_player_id]
              const rawParsed = raw !== undefined ? Number(raw) : NaN
              // What the +/- buttons act on and display, honouring an
              // uncommitted typed edit -- otherwise clicking + right after
              // typing "5" would discard the typed value.
              const displayed =
                raw !== undefined &&
                Number.isInteger(rawParsed) &&
                rawParsed >= 0
                  ? rawParsed
                  : shares
              return (
                <tr key={row.platform_player_id} data-share-level={level}>
                  <td className="exposure-rank">{row.rank}</td>
                  <td>
                    <PositionTag position={row.position} />
                    <span className="player-name">{row.name}</span>
                  </td>
                  <td>{row.team ?? '—'}</td>
                  <td>
                    <div className="exposure-shares-control">
                      <button
                        type="button"
                        className="exposure-shares-step"
                        aria-label={`Decrease shares of ${row.name}`}
                        onClick={() => bumpShares(row, -1, displayed)}
                        disabled={displayed <= 0}
                      >
                        −
                      </button>
                      <input
                        className="exposure-shares-input"
                        type="number"
                        min={0}
                        inputMode="numeric"
                        aria-label={`Shares of ${row.name}`}
                        value={raw ?? String(shares)}
                        onChange={(e) =>
                          setDraftShares((prev) => ({
                            ...prev,
                            [row.platform_player_id]: e.target.value,
                          }))
                        }
                        onBlur={() => commitShares(row)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                        }}
                      />
                      <button
                        type="button"
                        className="exposure-shares-step"
                        aria-label={`Increase shares of ${row.name}`}
                        onClick={() => bumpShares(row, 1, displayed)}
                      >
                        +
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
