import { useState } from 'react'

import { DraftPage } from './features/draft/DraftPage'
import { PlayersPage } from './features/players/PlayersPage'
import { RankingsPage } from './features/rankings/RankingsPage'

const TABS = ['Players', 'Rankings', 'Draft'] as const
type Tab = (typeof TABS)[number]

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('Players')

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
        {activeTab === 'Draft' && <DraftPage />}
      </main>
    </div>
  )
}

export default App
