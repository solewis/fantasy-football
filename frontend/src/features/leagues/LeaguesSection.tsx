import { useEffect, useState } from 'react'

import { fetchDrafts, type DraftListRow } from '../../api/draft'
import { fetchLeagues, type LeagueSummary } from '../../api/leagues'
import {
  draftSummaryFromListRow,
  type DraftSummary,
} from '../../lib/draftSummary'
import { DraftPage } from '../draft/DraftPage'
import { LeagueDetailPage } from './LeagueDetailPage'
import { LeaguesPage } from './LeaguesPage'
import './leagues.css'

const LAST_LEAGUE_KEY = 'fantasy-draft-app:lastLeagueId'

type View = 'list' | { leagueId: number } | 'adhoc'

function draftsMapFromRows(rows: DraftListRow[]): Map<number, DraftSummary> {
  return new Map(
    rows
      .filter(
        (row): row is DraftListRow & { league_id: number } =>
          row.league_id !== null,
      )
      .map((row) => [row.league_id, draftSummaryFromListRow(row)]),
  )
}

/** The Leagues tab's container: owns the leagues list, an unfiltered
 * GET /drafts fetch (one call, no per-league fan-out) turned into a
 * {league_id: draft} map for the list's "in progress" badges, and which of
 * three views is showing -- the list, a specific league's detail, or the
 * ad-hoc (non-league) draft path. */
export function LeaguesSection() {
  const [leagues, setLeagues] = useState<LeagueSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draftsByLeague, setDraftsByLeague] = useState<
    Map<number, DraftSummary>
  >(new Map())

  // A view-location breadcrumb, not a source of truth -- the server (via
  // GET /drafts?league_id=) is what actually knows whether a draft exists.
  // This just means refreshing mid-draft on draft day lands you back on the
  // same league instead of the bare list.
  const [view, setView] = useState<View>(() => {
    const stored = localStorage.getItem(LAST_LEAGUE_KEY)
    return stored ? { leagueId: Number(stored) } : 'list'
  })

  useEffect(() => {
    Promise.all([fetchLeagues(), fetchDrafts()])
      .then(([leagueRows, draftRows]) => {
        setLeagues(leagueRows)
        setDraftsByLeague(draftsMapFromRows(draftRows))
        setError(null)
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load leagues'),
      )
      .finally(() => setLoading(false))
  }, [])

  function refreshDrafts() {
    fetchDrafts()
      .then((rows) => setDraftsByLeague(draftsMapFromRows(rows)))
      .catch(() => undefined)
  }

  function handleSelectLeague(leagueId: number) {
    localStorage.setItem(LAST_LEAGUE_KEY, String(leagueId))
    setView({ leagueId })
  }

  function handleBackToList() {
    localStorage.removeItem(LAST_LEAGUE_KEY)
    setView('list')
  }

  function handleLeagueCreated(created: LeagueSummary) {
    setLeagues((prev) => [...prev, created])
  }

  function handleLeagueUpdated(updated: LeagueSummary) {
    setLeagues((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
  }

  function handleLeagueDeleted(leagueId: number) {
    setLeagues((prev) => prev.filter((l) => l.id !== leagueId))
    setDraftsByLeague((prev) => {
      const next = new Map(prev)
      next.delete(leagueId)
      return next
    })
    handleBackToList()
  }

  if (view === 'adhoc') {
    return (
      <div className="leagues-page">
        <button
          type="button"
          className="league-detail-back"
          onClick={() => setView('list')}
        >
          ← Leagues
        </button>
        <DraftPage />
      </div>
    )
  }

  if (typeof view === 'object') {
    if (loading) {
      return <p className="leagues-status">Loading…</p>
    }
    const league = leagues.find((l) => l.id === view.leagueId)
    if (league) {
      return (
        <LeagueDetailPage
          key={league.id}
          league={league}
          draft={draftsByLeague.get(league.id) ?? null}
          onBack={handleBackToList}
          onLeagueUpdated={handleLeagueUpdated}
          onLeagueDeleted={() => handleLeagueDeleted(league.id)}
          onDraftChanged={refreshDrafts}
        />
      )
    }
    // The stored breadcrumb points at a league that's gone (e.g. deleted
    // from another tab) -- fall back to the list rather than a dead end.
  }

  return (
    <LeaguesPage
      leagues={leagues}
      loading={loading}
      error={error}
      draftsByLeague={draftsByLeague}
      onLeagueCreated={handleLeagueCreated}
      onSelectLeague={handleSelectLeague}
      onStartAdHoc={() => setView('adhoc')}
    />
  )
}
