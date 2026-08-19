import { PlayersPage } from './features/players/PlayersPage'

function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Fantasy Draft Assistant</h1>
      </header>
      <main>
        <PlayersPage />
      </main>
    </div>
  )
}

export default App
