from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PlatformPlayer(Base):
    """A platform's own player list — canonical player identity within a league on that platform."""

    __tablename__ = "platform_players"
    __table_args__ = (
        UniqueConstraint("platform", "platform_player_id", name="uq_platform_player"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    platform: Mapped[str] = mapped_column(String, index=True)
    platform_player_id: Mapped[str] = mapped_column(String, index=True)
    name: Mapped[str] = mapped_column(String)
    position: Mapped[str | None] = mapped_column(String, nullable=True)
    team: Mapped[str | None] = mapped_column(String, nullable=True)


class NameMapping(Base):
    """A confirmed resolution of a free-text source name (Sheet rank, ADP row) to a platform player.

    Once confirmed, future imports skip straight to auto_matched/confirmed_no_match for
    this (platform, source_type, normalized_name) — only genuinely new names need review.
    """

    __tablename__ = "name_mappings"
    __table_args__ = (
        UniqueConstraint("platform", "source_type", "normalized_name", name="uq_name_mapping"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    platform: Mapped[str] = mapped_column(String, index=True)
    source_type: Mapped[str] = mapped_column(String)  # "sheet_rank" | "adp"
    source_name_raw: Mapped[str] = mapped_column(String)
    normalized_name: Mapped[str] = mapped_column(String, index=True)
    # None = confirmed as "no match" (e.g. a name that isn't a real fantasy-relevant player)
    platform_player_id: Mapped[str | None] = mapped_column(String, nullable=True)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=True)


class AdpEntry(Base):
    """ADP for a platform player, in a given season and scoring format.

    Sourced from Sleeper's (undocumented) projections endpoint, which already
    keys ADP to Sleeper's own player_id — no name-matching needed for this one,
    unlike the Sheet-based ranks.
    """

    __tablename__ = "adp_entries"
    __table_args__ = (
        UniqueConstraint("platform", "platform_player_id", "season", "format", name="uq_adp_entry"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    platform: Mapped[str] = mapped_column(String, index=True)
    platform_player_id: Mapped[str] = mapped_column(String, index=True)
    season: Mapped[str] = mapped_column(String, index=True)
    format: Mapped[str] = mapped_column(String)  # e.g. "std", "ppr", "half_ppr", "dynasty_ppr"
    adp: Mapped[float] = mapped_column(Float)


class SyncStatus(Base):
    """When a given ingestion last ran, keyed by sync type (+ season, where applicable).

    One row per (sync_type, season) -- upserted on every sync, not an append-only
    log, since the UI only ever needs "when did this last run", not history.
    Record counts are deliberately NOT stored here; they're computed live from
    the actual tables (PlatformPlayer/AdpEntry) so this can never drift from
    what's really in the DB.
    """

    __tablename__ = "sync_status"
    __table_args__ = (UniqueConstraint("sync_type", "season", name="uq_sync_status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sync_type: Mapped[str] = mapped_column(String, index=True)  # "sleeper_players" | "sleeper_adp"
    season: Mapped[str | None] = mapped_column(
        String, nullable=True
    )  # null for non-season-scoped syncs
    last_synced_at: Mapped[datetime] = mapped_column(DateTime)


class RankSet(Base):
    """A named, orderable rank list scoped to one platform/season/scoring format.

    Multiple sets can exist per format (e.g. "Main" and "Zero-RB experiment" for the
    same half_ppr season) -- a future League points at exactly one of these via a
    plain rank_set_id reference, never the other way around: a RankSet has no idea
    which (if any) leagues use it, and AdpEntry stays completely separate from this
    table (ADP is generic per platform/season/format, shared by every rank set and
    league that happens to use that format).
    """

    __tablename__ = "rank_sets"
    # Named on purpose, not just for readability: SQLite can't drop a constraint
    # in place, so changing this one goes through Alembic's batch mode, which
    # reflects the existing table -- and reflection can't recover the name of an
    # anonymous constraint.
    __table_args__ = (
        UniqueConstraint("platform", "season", "format", "scope", "name", name="uq_rank_set_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)
    platform: Mapped[str] = mapped_column(String, index=True, default="sleeper")
    season: Mapped[str] = mapped_column(String, index=True)
    format: Mapped[str] = mapped_column(String, index=True)
    # "overall" or one of QB/RB/WR/TE. A plain String rather than an Enum: this
    # codebase has no Enum precedent, and on SQLite an Enum becomes a CHECK
    # constraint that batch-migrating later is needlessly painful. Validated in
    # app/ranks.py instead. Only an "overall" set may be assigned to a League.
    scope: Mapped[str] = mapped_column(
        String, index=True, server_default="overall", default="overall"
    )
    # Meaningful only for a positional scope: with multiple named lists per
    # position now possible, exactly one is the one the overall builder and the
    # draft room actually use. Enforced in app/ranks.py's set_active_rank_set,
    # not a DB constraint -- SQLite has no partial unique index, and "exactly
    # one true per (platform, season, format, scope)" is cheap to keep as an
    # invariant in the one place that ever flips this flag. Ignored for
    # scope="overall", where there's no ambiguity to resolve.
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime)


class RankEntry(Base):
    """One player's position within a RankSet. platform/season/format deliberately
    live only on the parent RankSet, not denormalized here (unlike the old flat
    MyRank table this replaces) -- there's now a parent row to hang them on.
    """

    __tablename__ = "rank_entries"
    __table_args__ = (
        UniqueConstraint("rank_set_id", "platform_player_id", name="uq_rank_entry_player"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    rank_set_id: Mapped[int] = mapped_column(ForeignKey("rank_sets.id"), index=True)
    platform_player_id: Mapped[str] = mapped_column(String, index=True)
    rank: Mapped[int] = mapped_column(Integer)
    # Tier this player falls in, or None when the set has no tiers. A grouping
    # over the existing order, never a second ordering -- rank stays dense and
    # contiguous either way.
    tier: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # "major" | "minor" | None -- whether a tier break follows this player, and
    # how big the drop-off is. Stored as the authoring intent rather than
    # derived from `tier`, because the two weights produce the same tier
    # numbering and only differ in how hard the cliff is.
    break_after: Mapped[str | None] = mapped_column(String, nullable=True)
    # "target" | "fade" | None -- a personal lean on this player that rank
    # order alone can't express ("I'll reach for him", "I'd rather not").
    flag: Mapped[str | None] = mapped_column(String, nullable=True)


class RankDataset(Base):
    """One imported third-party ranking file (someone else's ranks), stored
    platform-agnostically.

    Deliberately has no platform column. Rows are keyed by normalized name and
    resolved to a platform's player ids on read (app/rank_sources.py), so a
    single upload serves both a Sleeper and an ESPN league -- which is exactly
    what NameMapping's (platform, source_type, normalized_name) key was already
    built for. season/format are here because a ranking file is inherently for
    one season and one scoring format.
    """

    __tablename__ = "rank_datasets"
    __table_args__ = (UniqueConstraint("season", "format", "name", name="uq_rank_dataset_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)
    season: Mapped[str] = mapped_column(String, index=True)
    format: Mapped[str] = mapped_column(String, index=True)
    # Which axes this file can actually feed, computed once at import so the
    # builder can say "this file can't feed an overall build" without loading a
    # single row. A positional-only file genuinely cannot produce an overall
    # rank -- see app/rank_import/derive.py.
    has_overall: Mapped[bool] = mapped_column(Boolean, default=False)
    has_positional: Mapped[bool] = mapped_column(Boolean, default=False)
    has_tier: Mapped[bool] = mapped_column(Boolean, default=False)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    source_filename: Mapped[str | None] = mapped_column(String, nullable=True)
    # The confirmed column mapping, kept alongside the original text so a
    # mis-mapped import can be re-parsed without re-uploading the file. Opaque,
    # never joined on -- JSON, same call as League.roster_positions.
    column_mapping: Mapped[dict] = mapped_column(JSON)
    raw_text: Mapped[str] = mapped_column(Text)
    imported_at: Mapped[datetime] = mapped_column(DateTime)


class RankDatasetEntry(Base):
    """One row of an imported ranking file, after parsing and rank derivation.

    Keyed by normalized_name rather than a platform player id -- resolution
    happens on read. position/team are normalized to this app's own vocabulary
    (DEF not D/ST, JAX not JAC) at parse time, so app/matching never has to know
    about third-party spellings.
    """

    __tablename__ = "rank_dataset_entries"
    __table_args__ = (
        # Catches the common duplicate (a file listing a player twice at the
        # same position). It deliberately does NOT cover rows with a null
        # position, since SQL treats nulls as distinct -- the importer dedupes
        # those in Python and warns rather than sentinel-encoding null here.
        UniqueConstraint("dataset_id", "normalized_name", "position", name="uq_rank_dataset_entry"),
        Index("ix_rank_dataset_entry_dataset_position", "dataset_id", "position"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("rank_datasets.id"), index=True)
    source_name_raw: Mapped[str] = mapped_column(String)
    normalized_name: Mapped[str] = mapped_column(String, index=True)
    position: Mapped[str | None] = mapped_column(String, nullable=True)
    team: Mapped[str | None] = mapped_column(String, nullable=True)
    overall_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tier: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # True when position_rank was computed from overall_rank rather than read
    # from the file. Equivalent for comparison math, but not for showing the
    # user what their source actually said.
    position_rank_derived: Mapped[bool] = mapped_column(Boolean, default=False)
    # Original file order: an audit trail, and the tiebreaker when a source
    # ties two players at the same rank.
    row_index: Mapped[int] = mapped_column(Integer)


class RankSetSource(Base):
    """Which rank sources a RankSet was built from, so reopening the builder
    restores the selection.

    `ref` is a tagged reference ("adp", "dataset:7", "rank_set:3") rather than a
    nullable FK per kind: the set of source kinds is open, and a column per kind
    would need a schema change every time one is added -- the same reasoning
    that makes NameMapping.source_type free text.
    """

    __tablename__ = "rank_set_sources"
    __table_args__ = (UniqueConstraint("rank_set_id", "ref", name="uq_rank_set_source"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    rank_set_id: Mapped[int] = mapped_column(ForeignKey("rank_sets.id"), index=True)
    ref: Mapped[str] = mapped_column(String)
    order: Mapped[int] = mapped_column(Integer)


class League(Base):
    """One of your real fantasy leagues, set up once so its settings don't need
    retyping every draft. `platform`/`platform_league_id` mirror Draft's pattern
    (generic field, "sleeper" the only usable value for now). `rank_set_id` is a
    plain, nullable reference to a RankSet -- many leagues can share one rank set
    (e.g. two leagues that are both "half PPR"), and a league is fully usable
    before you've picked one.
    """

    __tablename__ = "leagues"

    id: Mapped[int] = mapped_column(primary_key=True)
    platform: Mapped[str] = mapped_column(String, default="sleeper")
    platform_league_id: Mapped[str] = mapped_column(String, index=True)
    name: Mapped[str] = mapped_column(String)
    season: Mapped[str] = mapped_column(String, index=True)
    format: Mapped[str] = mapped_column(String, index=True)
    num_teams: Mapped[int] = mapped_column(Integer)
    # Sleeper's own roster_positions array, verbatim (includes "BN" bench
    # entries) -- order-preserving, opaque, never filtered/joined on, so JSON
    # is the right fit (unlike RankEntry, which is a real relational table).
    roster_positions: Mapped[list] = mapped_column(JSON)
    # {roster_id (as a string): team name}, from joining the league's rosters
    # and users endpoints -- draft-slot assignment isn't known at the league
    # level (only once a specific draft exists), so this maps roster ownership,
    # not board position.
    team_names: Mapped[dict] = mapped_column(JSON)
    rank_set_id: Mapped[int | None] = mapped_column(ForeignKey("rank_sets.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)


class Draft(Base):
    """A local draft session. `platform` is "manual" (typed in) or "sleeper" (synced
    live from Sleeper's own draft-picks endpoint). `league_id` is a plain, nullable
    reference to a League -- set only when the draft was created *from* a saved
    League (League setup's Phase C); a raw Sleeper-draft-ID or manual draft has none.
    """

    __tablename__ = "drafts"

    id: Mapped[int] = mapped_column(primary_key=True)
    platform: Mapped[str] = mapped_column(String, default="manual")
    platform_draft_id: Mapped[str | None] = mapped_column(String, nullable=True)
    league_id: Mapped[int | None] = mapped_column(ForeignKey("leagues.id"), nullable=True)
    season: Mapped[str] = mapped_column(String, index=True)
    format: Mapped[str] = mapped_column(String, index=True)
    num_teams: Mapped[int] = mapped_column(Integer)
    num_rounds: Mapped[int] = mapped_column(Integer)
    my_slot: Mapped[int] = mapped_column(Integer)
    # {draft_slot (as a string): team name}, resolved from the platform's own
    # slot_to_team_id (per-draft, since snake-order slot assignment isn't known
    # at the League level) joined against League.team_names (roster/team
    # ownership). Null until that mapping is available -- Sleeper only assigns
    # it once the draft's order is set (which can be after league creation but
    # before the draft starts); ESPN publishes it upfront -- refreshed on each
    # sync either way, not just at creation.
    team_names: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)


class DraftPick(Base):
    """One pick in a draft. `round`/`slot` (team column) are deliberately NOT stored --
    they're always derived from pick_number + the draft's num_teams via the snake-order
    math in app/draft_logic.py, so there's nothing to keep in sync.
    """

    __tablename__ = "draft_picks"
    __table_args__ = (
        UniqueConstraint("draft_id", "pick_number", name="uq_draft_pick_number"),
        UniqueConstraint("draft_id", "platform_player_id", name="uq_draft_pick_player"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    draft_id: Mapped[int] = mapped_column(ForeignKey("drafts.id"), index=True)
    pick_number: Mapped[int] = mapped_column(Integer)
    platform_player_id: Mapped[str] = mapped_column(String)


class DraftQueueEntry(Base):
    """Your personal draft-day shortlist, scoped to one draft (not global like a
    RankSet) -- a live queue is inherently tied to a specific board, and resets
    fresh per draft.
    """

    __tablename__ = "draft_queue_entries"
    __table_args__ = (
        UniqueConstraint("draft_id", "platform_player_id", name="uq_draft_queue_player"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    draft_id: Mapped[int] = mapped_column(ForeignKey("drafts.id"), index=True)
    platform_player_id: Mapped[str] = mapped_column(String)
    order: Mapped[int] = mapped_column(Integer)


class CorpusDocument(Base):
    """One piece of writing by an analyst you follow -- an article, a season
    guide, a podcast transcript.

    Stored platform-agnostically for the same reason RankDataset is: the
    mentions hanging off it are keyed by normalized name and resolved to a
    platform's player ids on read, so one imported corpus serves a Sleeper and
    an ESPN league alike.

    `raw_text` is kept after chunking (RankDataset's call, same reasoning): the
    chunker will get better, and re-chunking shouldn't mean re-importing.
    """

    __tablename__ = "corpus_documents"
    __table_args__ = (UniqueConstraint("analyst", "title", name="uq_corpus_document_title"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # Free text, not a FK to an analysts table -- there's one analyst today and
    # a second would still not need its own table, just a different string.
    analyst: Mapped[str] = mapped_column(String, index=True)
    title: Mapped[str] = mapped_column(String)
    # "article" | "guide" | "rankings" | "transcript". Free text, matching
    # NameMapping.source_type's call: the set is open and never joined on.
    kind: Mapped[str] = mapped_column(String, index=True)
    # When the analyst published it, not when you imported it -- the whole
    # point of storing it. A 2023 take and a 2026 take on the same player are
    # different claims, and the model has to be able to tell them apart.
    # Nullable because undated scrapes happen, and a null date is far better
    # than a guessed one.
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    source_filename: Mapped[str | None] = mapped_column(String, nullable=True)
    raw_text: Mapped[str] = mapped_column(Text)
    imported_at: Mapped[datetime] = mapped_column(DateTime)


class CorpusChunk(Base):
    """A passage of a document, sized to be retrieved and quoted on its own.

    Chunks are the unit of retrieval: a pick-time prompt pulls the handful of
    chunks that mention the players actually on the board, so a chunk has to
    carry enough context to stand alone when quoted out of order.
    """

    __tablename__ = "corpus_chunks"
    __table_args__ = (UniqueConstraint("document_id", "chunk_index", name="uq_corpus_chunk_index"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("corpus_documents.id"), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    # Offset into the parent's raw_text, so a quote can be traced back to where
    # it actually appears rather than just to which chunk it landed in.
    char_start: Mapped[int] = mapped_column(Integer)


class ChunkMention(Base):
    """A player named in a chunk, keyed by normalized name rather than by
    platform player id.

    Deliberately platform-free, exactly like RankDatasetEntry: the scan needs a
    player list to *detect* a name, but what it records is just the name it
    found, which resolves against Sleeper's or ESPN's list equally well on read
    (app/corpus/retrieve.py).
    """

    __tablename__ = "chunk_mentions"
    __table_args__ = (
        UniqueConstraint("chunk_id", "normalized_name", name="uq_chunk_mention"),
        Index("ix_chunk_mention_name_chunk", "normalized_name", "chunk_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    chunk_id: Mapped[int] = mapped_column(ForeignKey("corpus_chunks.id"), index=True)
    # As it appeared in the prose ("Marvin Harrison Jr.", "CMC") -- kept so a
    # bad detection is diagnosable without re-reading the chunk.
    source_name_raw: Mapped[str] = mapped_column(String)
    normalized_name: Mapped[str] = mapped_column(String, index=True)
    # How the scanner found it: "full_name", "surname", or "alias". A surname
    # hit is a weaker signal than a full-name hit and the retrieval layer is
    # allowed to treat it as such.
    detected_by: Mapped[str] = mapped_column(String)
    # Times this name appears in the chunk. A passage that names a player once
    # in a list is not a passage about that player.
    occurrences: Mapped[int] = mapped_column(Integer, default=1)


class PlayerExposure(Base):
    """How many teams/rosters (across however many leagues and drafts) you
    have a given player on -- manually entered for now, not derived from
    actual League rosters. season-scoped, not format-scoped: a share is a
    roster spot, which doesn't depend on how that league scores.
    """

    __tablename__ = "player_exposures"
    __table_args__ = (
        UniqueConstraint("platform", "season", "platform_player_id", name="uq_player_exposure"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    platform: Mapped[str] = mapped_column(String, index=True)
    season: Mapped[str] = mapped_column(String, index=True)
    platform_player_id: Mapped[str] = mapped_column(String, index=True)
    shares: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime)
