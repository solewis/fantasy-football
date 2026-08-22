import { platformDisplayName } from '../lib/platforms'
import './platform-tabs.css'

export type SupportedPlatform = 'sleeper' | 'espn'

const PLATFORMS: SupportedPlatform[] = ['sleeper', 'espn']

interface PlatformTabsProps {
  value: SupportedPlatform
  onChange: (platform: SupportedPlatform) => void
}

/** Sleeper/ESPN toggle shared by the Players and Rankings pages -- both are
 * platform-scoped data views (a player pool, a rank set) that need to know
 * which platform's data to read. Distinct from LeaguesPage's own platform
 * tabs, which also drive the league-id input's label/placeholder, not just
 * a data fetch. */
export function PlatformTabs({ value, onChange }: PlatformTabsProps) {
  return (
    <div className="platform-tabs" role="tablist" aria-label="Platform">
      {PLATFORMS.map((p) => (
        <button
          key={p}
          type="button"
          role="tab"
          aria-selected={value === p}
          className={`platform-tab${value === p ? ' active' : ''}`}
          onClick={() => onChange(p)}
        >
          {platformDisplayName(p)}
        </button>
      ))}
    </div>
  )
}
