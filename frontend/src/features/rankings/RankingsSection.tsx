import { useEffect, useState } from 'react'

import {
  PlatformTabs,
  type SupportedPlatform,
} from '../../components/PlatformTabs'
import { FORMATS } from '../../lib/formats'
import { BuildPage } from './BuildPage'
import { RankingsPage } from './RankingsPage'
import { SourcesPage } from './SourcesPage'
import './rankings.css'

const SUB_VIEWS = ['sources', 'build', 'edit'] as const
type SubView = (typeof SUB_VIEWS)[number]

const SUB_VIEW_LABELS: Record<SubView, string> = {
  sources: 'Sources',
  build: 'Build',
  edit: 'Edit',
}

// A view-location breadcrumb, not a source of truth -- same narrow use as
// LeaguesSection's lastLeagueId.
const VIEW_KEY = 'fantasy-draft-app:rankingsView'

function readStoredView(): SubView {
  try {
    const stored = localStorage.getItem(VIEW_KEY)
    if (stored && (SUB_VIEWS as readonly string[]).includes(stored)) {
      return stored as SubView
    }
  } catch {
    // private mode / storage disabled -- the default is fine
  }
  return 'edit'
}

/** Container for the three Rankings sub-views.
 *
 * Owns platform and format because all three share them: picking ESPN in
 * Sources and switching to Build should stay on ESPN. It renders the platform
 * and format controls exactly once -- a sub-view growing its own would give
 * you two platform togglers that can disagree.
 */
export function RankingsSection() {
  const [subView, setSubView] = useState<SubView>(readStoredView)
  const [platform, setPlatform] = useState<SupportedPlatform>('sleeper')
  const [format, setFormat] = useState('half_ppr')

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, subView)
    } catch {
      // non-fatal: the tab just won't be remembered next reload
    }
  }, [subView])

  return (
    <div className="rankings-section">
      <div className="rankings-section-bar">
        <PlatformTabs value={platform} onChange={setPlatform} />
        <select
          className="rankings-format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          aria-label="Scoring format"
        >
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <div
          className="rankings-subtabs"
          role="tablist"
          aria-label="Rankings view"
        >
          {SUB_VIEWS.map((view) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={subView === view}
              className={`rankings-subtab${subView === view ? ' active' : ''}`}
              onClick={() => setSubView(view)}
            >
              {SUB_VIEW_LABELS[view]}
            </button>
          ))}
        </div>
      </div>

      {subView === 'sources' && (
        <SourcesPage platform={platform} format={format} />
      )}
      {subView === 'build' && (
        <BuildPage
          key={`${platform}:${format}`}
          platform={platform}
          format={format}
        />
      )}
      {/* Keyed so a platform or format change remounts the view: everything it
          holds (which set is open, the working list, any half-finished inline
          rename) belongs to one scope, and resetting by hand invites a stale
          edit surviving the switch. */}
      {subView === 'edit' && (
        <RankingsPage
          key={`${platform}:${format}`}
          platform={platform}
          format={format}
        />
      )}
    </div>
  )
}
