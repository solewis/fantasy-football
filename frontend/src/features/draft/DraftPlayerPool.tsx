import { Fragment, useEffect, useRef, useState } from 'react'

import { fetchDraftPools, type DraftPools } from '../../lib/fetchRankedPlayers'
import {
  POSITIONS,
  SEASON,
  type BuildPosition,
  type PositionFilter,
} from '../../lib/formats'
import { DeltaChip } from '../../components/DeltaChip'
import { PICK_BOUNDS } from '../../lib/deltaBuckets'
import { PositionTag } from '../players/PositionTag'
import '../players/players.css'
import './draft.css'

interface DraftPlayerPoolProps {
  format: string
  /** The draft's own platform (already resolved from "manual" to a real
   * platform by the caller -- see DraftRoom), used to fetch the right
   * player/ADP pool. */
  platform: string
  /** The League's assigned rank set, if this draft was created from one.
   * When set, reads that exact rank set instead of the format-based
   * "whichever set was created first" resolver. */
  rankSetId?: number | null
  /** The pick on the clock, which is what "value" and "reach" are measured
   * against. 0 once the draft is complete -- nothing is on the clock then, so
   * there's no reference point and the columns hide themselves. */
  nextPickNumber: number
  draftedIds: Set<string>
  queuedIds: Set<string>
  canDraft: boolean
  onDraft: (playerId: string) => void
  onQueue: (playerId: string) => void
}

export function DraftPlayerPool({
  format,
  platform,
  rankSetId,
  nextPickNumber,
  draftedIds,
  queuedIds,
  canDraft,
  onDraft,
  onQueue,
}: DraftPlayerPoolProps) {
  const [position, setPosition] = useState<PositionFilter>('ALL')
  const [sortBy, setSortBy] = useState<'rank' | 'adp'>('rank')
  const [search, setSearch] = useState('')
  const [pools, setPools] = useState<DraftPools | null>(null)
  const [error, setError] = useState<string | null>(null)
  // format/platform/rankSetId are props here (owned by the parent's draft
  // setup), not a local selector, so there's no local event handler to set a
  // "loading" flag from synchronously. Instead, "loading" is derived below
  // from whether the most recently *loaded* key (set only from the async
  // callbacks) matches the current one.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const currentKey = `${platform}:${format}:${rankSetId ?? 'none'}`

  useEffect(() => {
    let cancelled = false
    const key = `${platform}:${format}:${rankSetId ?? 'none'}`

    fetchDraftPools(SEASON, format, rankSetId, platform)
      .then((result) => {
        if (cancelled) return
        setPools(result)
        setError(null)
        setLoadedKey(key)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load players')
        setLoadedKey(key)
      })

    return () => {
      cancelled = true
    }
  }, [format, platform, rankSetId])

  const loading = loadedKey !== currentKey

  const searchTerm = search.trim().toLowerCase()

  // A position tab shows the list you built for that position -- its own
  // order, tiers and target/fade marks -- rather than the overall list
  // filtered down, which would throw all of that away. Positions you haven't
  // built a list for (and K/DEF, which have none) fall back to filtering.
  const positionalRows =
    position !== 'ALL'
      ? pools?.byPosition[position as BuildPosition]
      : undefined
  const usingPositionalList = positionalRows !== undefined
  const sourceRows = positionalRows ?? pools?.overall ?? []

  // Only on the overall board. Within a position tab, rank is a positional
  // rank (WR7) and comparing it to an overall pick number is nonsense.
  // 0 means the draft is over -- nothing is on the clock to measure against.
  const showValue = position === 'ALL' && nextPickNumber > 0

  // Drafted players stay in the list, grayed out, rather than disappearing --
  // seeing the whole tier (who's gone, who's left) is the point of a tier in
  // the first place, and a tier silently shrinking hides exactly the thing
  // you'd want to notice ("I'm down to the last player in this tier").
  const filteredRows = sourceRows.filter((row) => {
    if (!usingPositionalList && position !== 'ALL' && row.position !== position)
      return false
    if (searchTerm && !row.name.toLowerCase().includes(searchTerm)) return false
    return true
  })

  // Sorted by ADP is a different view of the same players, not a different
  // list -- it's for seeing where the field has them, not for re-ranking.
  // Tiers and the "past your ranks" boundary are properties of your own rank
  // order, so both are suppressed here: they'd land on arbitrary rows once
  // adjacency no longer follows your list.
  const rows =
    sortBy === 'adp'
      ? [...filteredRows].sort((a, b) => {
          if (a.adp === null && b.adp === null) return 0
          if (a.adp === null) return 1
          if (b.adp === null) return -1
          return a.adp - b.adp
        })
      : filteredRows

  // Rk, ADP, Name, Team, Actions, plus the two value/reach columns when shown.
  const columnCount = showValue ? 7 : 5

  const sourceName =
    position === 'ALL'
      ? pools?.overallSourceName
      : (pools?.positionalSourceNames[position as BuildPosition] ?? null)

  // Drafted players stay visible (see above), so "the top of the list" and
  // "the first player you could actually take" often aren't the same row --
  // switching tabs with a leftover scroll position from a different position
  // could land on a wall of drafted names. Scrolls to whichever row is first
  // available in the *current* sort/filter, not just row 0.
  const firstAvailableId =
    rows.find((row) => !draftedIds.has(row.platform_player_id))
      ?.platform_player_id ?? null
  const wrapperRef = useRef<HTMLDivElement>(null)
  const firstAvailableRowRef = useRef<HTMLTableRowElement | null>(null)

  useEffect(() => {
    const wrapper = wrapperRef.current
    const row = firstAvailableRowRef.current
    if (!wrapper || !row) return
    const headerHeight =
      wrapper.querySelector('thead')?.getBoundingClientRect().height ?? 0
    const delta =
      row.getBoundingClientRect().top -
      wrapper.getBoundingClientRect().top -
      headerHeight
    wrapper.scrollTop = Math.max(0, wrapper.scrollTop + delta)
    // Deliberately keyed on position alone -- a pick landing (which changes
    // firstAvailableId within the same tab) must not yank the scroll
    // position out from under someone still browsing this tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position])

  return (
    <div className="draft-pool">
      <div className="draft-pool-toolbar">
        <input
          className="draft-pool-search"
          type="text"
          placeholder="Find player"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div
        className="position-tabs"
        role="tablist"
        aria-label="Filter by position"
      >
        {POSITIONS.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={position === p}
            className={`position-tab${position === p ? ' active' : ''}`}
            onClick={() => setPosition(p)}
          >
            {p}
          </button>
        ))}
      </div>

      {usingPositionalList && (
        <p className="draft-pool-list-note">
          Using your {position} list
          {sourceName && <> — “{sourceName}”</>} — its own order, tiers and
          marks.
        </p>
      )}
      {position === 'ALL' &&
        (pools?.source === 'saved' ? (
          <p className="draft-pool-list-note">
            Using{sourceName ? <> “{sourceName}”</> : ' your saved ranks'} —
            everyone else follows by ADP below it.
          </p>
        ) : (
          pools !== null && (
            <p className="draft-pool-list-note">
              Using ADP — no saved rank list for this format.
            </p>
          )
        ))}

      <div className="draft-pool-table-wrapper" ref={wrapperRef}>
        {loading && pools === null ? (
          <p className="draft-pool-status">Loading…</p>
        ) : error ? (
          <p className="draft-pool-error">{error}</p>
        ) : rows.length === 0 ? (
          <p className="draft-pool-status">No players left.</p>
        ) : (
          <table className="draft-pool-table">
            <thead>
              <tr>
                <th>
                  <button
                    type="button"
                    className={`draft-pool-sort-btn${sortBy === 'rank' ? ' active' : ''}`}
                    onClick={() => setSortBy('rank')}
                    title="Sort by your rank"
                  >
                    Rk
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    className={`draft-pool-sort-btn${sortBy === 'adp' ? ' active' : ''}`}
                    onClick={() => setSortBy('adp')}
                    title="Sort by ADP"
                  >
                    ADP
                  </button>
                </th>
                {showValue && (
                  <>
                    <th title="Where this player usually goes, against the pick on the clock">
                      vs ADP
                    </th>
                    <th title="Where you have this player, against the pick on the clock">
                      vs You
                    </th>
                  </>
                )}
                <th>Name</th>
                <th>Team</th>
                <th aria-hidden="true"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const prev = index > 0 ? rows[index - 1] : null
                // Driven by the tier *number* changing, not by the previous
                // row's break_after -- a list saved before break weights
                // existed has tiers but no break_after at all.
                const tierChanges =
                  sortBy === 'rank' &&
                  prev !== null &&
                  row.tier !== null &&
                  prev.tier !== null &&
                  row.tier !== prev.tier
                const breakWeight = tierChanges
                  ? (prev!.break_after ?? 'minor')
                  : null
                const drafted = draftedIds.has(row.platform_player_id)
                const unrankedStart =
                  sortBy === 'rank' &&
                  row.unranked &&
                  prev !== null &&
                  !prev.unranked

                return (
                  <Fragment key={row.platform_player_id}>
                    {tierChanges && (
                      <tr className={`draft-pool-tier-divider ${breakWeight}`}>
                        <td colSpan={columnCount}>
                          Tier {row.tier}
                          {breakWeight === 'major' && ' · big drop'}
                        </td>
                      </tr>
                    )}
                    <tr
                      ref={
                        row.platform_player_id === firstAvailableId
                          ? firstAvailableRowRef
                          : undefined
                      }
                      className={[
                        drafted ? 'drafted' : '',
                        row.flag ? `flag-${row.flag}` : '',
                        row.unranked ? 'unranked' : '',
                        // The first row past your own list, so you can see at
                        // a glance that you're off the end of your ranks.
                        unrankedStart ? 'unranked-start' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <td>{row.rank}</td>
                      <td>{row.adp !== null ? row.adp.toFixed(1) : '—'}</td>
                      {showValue && (
                        <>
                          <td>
                            <DeltaChip
                              sourceRank={
                                row.adp !== null ? Math.round(row.adp) : null
                              }
                              slot={nextPickNumber}
                              bounds={PICK_BOUNDS}
                              sourceLabel="ADP"
                              slotLabel={`pick ${nextPickNumber}`}
                            />
                          </td>
                          <td>
                            <DeltaChip
                              sourceRank={row.unranked ? null : row.rank}
                              slot={nextPickNumber}
                              bounds={PICK_BOUNDS}
                              sourceLabel="Your rank"
                              slotLabel={`pick ${nextPickNumber}`}
                            />
                          </td>
                        </>
                      )}
                      <td>
                        <PositionTag position={row.position} />
                        <span className="player-name">{row.name}</span>
                        {row.flag === 'target' && (
                          <span
                            className="draft-pool-flag target"
                            title="You marked this player a target"
                          >
                            target
                          </span>
                        )}
                        {row.flag === 'fade' && (
                          <span
                            className="draft-pool-flag fade"
                            title="You marked this player a fade"
                          >
                            fade
                          </span>
                        )}
                        {unrankedStart && (
                          <span className="draft-pool-unranked-note">
                            past your ranks — ADP order below
                          </span>
                        )}
                      </td>
                      <td>{row.team ?? '—'}</td>
                      <td className="draft-pool-actions">
                        {canDraft && !drafted && (
                          <button
                            type="button"
                            onClick={() => onDraft(row.platform_player_id)}
                          >
                            Draft
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onQueue(row.platform_player_id)}
                          disabled={
                            drafted || queuedIds.has(row.platform_player_id)
                          }
                        >
                          {drafted
                            ? 'Drafted'
                            : queuedIds.has(row.platform_player_id)
                              ? 'Queued'
                              : '+ Queue'}
                        </button>
                      </td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
