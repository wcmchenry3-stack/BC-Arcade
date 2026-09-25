"""SQLAlchemy models for epic #362 — games, events, bug logs.

Design notes (issue #363):

* Lookup tables (`game_types`, `event_types`) hold evolvable vocabularies.
  Renames and deprecations happen via row updates — no schema migrations.
* Stable vocabularies (outcome, level) are CHECK constraints instead.
* `user_id` is nullable with no FK today; the `users` table doesn't exist yet
  and won't until the SSO epic backfills it.

Portability: the runtime DB is always Postgres, but CI's schema-migration
check runs these models against SQLite. All types below adapt cleanly to
both — JSONB → JSON on sqlite, UUID → CHAR(32) on sqlite, etc. UUID PK
defaults are generated in Python so we don't need `gen_random_uuid()` /
pgcrypto.
"""

from __future__ import annotations

import uuid
from datetime import date as dt_date
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy import (
    false as sa_false,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base
from vocab import GameOutcome

# JSONB on Postgres, JSON (TEXT) on sqlite — both round-trip Python dicts.
_JSONB = JSON().with_variant(JSONB(), "postgresql")

# Built from GameOutcome in vocab.py — the single source of truth.
# Adding a value to the enum is the only change needed; this string rebuilds automatically.
_OUTCOME_CHECK = "outcome IS NULL OR outcome IN ({})".format(
    ",".join(f"'{v.value}'" for v in GameOutcome)
)


class GameType(Base):
    __tablename__ = "game_types"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    icon_emoji: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="0")
    is_active: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    is_premium: Mapped[bool] = mapped_column(nullable=False, server_default=sa_false())
    category: Mapped[str] = mapped_column(Text, nullable=False, server_default="other")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    event_types: Mapped[list[EventType]] = relationship(
        back_populates="game_type", cascade="all, delete-orphan"
    )
    games: Mapped[list[Game]] = relationship(back_populates="game_type")


class EventType(Base):
    __tablename__ = "event_types"
    __table_args__ = (UniqueConstraint("game_type_id", "name", name="uq_event_types_game_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    game_type_id: Mapped[int] = mapped_column(
        SmallInteger, ForeignKey("game_types.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deprecated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    game_type: Mapped[GameType] = relationship(back_populates="event_types")
    events: Mapped[list[GameEvent]] = relationship(back_populates="event_type")


class Game(Base):
    __tablename__ = "games"
    __table_args__ = (
        CheckConstraint(_OUTCOME_CHECK, name="ck_games_outcome"),
        Index("games_session_id_started_at_idx", "session_id", "started_at"),
        Index(
            "games_user_id_started_at_idx",
            "user_id",
            "started_at",
            postgresql_where="user_id IS NOT NULL",
            sqlite_where="user_id IS NOT NULL",
        ),
        Index(
            "games_game_type_score_idx",
            "game_type_id",
            "final_score",
            postgresql_where="final_score IS NOT NULL",
            sqlite_where="final_score IS NOT NULL",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_id: Mapped[str] = mapped_column(Text, nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    game_type_id: Mapped[int] = mapped_column(
        SmallInteger, ForeignKey("game_types.id"), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    final_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    outcome: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    game_metadata: Mapped[dict] = mapped_column(
        "metadata", _JSONB, nullable=False, server_default="{}"
    )
    players: Mapped[list] = mapped_column(_JSONB, nullable=False, server_default="[]")

    game_type: Mapped[GameType] = relationship(back_populates="games")
    events: Mapped[list[GameEvent]] = relationship(
        back_populates="game",
        cascade="all, delete-orphan",
        order_by="GameEvent.event_index",
    )


class GameEvent(Base):
    __tablename__ = "game_events"
    __table_args__ = (Index("game_events_event_type_id_idx", "event_type_id"),)

    game_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("games.id", ondelete="CASCADE"), primary_key=True
    )
    event_index: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_type_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("event_types.id"), nullable=False
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    data: Mapped[dict] = mapped_column(_JSONB, nullable=False)

    game: Mapped[Game] = relationship(back_populates="events")
    event_type: Mapped[EventType] = relationship(back_populates="events")


class GameEntitlement(Base):
    """Session-scoped entitlements written by IAP receipt validation.

    Stubbed empty until #822 ships — rows here drive entitled_games in JWTs.
    """

    __tablename__ = "game_entitlements"
    __table_args__ = (
        Index("game_entitlements_session_id_idx", "session_id"),
        UniqueConstraint("session_id", "game_slug", name="uq_game_entitlements_session_slug"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_id: Mapped[str] = mapped_column(Text, nullable=False)
    game_slug: Mapped[str] = mapped_column(Text, nullable=False)
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class BugLog(Base):
    __tablename__ = "bug_logs"
    __table_args__ = (
        CheckConstraint("level IN ('warn','error','fatal')", name="ck_bug_logs_level"),
        Index("bug_logs_session_logged_idx", "session_id", "logged_at"),
        Index("bug_logs_level_logged_idx", "level", "logged_at"),
        Index("bug_logs_source_idx", "source"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_id: Mapped[str] = mapped_column(Text, nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    level: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    context: Mapped[dict] = mapped_column(_JSONB, nullable=False, server_default="{}")


class DailyWordProgress(Base):
    """Server-side record of a session's guesses on one Daily Word puzzle (#2197).

    Daily Word was fully client-authoritative: ``POST /guess`` scored a guess and
    returned tiles but persisted nothing, so the server could not tell how many
    guesses a player had used. Two consequences, both live:

    * ``GET /answer`` handed today's word to anyone who asked, with no session and
      no guesses made — the ``puzzle_id`` is just ``YYYY-MM-DD:{lang}``.
    * The 6-guess limit existed only in the client, so the real ceiling was the
      20/hour rate limit — enough scored guesses to brute-force a 5-letter word.

    ``guesses`` holds the distinct guesses in order, which both gives the count
    and makes a retried guess idempotent: the network layer retries, and a
    replayed request must not cost the player a turn.

    Not a cache — this is the authority for "has this session earned the answer".
    Rows are per (session_id, puzzle_id) and are never rewritten for a past
    puzzle, so a day already played keeps its history.
    """

    __tablename__ = "daily_word_progress"
    __table_args__ = (
        # No separate session_id index: this unique constraint's btree leads
        # with session_id, and every query filters on both columns.
        UniqueConstraint("session_id", "puzzle_id", name="uq_daily_word_progress_session_puzzle"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_id: Mapped[str] = mapped_column(Text, nullable=False)
    # "YYYY-MM-DD:{lang}" — the same id the client sends on every guess.
    puzzle_id: Mapped[str] = mapped_column(Text, nullable=False)
    guesses: Mapped[list] = mapped_column(_JSONB, nullable=False, default=list)
    solved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class DailyChallengeDay(Base):
    """Frozen at first request: which goals a calendar day's daily challenge
    actually showed players, for a given slate (#2493).

    `daily_challenge/definitions.py`'s ``pick_template`` is a pure function of
    (day, slate, salt, pool) — the scheduling *policy*, only ever correct for a
    day nobody has been shown yet. The first time a (date, slate) pair is
    requested (`daily_challenge/schedule.py`), the result lands here and every
    later request for that pair reads the row back instead of recomputing — so
    retuning the goal pool or changing DAILY_CHALLENGE_SALT afterward can only
    ever affect days not yet frozen, never one a player has already seen or a
    streak has already been scored against.

    Each goal is a self-contained spec (game_type/kind/target/tier), not a
    lookup key into a pool dict — so a day's history survives a goal being
    retuned or removed from the live pool later.
    """

    __tablename__ = "daily_challenge_days"

    date: Mapped[dt_date] = mapped_column(Date, primary_key=True)
    slate: Mapped[str] = mapped_column(Text, primary_key=True)
    template_id: Mapped[str] = mapped_column(Text, nullable=False)
    goals: Mapped[list] = mapped_column(_JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
