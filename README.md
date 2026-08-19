# Fantasy Draft Assistant

A personal tool to help run a smarter fantasy football draft: build your own player rankings from multiple sources, track a live draft as it happens, and see at a glance how a player's ADP, platform rank, and your rank compare when it's time to pick.

Local-only, fired up for drafts a few times a year — not a hosted/always-on service.

## Prior art

`../draft-tool/` has earlier scripts worth mining for ideas (not reused directly):
- `sleeper-rerun.py` — polls Sleeper's draft-picks endpoint and pushes updates into a Google Sheet, pausing on your own pick. Confirms the Sleeper polling approach works.
- `yahoo.py` — a started-but-abandoned Yahoo OAuth2 integration (`yahoo_fantasy_api`), stopped right after listing league IDs.
- `update_sleeper_id.py` — matches Sleeper's player list against a sheet by name to backfill Sleeper player IDs.

## Leagues

You play in 3 leagues, each with different settings (scoring format, roster slots, etc.), possibly on different platforms. The app needs a **League Setup** concept:

- Add a league: platform (Sleeper / ESPN / Yahoo / manual), platform league ID, connection info (Sleeper: none needed; ESPN: cookies; Yahoo: OAuth tokens)
- Pull/store each league's settings (scoring type, roster slots/positions, number of teams)
- Associate each league with a ranking set/tiers — since scoring format changes player value (PPR vs standard, superflex, etc.), rankings need to be scoped per format, not global

## Deferred: rankings builder

Building/aggregating ranks in-app is deferred — doing this in Google Sheets instead (manual control, familiar tool, no need to build a rank-editing UI). The app's job is to **consume** the finished ranks/tiers, not produce them.

- Final ranks/tiers per league-format live in a Google Sheet, imported via `gspread` + a service account (already working in `draft-tool/update_sleeper_id.py` and `sleeper.py` — same auth pattern, new sheet/columns)
- App reads: player, position, overall rank, tier, per league-format
- Re-sync from Sheets on demand (e.g. before each draft, or on a refresh button) rather than continuous two-way sync

## Core features — draft view is the primary focus

### 1. Draft view (the main screen, live during a draft)
- **By position**: each position (QB/RB/WR/TE/etc.) shown separately with your tiers visible, so you can see who's left in a tier at a glance
- **Overall**: full rank list across positions, same tiering
- Both views only show undrafted players (picked players drop off / gray out)
- **ADP value indicator** per player: current pick number vs. their ADP — reach (picked well before ADP) or value/falling (still here well past ADP), shown as a delta or a simple visual cue
- **Availability-at-next-pick estimate**: given your next pick number (snake order) and how many picks happen before then, estimate the odds a given player is still available when it's your turn — starting heuristic: compare the player's ADP against the number of intervening picks and how many players with similar-or-better ADP remain; refine later if needed
- Mark players drafted (via Sleeper live sync or manual click) — updates all views instantly

### 2. Live draft tracker (supporting the draft view)
- Track draft order, current pick number, whose turn it is
- Mark players as picked, either via platform sync (Sleeper live polling to start) or manual entry
- Works standalone (fully manual) if not integrating with a platform

### 3. Draft board visual
- Grid view of all teams and their filled roster slots, updated as picks come in
- At-a-glance view of positional need across the league (who's still light at RB, etc.)

## Data sources & known challenges

- **Your ranks/tiers**: Google Sheet, imported via `gspread` (see Deferred section above).
- **ADP**: Sleeper's (undocumented) projections endpoint (`api.sleeper.com/projections/nfl/{season}`) returns ADP alongside projections, already keyed to Sleeper's own player IDs, across std/PPR/half-PPR/2QB/dynasty/IDP formats — no external CSV source or name-matching needed. See "Player name matching" and Phase 4 below for the caveat (it's undocumented and could change).
- **Platform rank**: not obviously exposed by these APIs either (needs more digging per-platform — may require scraping their public rankings pages). Lower priority now that draft view leans on your Sheet ranks + ADP.
- **Rank scoping**: rankings/tiers need to vary by scoring format/roster settings, so the data model should key rankings off "format" (e.g. PPR/Superflex/Standard) rather than assuming one global rank list.
- **Availability-at-next-pick math**: needs a defined methodology — start simple (ADP vs. picks remaining before your turn) and note as an open question whether it's worth modeling further.

## Player name matching (the tricky part)

Decision: **no universal cross-platform player table for v1.** Since each league lives on exactly one platform, that platform's own player list (e.g. Sleeper's `/v1/players/nfl`) is the canonical set of players for that league — every pick, rank, and ADP row for that league ultimately resolves to that platform's player ID. This sidesteps needing a Sleeper/ESPN/Yahoo crosswalk entirely for now.

What's left is a narrower, but real, problem: your rank Sheet uses free-text names typed by humans, which won't always match the platform's name exactly (suffixes like Jr./Sr./II/III, "D.J." vs "DJ", defense entries like "49ers D/ST" vs "San Francisco", accented characters, nicknames). Fix it once as a shared **reconciliation tool**, not a one-off script:

1. **Normalize** both sides (lowercase, strip punctuation/suffixes/whitespace) and try an exact match on the normalized key first — this alone should resolve the large majority of names.
2. **Fuzzy match** whatever's left (e.g. `rapidfuzz`) against the platform's player list, using position (and team, if available) as a tie-breaker, producing a ranked list of candidates with a confidence score.
3. **Manual review** for anything below a confidence threshold or with multiple close candidates — a small review screen (or even just a CLI list to start) showing the source name next to its candidates so you pick the right one or mark "no match."
4. **Persist confirmed mappings** keyed by (platform, normalized source name) so once a name is resolved, every future import (next week, next season) auto-resolves it instantly — only genuinely new names (rookies, typos, new sources) need review each time.

**ADP turned out not to need this tool.** The original plan was an ADP CSV (e.g. FantasyPros) needing the same name-matching as the Sheet. Instead, Sleeper's own (undocumented) projections endpoint returns ADP already keyed to Sleeper's `player_id` — see Phase 4 below. So for now the reconciliation tool has exactly one real consumer (the rank Sheet, Phase 3, currently on hold); it's still built as a standalone module rather than baked into the Sheet importer, since a second source (a different platform's ranks, a different ADP source if Sleeper's endpoint disappears) is plausible enough to be worth the separation.

## Platform integration plan

| Platform | API | Auth | Verdict |
|---|---|---|---|
| Sleeper | Public REST API, well documented | None | Build v1 live integration here first |
| ESPN | Unofficial/reverse-engineered | None for public leagues; cookie harvest (`espn_s2`/`SWID`) for private | v2 stretch, expect fragility/breakage each season |
| Yahoo | Official Fantasy Sports API | OAuth2 app registration + login flow | v2/v3 stretch, most setup overhead but most sanctioned |

Manual entry is always available as a fallback, regardless of platform.

## Technology stack

Why each piece is here, and what it actually does in this app — not just a name-drop list.

### Backend

| Technology | Why we chose it | What it contributes here |
|---|---|---|
| **Python 3.12** | Chosen over sticking with Node/Express (which the user already knows well) partly to rebuild professional Python fluency in a practical project, and partly because Python's ecosystem is a genuinely better fit for this app's hardest problem — fuzzy-matching human-typed names against a platform's player list. | All backend logic: ingestion scripts, the matching pipeline, the API. |
| **FastAPI** | Modern, type-hint-driven — request/response shapes are just Python classes (Pydantic models), and it validates them automatically. Pairs naturally with Python's type hints rather than fighting them. | Defines the HTTP routes (`/health`, `/players`), request validation, and response typing (`PlayerRow`). |
| **uvicorn** | The ASGI server FastAPI's own docs point you to — it's what actually opens a socket and speaks HTTP, since FastAPI itself only defines *what to do* with a request, not how to receive one (unlike Express, which bundles this into Node itself — see conversation history for the fuller explanation). | Runs the dev server (`uvicorn app.main:app --reload`), auto-restarting on code changes. |
| **SQLAlchemy** | The standard, mature Python ORM/SQL toolkit — lets tables be defined as typed Python classes instead of hand-written SQL, and provides a query API used consistently across ingestion, matching, and the players endpoint. | `PlatformPlayer`, `NameMapping`, `AdpEntry` models; every DB read/write in the app goes through it. |
| **SQLite** | A single local file with zero server process to install, configure, or keep running — exactly right for an app that's local-only and fired up a few times a year, not a hosted multi-user service. | `backend/data/app.db` (gitignored) — holds every synced Sleeper player and ADP row. |
| **httpx** | A modern HTTP client supporting both sync and async, with a cleaner API than `requests` for this kind of use. | All outbound calls to Sleeper's REST/projections endpoints. |
| **truststore** | Discovered a real need for it: `httpx`'s bundled `certifi` CA list didn't include the intermediate CA Sleeper's certificate chains through, causing TLS verification failures unrelated to any corporate proxy. `truststore` delegates verification to the OS's own trust store instead (the same one `curl` uses), fixing this without disabling verification. | Used in every outbound HTTP client (`app/ingest/sleeper.py`, `app/ingest/sleeper_adp.py`). |
| **rapidfuzz** | A fast (C++-backed) fuzzy string-matching library — needed because rank-sheet/ADP source names won't always match a platform's exact player name (nicknames, suffixes, typos). | Powers candidate scoring in `app/matching/candidates.py`. |
| **ruff** | One fast tool doing the job of both a linter and a formatter (replacing the flake8 + black combo), with sane defaults. | `ruff check` / `ruff format --check` in CI and locally. |
| **pytest** | Python's de facto standard test framework. | All 49+ backend tests — run against fixtures and in-memory SQLite, never live APIs. |

### Frontend

| Technology | Why we chose it | What it contributes here |
|---|---|---|
| **React** | The most widely used frontend framework, and a deliberate choice to build real frontend skill alongside the backend Python skill-building goal. | The entire UI — currently the players management panel (`src/features/players/`). |
| **Vite** | The modern default build tool/dev server for a new React project (supersedes older tooling like Create React App) — fast HMR, minimal config. | `npm run dev` (hot-reloading dev server), `npm run build` (not yet used since the app isn't deployed). |
| **TypeScript** | Static typing over plain JS catches shape mismatches (e.g. an API response missing a field) at compile time instead of at runtime in the browser. | `PlayerRow` type shared between the API client and components; `tsc --noEmit` typecheck in CI. |
| **Vitest** | Vite's native test runner — reuses the same config/transform pipeline as the dev server instead of needing a separate test bundler setup. | All frontend tests (`App.test.tsx`, `PlayersPage.test.tsx`). |
| **React Testing Library** | Encourages testing components the way a user actually interacts with them (by visible text/role), not their internal implementation details. | Rendering/query logic in the frontend test suite. |
| **oxlint** | A very fast Rust-based linter — caught a real bug during development (a `setState`-synchronously-in-an-effect pattern that risked a cascading render). | `npm run lint` in CI. |
| **Prettier** | The standard formatter for JS/TS/CSS — added specifically because nothing was checking frontend formatting before this. | `npm run format` / `format:check` in CI. |

### Data sources

| Source | Why we chose it | What it contributes here |
|---|---|---|
| **Sleeper's public REST API** (`api.sleeper.app`) | The only one of the three platforms (Sleeper/ESPN/Yahoo) offering a fully public, no-auth, well-documented API — see the platform integration table above for why the others are deferred. | The canonical player list (`PlatformPlayer`) for any Sleeper league. |
| **Sleeper's projections endpoint** (`api.sleeper.com`, undocumented) | Found by testing the URL directly (a user tip, not something in any official reference) — it returns real ADP across every scoring format needed, already keyed to Sleeper's own player IDs, eliminating the originally-planned FantasyPros CSV + name-matching step entirely (see Phase 4 below). | `AdpEntry` rows. |
| **Google Sheets, via `gspread`** *(planned, Phase 3 on hold)* | You already build your ranks/tiers manually in a Sheet — no reason to build a rank-editing UI when that workflow already works. The `gspread` + service-account auth pattern is already proven in `draft-tool/`. | Not wired up yet — will feed `MyRank` once Phase 3 resumes. |

### Infrastructure

| Technology | Why we chose it | What it contributes here |
|---|---|---|
| **GitHub Actions** | Free for a personal/private repo at this scale, and integrates directly with the GitHub repo already hosting the code — no separate CI account or service to configure. | `.github/workflows/ci.yml` — lint/format/typecheck/tests on every push and PR. |
| **pyenv** | Manages the isolated Python 3.12 virtualenv (`fantasy-draft-app`) this project runs in, pinned via `backend/.python-version`, keeping it separate from other Python projects/system Python on the same machine. | Local backend environment isolation. |

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push/PR: backend (`ruff check`, `ruff format --check`, `pytest`) and frontend (`oxlint`, `prettier --check`, `tsc --noEmit`, `vitest`) as separate jobs. Free tier easily covers a personal project's usage.

## Getting started (Phase 0 scaffold)

Backend (FastAPI, Python 3.12 via a pyenv virtualenv named `fantasy-draft-app` — `backend/.python-version` pins it):

```
cd backend
pip install -r requirements-dev.txt
pytest              # run tests
uvicorn app.main:app --reload   # run dev server, http://127.0.0.1:8000/health
```

Frontend (Vite + React + TypeScript):

```
cd frontend
npm install
npm test            # run tests (vitest)
npm run dev         # run dev server, http://localhost:5173
```

Current state: Phase 0 scaffold, Phase 1 (Sleeper player list ingestion), Phase 2 (name-matching/reconciliation tool), Phase 4 (Sleeper ADP ingestion), and a players management panel with in-UI data sync (frontend, ahead of the Phase 5 draft view) done. Phase 3 (rankings Sheet import) is intentionally on hold for now.

Sync Sleeper's player list and ADP into local SQLite (`backend/data/app.db`, gitignored) — either from the terminal:

```
cd backend
python -m scripts.sync_sleeper_players
python -m scripts.sync_sleeper_adp 2026    # season defaults to 2026 if omitted
```

...or from the UI itself: with both dev servers running (see below), open http://localhost:5173 — the small bar above the players table shows when players/ADP were each last synced (and how many rows exist right now), with **Sync players**/**Sync ADP** buttons to trigger a fresh import on demand. Both paths share the same underlying sync logic (`app/sync_service.py`), so status stays accurate regardless of which one you use.

**Note for future HTTP-fetching phases (ESPN, Yahoo)**: on this machine, `httpx`'s default `certifi` CA bundle fails to verify some sites (e.g. Sleeper's cert chains through a newer Google Trust Services intermediate `certifi` doesn't have yet) — unrelated to the corporate TLS-inspection proxy also present here. Fixed by using the `truststore` package to delegate verification to macOS's native trust store (same as `curl`), see `app/ingest/sleeper.py::_new_client`. Reuse this pattern for any new outbound HTTP client rather than reaching for `verify=False`.

**Note on migrations**: skipped Alembic for now — the schema is still small and stable enough to not justify migration tooling yet. `Base.metadata.create_all()` runs once at API startup (`app/main.py`) and again in each CLI sync script, so any new table (like `SyncStatus`, added alongside the sync panel) is created automatically the next time either runs — idempotent, never touches existing tables. Revisit once the schema has multiple evolving tables (Phase 3+). (Caught a real gap here during development: `create_all()` had only ever been wired into the CLI scripts, not the API server itself — a brand-new table silently 500'd until this was fixed.)

Name-matching module (`app/matching/`) is standalone for now — not yet wired to a real Sheet (that's Phase 3, on hold). Given a list of `{"name", "position"}` rows and a platform's player list, `resolve_rows()` returns each row's status (`auto_matched` / `needs_review` / `confirmed_no_match`) plus, for review cases, ranked candidates. Confirming a match via `confirm_mapping()` persists it so future imports skip straight to `auto_matched` for that name. Verified against the real 12k-player Sleeper dataset: suffix/punctuation cases (Jr./Sr./II/III, "D.J.") auto-match correctly, DST entries surface the right candidate for review, and made-up names correctly stay unresolved rather than being force-matched.

**ADP ingestion** (`app/ingest/sleeper_adp.py`) pulls from `api.sleeper.com/projections/nfl/{season}` — an undocumented endpoint (not part of Sleeper's published `api.sleeper.app` docs), found by testing the URL directly rather than via any official reference, so treat it as more fragile than the player-list endpoint: it could change or disappear without notice. Each projection row carries several `adp_<format>` stats (`std`, `ppr`, `half_ppr`, `2qb`, `dynasty_*`, `idp_*`); Sleeper uses `999`/`999.0` as a sentinel for "not applicable in this format" (e.g. `adp_rookie` on a veteran) rather than omitting the key, so those are filtered out in `parse_adp_entries`. No name-matching needed here — rows are already keyed to Sleeper's own `player_id`. Verified against live 2026 season data: 6,799 real ADP rows synced, spot-checked against Josh Allen's values across all formats, idempotent on re-run.

**Data sync management** (`app/sync_service.py`, `app/api/sync.py`, `SyncStatus` model, `SyncPanel` frontend component): makes ingestion manageable from the UI instead of only the terminal. `SyncStatus` stores one upserted row per `(sync_type, season)` — just a timestamp, not a count, since record counts are always computed live from the actual `PlatformPlayer`/`AdpEntry` tables (`get_status()`) rather than cached, so the displayed count can never drift from what's really in the DB. Both CLI scripts and the new `POST /sync/players` / `POST /sync/adp` endpoints call the same `sync_players()`/`sync_adp()` functions, so status tracking can't fall out of sync depending on which path you use. The frontend bar above the players table shows "last synced" (via `Intl.RelativeTimeFormat`) and record count for both players and ADP, with a button to trigger each; on success it bumps a refresh counter that makes the players table re-fetch automatically. Verified with real triggered syncs against the live Sleeper API from the browser (not just mocked in tests).

A real test-isolation bug surfaced while building this: two API test files were each setting `app.dependency_overrides[get_db]` at module level with their own separate in-memory DB — since FastAPI's `app` singleton is shared process-wide, whichever test file's import happened to run last silently won for the *entire* test session, breaking the other file's tests depending on collection order. Fixed with a shared `api_client` fixture (`tests/conftest.py`) that creates a fresh isolated DB per test function. Worth remembering for any future API test file: use the fixture, don't repeat the module-level pattern.

**Players management panel** (frontend, built ahead of Phase 5 as a data-review tool): `GET /players` (`app/api/players.py` + `app/players.py`) joins `PlatformPlayer`/`AdpEntry` and returns the full set of players ranked by ADP for a given platform/season/format — only players with a real ADP entry for the selected format are included. The endpoint still accepts optional `position`/`search` query params, but the frontend no longer uses them for filtering (see below); the React page (`src/features/players/`) renders the result as a table with position tabs (All/QB/RB/WR/TE/K/DEF), a free-text search box, and a scoring-format dropdown, loosely modeled on a reference draft-tool UI the user liked. Columns are intentionally scoped to what current data supports (rank, ADP, name, position, team) — auction value/VORP/pick-availability-% columns from the reference are deferred until the data/math behind them exists (the last one is literally Phase 7). Position colors use the dataviz skill's default categorical palette (first 6 of 8 hues, validated on the adjacent-CVD pairlist — the documented ceiling for 6 unfoldable categories is 3-slot all-pairs guarantees, so this is the best achievable rather than a perfect solve); the position abbreviation is always shown as text too, so identity is never color-alone. Verified against live data in the browser: filtering, search, and format switching all work correctly against the real 2026 dataset.

Position/search filtering was moved **client-side** shortly after the initial build: the backend already returns the full unpaginated set for a format (typically a few hundred to ~1,000 rows), so re-hitting the network on every tab click or keystroke had no real benefit — the frontend now fetches once per format change and filters the already-downloaded list in the browser. The debounce hook this originally needed for search was removed entirely as a result. One side effect: the `Rk` column shows each player's *overall* ADP rank rather than renumbering 1..N within a filtered view (e.g. filtering to RB shows ranks like 1, 2, 5, 6, 9...) — matching how most draft tools present rank as a property of the player, not the current view.

**In-app rankings builder** (`app/ranks.py`, `app/api/ranks.py`, `MyRank` model, `RankingsPage`/`reorder.ts` frontend): the first of two planned paths to build your ranks — an in-app drag-and-drop builder, with a Sheet-based upload still deferred as the other. Pick a scoring format; if you've never saved ranks for that format, the page seeds itself from the current ADP order (reusing the players endpoint, not a separate "seed" endpoint) and shows a note that you're starting from ADP. **Save Ranks** sends the complete current order to `PUT /ranks`, which always fully replaces the saved set for that (platform, season, format) rather than diffing — a rank list only ever has one current order, so there's nothing to reconcile.

Reordering is **live**, not drop-only: the table reshuffles on every `dragover`, not just on `drop`, matching how most sortable-list UIs behave. Which row you're hovering plus whether the cursor is past that row's vertical midpoint (top half vs. bottom half) determines where the dragged player would land if released right now — this is also what makes moving exactly one spot possible; an earlier "always insert before the target" version made hovering the very next row a no-op (you had to skip past it to see any movement), which is exactly what prompted this rework. A small "drop here to move to the end" zone at the bottom of the table exists because "insert before some row" can't otherwise express "last position."

The reorder math (`reorderList()`, `isBelowMidpoint()`) is pure and DOM-free, thoroughly unit tested with plain numbers/arrays — the drag-and-drop UI is a thin event-wiring layer around it (reads `event.clientY` and `getBoundingClientRect()`, calls the pure functions, no DOM logic of its own), per this project's practice of keeping calculation logic separate from I/O. That separation mattered for testing too: jsdom's `DragEvent` doesn't actually implement `clientY` (reads back `undefined`), so component tests can't rely on `fireEvent.dragOver(el, { clientY })` — they force it through with a raw `Event` + `Object.defineProperty`, while the cursor-position math itself is tested directly via `isBelowMidpoint()` with plain numbers, sidestepping the jsdom gap entirely.

A real bug surfaced while verifying this live in the browser (not caught by the component tests): `handleDrop` originally read the dragged player's id from React *state*, captured in a closure. Component tests passed because Testing Library's `fireEvent` forces a synchronous flush between events, but a genuine rapid `dragstart` → `drop` sequence in the real browser can fire before React re-renders — so the drop handler's closure still saw the *previous* render's (stale) value, silently no-opping the reorder. Fixed by tracking the dragged id in a `ref` (updated synchronously, no render dependency) for the actual drop logic, keeping state only for the "currently dragging" CSS highlight. Worth remembering for any future drag-and-drop: don't trust component tests alone here, since `act()`-wrapped test events can mask exactly this kind of real-world timing bug — verify live drag interactions in an actual browser too.

## Rough data model (draft)

- `League` — platform, platform_league_id, scoring format, roster settings, connection config
- `PlatformPlayer` — cached copy of a platform's own player list (platform, platform_player_id, name, position, team) — the canonical player identity *within that league's platform*
- `NameMapping` — (platform, source_type [`sheet_rank` / `adp`], source_name_raw, normalized_name, platform_player_id, confirmed_by_user) — the persisted output of the reconciliation tool, reused on every future import
- `MyRank` — (platform, season, format, platform_player_id, rank) — your saved rank order. Scoped like `AdpEntry` (platform/season/format) rather than to a `League`, since leagues aren't modeled yet and a league's actual rank set is just whichever format matches its scoring settings. No tiers yet. Built via the in-app drag-and-drop rankings builder (seeded from ADP, no `NameMapping` needed); a Sheet-based upload is a separate, still-deferred path onto this same table
- `AdpEntry` — (platform, platform_player_id, season, format, adp) — from Sleeper's projections endpoint, no `NameMapping` needed (already keyed to platform player IDs)
- `SyncStatus` — (sync_type, season, last_synced_at) — one upserted row per sync type; record counts are always computed live from the tables above, never cached here
- `Draft` — league, platform draft ID (if synced), draft order, status
- `DraftPick` — draft, pick number, platform_player_id, team/roster

## Open questions

- What's the actual availability-at-next-pick formula — simple ADP-vs-picks-remaining heuristic, or something more involved?
- Exact Sheet layout/columns for the rank/tier import (one tab per league-format? one tab with a format column?) — the Sheet-upload half of Phase 3 is still on hold; the in-app builder half is done.
- Should tiers get added to the in-app rankings builder (e.g. a visual divider you can drag between rows), or is rank order alone enough for now?
- Which `adp_*` format(s) map to which of your 3 leagues' actual settings (std/ppr/half_ppr/2qb/dynasty variants)?
- Where do we source "platform rank" per site, if we still want it later — scraping vs. is there an easier API path?
- Do the 3 leagues actually differ enough in format that they need distinct rank sets, or do some share one (e.g. two are both "12-team PPR")?
- How/where to store Yahoo OAuth tokens and ESPN cookies securely and locally (e.g. `.env`, gitignored config file)?

## Engineering practices

Since "well tested and maintainable" is a goal, not just a feature list, a few ground rules apply across every phase:

- **Backend tests**: `pytest`. **Frontend tests**: `vitest` + React Testing Library.
- Keep calculation logic (name normalization, fuzzy-match scoring, ADP delta, availability estimate) as **pure functions**, separate from I/O (HTTP calls, Sheets, DB) — pure functions are trivial to unit test with plain fixtures and don't need mocking gymnastics.
- Tests never hit live external APIs (Sleeper/ESPN/Yahoo/Sheets) — use small recorded/fixture JSON responses so the suite is fast, deterministic, and doesn't depend on a draft actually being active.
- FastAPI API tests use the shared `api_client` fixture (`tests/conftest.py`), never a module-level `app.dependency_overrides[get_db]` — the latter is a real footgun: since FastAPI's `app` is a process-wide singleton, whichever test file happens to import last silently wins for the *entire* test session, breaking other files' isolation in a way that depends on collection order (this actually happened once — see the sync-panel writeup above).
- Each phase below ends with a **"done when"** bar (tests green + a manual smoke check). Don't start the next phase until the current one clears its bar — that's the "measured" part.

## Phased implementation plan

**Phase 0 — Scaffolding**
Repo structure for the FastAPI backend + Vite/React frontend, SQLite + migrations (e.g. Alembic), linting/formatting, and test runners wired up.
*Done when*: a trivial backend test and frontend test both run green, and the app boots locally end-to-end (empty screens are fine).

**Phase 1 — Platform player list ingestion**
Fetch and cache a platform's player list (Sleeper first) into `PlatformPlayer`.
*Done when*: ingestion is unit tested against a saved fixture response (no live call in tests), and running it for real against Sleeper populates the DB correctly.

**Phase 2 — Name-matching / reconciliation tool**
The normalize → exact-match → fuzzy-match → manual-review → persist pipeline described above, built as a standalone reusable module (not tied to Sheets or ADP yet).
*Done when*: a solid unit test suite covers the tricky cases (Jr./Sr./II/III, punctuation, D/ST entries, ambiguous fuzzy matches), and confirmed mappings are proven to be skipped on re-run.

**Phase 3 — Rankings, in-app builder** ✅ done · **Sheet upload** — *on hold*
Two planned paths to build `MyRank`, sharing one table. In-app: pick a format, seed from ADP (or start from a previously saved set), drag-and-drop to reorder, save — done, see the "In-app rankings builder" writeup above. Sheet upload (`gspread` read of your rank Sheet, fed through the Phase 2 reconciliation pipeline) is the other, still-deferred path, for whenever there's an external rank source that isn't just "start from ADP and adjust."
*Done (in-app path)*: 9 new backend tests (query + API) + 24 new frontend tests (15 pure reorder/cursor-position logic + 7 component + 2 nav), all passing; verified live in the browser — real drag-and-drop reordering (including moving exactly one spot, live during the drag itself, and the end-zone), save, and reload-persistence all confirmed against actual data.

**Phase 4 — ADP import** ✅ done (built ahead of Phase 3, which is on hold)
Originally planned as an ADP CSV (e.g. FantasyPros) run through the Phase 2 reconciliation pipeline. Turned out unnecessary: Sleeper's own (undocumented) projections endpoint (`api.sleeper.com/projections/nfl/{season}`) returns ADP across std/PPR/half-PPR/2QB/dynasty/IDP formats, already keyed to Sleeper's `player_id` — no CSV, no name-matching. Landed in `AdpEntry`.
*Done*: fetch/parse/upsert pipeline, tested against fixtures (multi-format extraction, `999` sentinel filtering, missing-data rows), verified against live 2026 data (6,799 rows), idempotent re-sync confirmed.

**Players management panel** ✅ done (built ahead of schedule, as groundwork for Phase 5)
First real frontend page: `GET /players` endpoint plus a React table (position tabs, search, format dropdown) over `PlatformPlayer`/`AdpEntry`, modeled loosely on a reference draft-tool UI. Rank/ADP/name/position/team only — no tiers (Phase 3 on hold), no auction value/VORP/pick-availability-% (need data/math this project doesn't have yet). Position/search filtering was moved client-side shortly after the initial build (see "Getting started" above) since the backend already returns the full unpaginated set per format. Extended with a **data sync panel**: `SyncStatus` model + `app/sync_service.py` + `/sync/*` endpoints let both players and ADP be re-imported from the UI itself (with a "last synced" timestamp and live record count), sharing the exact same sync logic the CLI scripts use.
*Done*: 58 backend tests + 16 frontend tests, all passing; verified live in-browser against real 2026 Sleeper data — filtering, search, format switching, and both sync buttons (a real live re-fetch from Sleeper, triggered from the UI) all confirmed working.

**Phase 5 — Draft view (core feature), manual pick entry**
By-position and overall tiered views, undrafted-only filtering, ADP value/reach indicator — driven by manually marking picks (no live sync yet), so this phase is testable without a real draft running. Builds directly on the players management panel above (same table/filtering foundation, plus tiers once Phase 3 resumes, plus draft-state awareness).
*Done when*: backend calc functions (ADP delta, filtering) are unit tested, and a manual walkthrough of a mock draft produces correct, live-updating views.

**Phase 6 — Sleeper live sync**
Replace manual pick entry with live polling of Sleeper's draft-picks endpoint (reusing the approach proven in `draft-tool/sleeper-rerun.py`). Note: for a Sleeper league, picks arrive already keyed by Sleeper's own player ID, so no name-matching is needed here — reconciliation only matters for Sheet ranks and ADP.
*Done when*: polling logic is unit tested against fixture pick responses, and a real (or simulated) Sleeper draft updates the draft view live.

**Phase 7 — Availability-at-next-pick estimate**
Add the "will this player be there at my next pick" heuristic on top of the now-live draft view.
*Done when*: the calculation is a pure, unit-tested function, and it visibly tracks reality reasonably well during a manual test run.

**Phase 8 — Draft board (all teams/rosters) visual**
Grid of teams × filled roster slots.
*Done when*: the board accurately reflects roster state through a full mock draft.

**Phase 9+ — Stretch**: multi-league support (per-league Sheets/settings), ESPN integration, Yahoo OAuth integration.
