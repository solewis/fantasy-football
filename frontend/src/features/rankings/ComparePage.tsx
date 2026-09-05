import { Fragment, useEffect, useMemo, useState } from 'react'

import {
  fetchAvailableSources,
  fetchRankPool,
  isSourceEligibleForScope,
  type AvailableSource,
  type RankPool,
} from '../../api/rankPool'
import {
  fetchRanksForSet,
  fetchRankSets,
  type RankRow,
  type RankSetSummary,
} from '../../api/ranks'
import type { SupportedPlatform } from '../../components/PlatformTabs'
import { DeltaChip } from '../../components/DeltaChip'
import { summarizeCandidates } from '../../lib/consensus'
import { boundsForSlot } from '../../lib/deltaBuckets'
import { SEASON } from '../../lib/formats'
import { moveInOrder, reconcileOrder, sortByOrder } from '../../lib/sourceOrder'
import { PositionTag } from '../players/PositionTag'
import { BuildSourcePicker } from './BuildSourcePicker'
import './build.css'
import './compare.css'
import './rankings.css'

interface ComparePageProps {
  platform: SupportedPlatform
  format: string
}

/** See at a glance how a saved rank list stacks up against other sources --
 * "source X has Garrett Wilson at WR20, 3 spots lower than you" -- for every
 * player already in the list, not just the next slot to fill.
 *
 * Deliberately read-only: this reuses the exact same sources/deltas as the
 * builder (same eligibility rule, same chip), it just renders every row of
 * an existing list instead of one slot at a time while picking.
 */
export function ComparePage({ platform, format }: ComparePageProps) {
  const [rankSets, setRankSets] = useState<RankSetSummary[]>([])
  const [baselineId, setBaselineId] = useState<number | null>(null)
  // Raw fetch results -- derived (below, alongside the effects that fetch
  // them) into what the render actually uses, so "nothing chosen yet" is a
  // plain conditional rather than a second setState call inside the effect.
  const [fetchedBaselineRows, setFetchedBaselineRows] = useState<RankRow[]>([])
  const [available, setAvailable] = useState<AvailableSource[]>([])
  const [selectedRefs, setSelectedRefs] = useState<string[]>([])
  const [fetchedPool, setFetchedPool] = useState<RankPool | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // A priority order over sources, same idea (and same persistence pattern)
  // as the builder's -- kept separate since Compare's source list excludes
  // whichever set is currently the baseline, so the two orders can diverge.
  const sourceOrderKey = `fantasy-draft-app:compareSourceOrder:${platform}:${format}`
  const [sourceOrder, setSourceOrder] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(sourceOrderKey)
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')
        ? parsed
        : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(sourceOrderKey, JSON.stringify(sourceOrder))
    } catch {
      // private mode / storage disabled -- the order just won't be remembered
    }
  }, [sourceOrder, sourceOrderKey])

  function moveSource(ref: string, direction: 'up' | 'down') {
    setSourceOrder((prev) => moveInOrder(prev, ref, direction))
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchRankSets({ platform, season: SEASON, format }),
      fetchAvailableSources({ platform, season: SEASON, format }),
    ])
      .then(([sets, sources]) => {
        if (cancelled) return
        setRankSets(sets)
        setAvailable(sources)
        setSourceOrder((prev) =>
          reconcileOrder(
            prev,
            sources.map((s) => s.ref),
          ),
        )
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'Failed to load sources',
          )
      })
    return () => {
      cancelled = true
    }
  }, [platform, format])

  const baselineSet = rankSets.find((s) => s.id === baselineId) ?? null
  const scope = baselineSet?.scope ?? null
  const baselineRows = baselineId === null ? [] : fetchedBaselineRows

  useEffect(() => {
    if (baselineId === null) return
    let cancelled = false
    fetchRanksForSet(baselineId)
      .then((rows) => {
        if (!cancelled) setFetchedBaselineRows(rows)
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'Failed to load rank set',
          )
      })
    return () => {
      cancelled = true
    }
  }, [baselineId])

  // Resets the selection whenever the baseline (and so its scope) changes --
  // a QB-only selection carrying into a WR compare wouldn't be eligible
  // anyway, but starting clean is less confusing than everything greying
  // out. React's own "adjust state during render" escape hatch, rather than
  // an effect that would just be a bare setState with no external work.
  const [selectionResetFor, setSelectionResetFor] = useState(baselineId)
  if (selectionResetFor !== baselineId) {
    setSelectionResetFor(baselineId)
    setSelectedRefs([])
  }

  // Comparing a list against itself is meaningless, so the baseline's own
  // ref never appears as a selectable source -- everything else follows the
  // same eligibility rule the builder uses (same scope only).
  const baselineRef = baselineId !== null ? `rank_set:${baselineId}` : null
  const comparableSources = useMemo(() => {
    if (scope === null) return []
    return available.filter(
      (s) => s.ref !== baselineRef && isSourceEligibleForScope(s, scope),
    )
  }, [available, scope, baselineRef])

  const orderedComparableSources = useMemo(
    () => sortByOrder(comparableSources, sourceOrder, (s) => s.ref),
    [comparableSources, sourceOrder],
  )

  const eligibleRefs = useMemo(
    () =>
      selectedRefs.filter((ref) =>
        comparableSources.some((s) => s.ref === ref),
      ),
    [selectedRefs, comparableSources],
  )
  const activeSources = useMemo(
    () => orderedComparableSources.filter((s) => eligibleRefs.includes(s.ref)),
    [orderedComparableSources, eligibleRefs],
  )

  // A stable string, not the array: an array's identity changes every render
  // and the effect would re-fire forever. The effect below derives the refs
  // it actually needs back out of this key, rather than closing over the
  // eligibleRefs array directly.
  const refsKey = [...eligibleRefs].sort().join(',')

  useEffect(() => {
    const refs = refsKey === '' ? [] : refsKey.split(',')
    if (scope === null || refs.length === 0) {
      // Corrects a stuck spinner if the last source is unchecked while its
      // fetch is still in flight -- a no-op render when nothing was loading.
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetchRankPool({
      platform,
      season: SEASON,
      format,
      scope,
      sourceRefs: refs,
    })
      .then((result) => {
        if (!cancelled) {
          setFetchedPool(result)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'Failed to load comparison',
          )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [platform, format, scope, refsKey])

  const pool = scope === null || eligibleRefs.length === 0 ? null : fetchedPool

  const ranksByPlayer = useMemo(() => {
    const map = new Map<string, Record<string, number | null>>()
    for (const player of pool?.players ?? []) {
      map.set(player.platform_player_id, player.ranks)
    }
    return map
  }, [pool])

  // Same rule as the builder's own Avg column, including ADP's exclusion
  // from it -- reused rather than reimplemented so the two can't drift.
  // excludeIds is empty here on purpose: nothing is ever "already placed" in
  // a read-only comparison, every row gets a summary.
  const averageByPlayer = useMemo(() => {
    const map = new Map<string, number | null>()
    if (!pool) return map
    for (const summary of summarizeCandidates(
      pool.players,
      eligibleRefs,
      new Set(),
    )) {
      map.set(summary.platform_player_id, summary.average)
    }
    return map
  }, [pool, eligibleRefs])

  const searchTerm = search.trim().toLowerCase()
  const rows = baselineRows.filter(
    (row) => !searchTerm || row.name.toLowerCase().includes(searchTerm),
  )

  return (
    <div className="compare-page">
      <div className="compare-toolbar">
        <select
          value={baselineId ?? ''}
          onChange={(e) =>
            setBaselineId(e.target.value ? Number(e.target.value) : null)
          }
          aria-label="My rank set"
        >
          <option value="">Choose a rank set…</option>
          {rankSets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.scope}
            </option>
          ))}
        </select>
        {baselineId !== null && (
          <input
            className="compare-search"
            type="search"
            placeholder="Find a player…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Find a player"
          />
        )}
      </div>

      {error && <p className="rankings-error">{error}</p>}

      {baselineId === null ? (
        <p className="rankings-status">
          Choose one of your rank sets to see how it compares against other
          sources, player by player.
        </p>
      ) : (
        <div className="compare-grid">
          <BuildSourcePicker
            sources={orderedComparableSources}
            selectedRefs={selectedRefs}
            eligibleCount={eligibleRefs.length}
            scope={scope ?? 'overall'}
            onToggle={(ref) =>
              setSelectedRefs((refs) =>
                refs.includes(ref)
                  ? refs.filter((r) => r !== ref)
                  : [...refs, ref],
              )
            }
            onMove={moveSource}
          />

          <div className="compare-right">
            {baselineRows.length > 0 && activeSources.length === 0 && (
              <p className="compare-hint">
                Pick a source on the left to compare against.
              </p>
            )}

            <div className="compare-table-wrapper">
              {baselineRows.length === 0 ? (
                <p className="rankings-status">This rank set is empty.</p>
              ) : rows.length === 0 ? (
                <p className="rankings-status">
                  No player matching "{search.trim()}".
                </p>
              ) : (
                <table className="compare-table">
                  <thead>
                    <tr>
                      <th>Rk</th>
                      {activeSources.length > 0 && <th>Avg</th>}
                      <th>Name</th>
                      <th>Team</th>
                      {activeSources.map((s) => (
                        <th key={s.ref} title={s.label}>
                          {s.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => {
                      const prev = index > 0 ? rows[index - 1] : null
                      // Driven by the tier *number* changing, not by the
                      // previous row's break_after -- a list saved before
                      // break weights existed has tiers but no break_after.
                      const tierChanges =
                        prev !== null &&
                        row.tier !== null &&
                        prev.tier !== null &&
                        row.tier !== prev.tier
                      const breakWeight = tierChanges
                        ? (prev!.break_after ?? 'minor')
                        : null
                      const bounds = boundsForSlot(row.rank)
                      const sourceRanks =
                        ranksByPlayer.get(row.platform_player_id) ?? {}
                      const average = averageByPlayer.get(
                        row.platform_player_id,
                      )

                      return (
                        <Fragment key={row.platform_player_id}>
                          {tierChanges && (
                            <tr
                              className={`compare-tier-divider ${breakWeight}`}
                            >
                              <td
                                colSpan={
                                  3 +
                                  (activeSources.length > 0 ? 1 : 0) +
                                  activeSources.length
                                }
                              >
                                Tier {row.tier}
                                {breakWeight === 'major' && ' · big drop'}
                              </td>
                            </tr>
                          )}
                          <tr>
                            <td className="compare-num">{row.rank}</td>
                            {activeSources.length > 0 && (
                              <td className="compare-num">
                                {average !== null && average !== undefined
                                  ? average.toFixed(1)
                                  : '—'}
                              </td>
                            )}
                            <td>
                              <PositionTag position={row.position} />
                              <span className="player-name">{row.name}</span>
                            </td>
                            <td>{row.team ?? '—'}</td>
                            {activeSources.map((s) => (
                              <td key={s.ref}>
                                <DeltaChip
                                  sourceRank={sourceRanks[s.ref] ?? null}
                                  slot={row.rank}
                                  bounds={bounds}
                                  sourceLabel={s.label}
                                  slotLabel={`your #${row.rank}`}
                                />
                              </td>
                            ))}
                          </tr>
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              )}
              {loading && (
                <p className="rankings-status">Loading comparison…</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
