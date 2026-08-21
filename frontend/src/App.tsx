import { useState } from 'react'

import { LeaguesSection } from './features/leagues/LeaguesSection'
import { PlayersPage } from './features/players/PlayersPage'
import { RankingsPage } from './features/rankings/RankingsPage'

// Draft is no longer its own tab -- it now lives inside a specific league
// (LeaguesSection drills into LeagueDetailPage, which has its own Draft
// section), with an ad-hoc/non-league path reachable as a de-emphasized
// footer link from the Leagues list rather than a top-level peer.
const TABS = ['Leagues', 'Rankings', 'Players'] as const
type Tab = (typeof TABS)[number]

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('Leagues')

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Fantasy Draft Assistant</h1>
        <nav className="app-nav" role="tablist" aria-label="Sections">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`app-nav-tab${activeTab === tab ? ' active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {activeTab === 'Players' && <PlayersPage />}
        {activeTab === 'Rankings' && <RankingsPage />}
        {activeTab === 'Leagues' && <LeaguesSection />}
      </main>
    </div>
  )
}

export default App
