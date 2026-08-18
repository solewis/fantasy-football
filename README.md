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
- **ADP**: not available from Sleeper/ESPN/Yahoo APIs — needs an external source (e.g. FantasyPros CSV export).
- **Platform rank**: not obviously exposed by these APIs either (needs more digging per-platform — may require scraping their public rankings pages). Lower priority now that draft view leans on your Sheet ranks + ADP.
- **Rank scoping**: rankings/tiers need to vary by scoring format/roster settings, so the data model should key rankings off "format" (e.g. PPR/Superflex/Standard) rather than assuming one global rank list.
- **Availability-at-next-pick math**: needs a defined methodology — start simple (ADP vs. picks remaining before your turn) and note as an open question whether it's worth modeling further.

## Player name matching (the tricky part)

Decision: **no universal cross-platform player table for v1.** Since each league lives on exactly one platform, that platform's own player list (e.g. Sleeper's `/v1/players/nfl`) is the canonical set of players for that league — every pick, rank, and ADP row for that league ultimately resolves to that platform's player ID. This sidesteps needing a Sleeper/ESPN/Yahoo crosswalk entirely for now.

What's left is a narrower, but real, problem: your rank Sheet and an ADP CSV both use free-text names typed by humans, which won't always match the platform's name exactly (suffixes like Jr./Sr./II/III, "D.J." vs "DJ", defense entries like "49ers D/ST" vs "San Francisco", accented characters, nicknames). Both imports need the same fix, so build it once as a shared **reconciliation tool**, not two bespoke import scripts:

1. **Normalize** both sides (lowercase, strip punctuation/suffixes/whitespace) and try an exact match on the normalized key first — this alone should resolve the large majority of names.
2. **Fuzzy match** whatever's left (e.g. `rapidfuzz`) against the platform's player list, using position (and team, if available) as a tie-breaker, producing a ranked list of candidates with a confidence score.
3. **Manual review** for anything below a confidence threshold or with multiple close candidates — a small review screen (or even just a CLI list to start) showing the source name next to its candidates so you pick the right one or mark "no match."
4. **Persist confirmed mappings** keyed by (platform, normalized source name) so once a name is resolved, every future import (next week, next season) auto-resolves it instantly — only genuinely new names (rookies, typos, new sources) need review each time.

This same pipeline is reused verbatim for ADP import — same normalize → fuzzy-match → review → persist steps, just a different source file and a different destination table (`AdpEntry` instead of `MyRank`). Building it as one general tool (source rows in, platform player list in, mapping out) rather than two one-off scripts is a deliberate early investment since it's the highest-risk part of the whole app.

## Platform integration plan

| Platform | API | Auth | Verdict |
|---|---|---|---|
| Sleeper | Public REST API, well documented | None | Build v1 live integration here first |
| ESPN | Unofficial/reverse-engineered | None for public leagues; cookie harvest (`espn_s2`/`SWID`) for private | v2 stretch, expect fragility/breakage each season |
| Yahoo | Official Fantasy Sports API | OAuth2 app registration + login flow | v2/v3 stretch, most setup overhead but most sanctioned |

Manual entry is always available as a fallback, regardless of platform.

## Tech stack

- **Frontend**: React (Vite) + TypeScript
- **Backend**: Python + FastAPI — chosen over Express so rank aggregation/outlier math can lean on pandas, and as a chance to rebuild Python skills in a practical context
- **Storage**: SQLite (local file, no server to manage)

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

Current state: Phase 0 scaffold, Phase 1 (Sleeper player list ingestion), and Phase 2 (name-matching/reconciliation tool) done.

Sync Sleeper's player list into local SQLite (`backend/data/app.db`, gitignored):

```
cd backend
python -m scripts.sync_sleeper_players
```

**Note for future HTTP-fetching phases (ADP, ESPN, Yahoo)**: on this machine, `httpx`'s default `certifi` CA bundle fails to verify some sites (e.g. Sleeper's cert chains through a newer Google Trust Services intermediate `certifi` doesn't have yet) — unrelated to the corporate TLS-inspection proxy also present here. Fixed by using the `truststore` package to delegate verification to macOS's native trust store (same as `curl`), see `app/ingest/sleeper.py::_new_client`. Reuse this pattern for any new outbound HTTP client rather than reaching for `verify=False`.

**Note on migrations**: skipped Alembic for now — a single table doesn't justify migration tooling yet. Using `Base.metadata.create_all()` on startup/sync. Revisit once the schema has multiple evolving tables (Phase 3+).

Name-matching module (`app/matching/`) is standalone for now — not yet wired to a real Sheet or ADP file (that's Phase 3/4). Given a list of `{"name", "position"}` rows and a platform's player list, `resolve_rows()` returns each row's status (`auto_matched` / `needs_review` / `confirmed_no_match`) plus, for review cases, ranked candidates. Confirming a match via `confirm_mapping()` persists it so future imports skip straight to `auto_matched` for that name. Verified against the real 12k-player Sleeper dataset: suffix/punctuation cases (Jr./Sr./II/III, "D.J.") auto-match correctly, DST entries surface the right candidate for review, and made-up names correctly stay unresolved rather than being force-matched.

## Rough data model (draft)

- `League` — platform, platform_league_id, scoring format, roster settings, connection config
- `PlatformPlayer` — cached copy of a platform's own player list (platform, platform_player_id, name, position, team) — the canonical player identity *within that league's platform*
- `NameMapping` — (platform, source_type [`sheet_rank` / `adp`], source_name_raw, normalized_name, platform_player_id, confirmed_by_user) — the persisted output of the reconciliation tool, reused on every future import
- `MyRank` — (league, platform_player_id, position, overall_rank, tier) — imported from your Google Sheet, resolved through `NameMapping`
- `AdpEntry` — (platform, platform_player_id, format, adp) — from external source (e.g. FantasyPros), resolved through `NameMapping`
- `Draft` — league, platform draft ID (if synced), draft order, status
- `DraftPick` — draft, pick number, platform_player_id, team/roster

## Open questions

- What's the actual availability-at-next-pick formula — simple ADP-vs-picks-remaining heuristic, or something more involved?
- Exact Sheet layout/columns for the rank/tier import (one tab per league-format? one tab with a format column?)
- Where do we source "platform rank" per site, if we still want it later — scraping vs. is there an easier API path?
- Do the 3 leagues actually differ enough in format that they need distinct rank sets, or do some share one (e.g. two are both "12-team PPR")?
- How/where to store Yahoo OAuth tokens and ESPN cookies securely and locally (e.g. `.env`, gitignored config file)?

## Engineering practices

Since "well tested and maintainable" is a goal, not just a feature list, a few ground rules apply across every phase:

- **Backend tests**: `pytest`. **Frontend tests**: `vitest` + React Testing Library.
- Keep calculation logic (name normalization, fuzzy-match scoring, ADP delta, availability estimate) as **pure functions**, separate from I/O (HTTP calls, Sheets, DB) — pure functions are trivial to unit test with plain fixtures and don't need mocking gymnastics.
- Tests never hit live external APIs (Sleeper/ESPN/Yahoo/Sheets) — use small recorded/fixture JSON responses so the suite is fast, deterministic, and doesn't depend on a draft actually being active.
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

**Phase 3 — Rankings import (Google Sheets)**
`gspread` read of your rank Sheet, fed through the Phase 2 pipeline, landing in `MyRank`.
*Done when*: importing a real league's Sheet resolves cleanly (or clearly flags what needs manual review), with tests covering the import-and-resolve flow against a fixture Sheet payload.

**Phase 4 — ADP import**
Same Phase 2 pipeline, pointed at an ADP CSV (e.g. FantasyPros export) instead of a Sheet, landing in `AdpEntry`.
*Done when*: an ADP file imports and resolves the same way, proving the reconciliation tool is genuinely shared rather than duplicated.

**Phase 5 — Draft view (core feature), manual pick entry**
By-position and overall tiered views, undrafted-only filtering, ADP value/reach indicator — driven by manually marking picks (no live sync yet), so this phase is testable without a real draft running.
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
