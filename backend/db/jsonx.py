"""Dialect-compiled SQL elements for JSON and timestamp arithmetic (#2996).

Postgres is the only runtime database; SQLite runs the test suite. The two
differ in how a JSON key is read and written and in how a timestamp is moved,
so service code used to branch on ``dialect_name(session)`` inline. Each
element here compiles to the right SQL for the dialect it is executed on,
through SQLAlchemy's ``@compiles`` hook, so the services build one statement
and never ask which database they are talking to.

Each element carries the JSON column (or timestamp column) as its one
clause, and bakes the key or hour count into the SQL text as a literal. The
baked values take part in the statement cache key (``_traverse_internals``),
so two statements that differ only in the key never share a compiled form.
Keys are restricted to identifiers, as the sweep flag and the board metrics
are, so the rendered JSON paths need no escaping.

The PostgreSQL body is the default compilation: a dialect without its own
hook (the one Alembic's offline mode uses, for instance, or a bare ``str(stmt)``
while debugging) renders the production SQL. SQLite has its own explicit hook.
"""

from __future__ import annotations

from typing import Any, ClassVar

from sqlalchemy import Boolean, ColumnElement, DateTime, Float, String
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.functions import FunctionElement
from sqlalchemy.sql.visitors import InternalTraversal

__all__ = ["json_is_true", "json_number", "json_set_true", "plus_hours"]


def _checked_key(key: str) -> str:
    """*key* when it is a plain identifier; the JSON paths below embed it unquoted."""
    if not isinstance(key, str) or not key.isidentifier():
        raise ValueError(f"JSON key must be an identifier, not {key!r}")
    return key


def _quoted(compiler: Any, value: str) -> str:
    """*value* as a safely quoted SQL string literal."""
    return compiler.render_literal_value(value, String())


class _JsonKeyElement(FunctionElement):
    """A one-column function element with a JSON object key baked in."""

    _traverse_internals: ClassVar[list[tuple[str, InternalTraversal]]] = [
        *FunctionElement._traverse_internals,
        ("key", InternalTraversal.dp_string),
    ]

    def __init__(self, column: ColumnElement, key: str) -> None:
        self.key = _checked_key(key)
        super().__init__(column)

    @property
    def column(self) -> ColumnElement:
        (column,) = self.clauses
        return column


class json_number(_JsonKeyElement):
    """``column[key]`` as a number, or NULL when it is absent or not a JSON number.

    Guarded by the JSON type so a malformed value (a result block stored as
    sent) yields NULL instead of a cast error that would fail the whole query.
    """

    type = Float()
    name = "json_number"
    inherit_cache = True


@compiles(json_number)
@compiles(json_number, "postgresql")
def _json_number_postgresql(element: json_number, compiler: Any, **kw: Any) -> str:
    column = compiler.process(element.column, **kw)
    key = _quoted(compiler, element.key)
    return (
        f"CASE WHEN (jsonb_typeof({column} -> {key}) = 'number') "
        f"THEN CAST(({column} ->> {key}) AS FLOAT) END"
    )


@compiles(json_number, "sqlite")
def _json_number_sqlite(element: json_number, compiler: Any, **kw: Any) -> str:
    column = compiler.process(element.column, **kw)
    path = _quoted(compiler, f"$.{element.key}")
    return (
        f"CASE WHEN (json_type({column}, {path}) IN ('integer', 'real')) "
        f"THEN json_extract({column}, {path}) END"
    )


class json_is_true(_JsonKeyElement):
    """``column[key]`` is JSON ``true``: NULL-safe, and never casts.

    Only JSON ``true`` matches: ``1``, ``"true"`` and a missing key all read as
    false, never as NULL. A cast of the value to boolean would fail the whole
    query on a value that is not a boolean literal (Postgres rejects
    ``CAST('maybe' AS BOOLEAN)``), so both bodies compare JSON values instead.

    ``~json_is_true(...)`` (or ``not_()``) compiles to the NULL-safe inequality
    of each dialect rather than wrapping the test in ``NOT``, so a missing key
    reads as "not true" there too.
    """

    type = Boolean()
    name = "json_is_true"
    _traverse_internals: ClassVar[list[tuple[str, InternalTraversal]]] = [
        *_JsonKeyElement._traverse_internals,
        ("negated", InternalTraversal.dp_boolean),
    ]

    def __init__(self, column: ColumnElement, key: str, *, negated: bool = False) -> None:
        self.negated = negated
        super().__init__(column, key)

    def _negate(self) -> json_is_true:
        return json_is_true(self.column, self.key, negated=not self.negated)


@compiles(json_is_true)
@compiles(json_is_true, "postgresql")
def _json_is_true_postgresql(element: json_is_true, compiler: Any, **kw: Any) -> str:
    flag = f"({compiler.process(element.column, **kw)} -> {_quoted(compiler, element.key)})"
    operator = "IS DISTINCT FROM" if element.negated else "IS NOT DISTINCT FROM"
    return f"({flag} {operator} 'true'::jsonb)"


@compiles(json_is_true, "sqlite")
def _json_is_true_sqlite(element: json_is_true, compiler: Any, **kw: Any) -> str:
    # json_type() reports 'true' only for JSON true (never for 1 or "true");
    # IS / IS NOT are SQLite's NULL-safe (in)equality.
    column = compiler.process(element.column, **kw)
    path = _quoted(compiler, f"$.{element.key}")
    operator = "IS NOT" if element.negated else "IS"
    return f"(json_type({column}, {path}) {operator} 'true')"


class json_set_true(_JsonKeyElement):
    """*column* with ``key`` set to JSON ``true`` (added, or replaced in place).

    A value expression for an UPDATE: the stored document with one key
    written, every other key kept.
    """

    name = "json_set_true"
    inherit_cache = True

    def __init__(self, column: ColumnElement, key: str) -> None:
        super().__init__(column, key)
        self.type = column.type


@compiles(json_set_true)
@compiles(json_set_true, "postgresql")
def _json_set_true_postgresql(element: json_set_true, compiler: Any, **kw: Any) -> str:
    column = compiler.process(element.column, **kw)
    patch = _quoted(compiler, f'{{"{element.key}": true}}')
    return f"({column} || CAST({patch} AS JSONB))"


@compiles(json_set_true, "sqlite")
def _json_set_true_sqlite(element: json_set_true, compiler: Any, **kw: Any) -> str:
    column = compiler.process(element.column, **kw)
    return f"json_set({column}, {_quoted(compiler, f'$.{element.key}')}, json('true'))"


class plus_hours(FunctionElement):
    """``column + n hours`` for a ``DateTime`` column, on either dialect.

    Postgres adds an interval to the timestamp. SQLite stores ``DateTime`` as
    text, and the ORM writes it as ``'YYYY-MM-DD HH:MM:SS.ffffff'``; the
    default body builds exactly that, so text comparisons against ORM-written
    timestamps order correctly: date math on the whole seconds (SQLite's own
    ``%f`` has only milliseconds), then the original microseconds, padded for
    a value stored without a fraction.
    """

    type = DateTime(timezone=True)
    name = "plus_hours"
    _traverse_internals: ClassVar[list[tuple[str, InternalTraversal]]] = [
        *FunctionElement._traverse_internals,
        ("hours", InternalTraversal.dp_plain_obj),
    ]

    def __init__(self, column: ColumnElement, hours: int) -> None:
        if not isinstance(hours, int) or isinstance(hours, bool) or hours < 0:
            raise ValueError(f"hours must be a non-negative int, not {hours!r}")
        self.hours = hours
        super().__init__(column)

    @property
    def column(self) -> ColumnElement:
        (column,) = self.clauses
        return column


@compiles(plus_hours)
@compiles(plus_hours, "postgresql")
def _plus_hours_postgresql(element: plus_hours, compiler: Any, **kw: Any) -> str:
    column = compiler.process(element.column, **kw)
    return f"({column} + INTERVAL '{element.hours} hours')"


@compiles(plus_hours, "sqlite")
def _plus_hours_sqlite(element: plus_hours, compiler: Any, **kw: Any) -> str:
    column = compiler.process(element.column, **kw)
    modifier = _quoted(compiler, f"+{element.hours} hours")
    whole_seconds = f"strftime('%Y-%m-%d %H:%M:%S', {column}, {modifier})"
    # From the 21st character on: the digits after the seconds' '.', or ''
    # for a value stored without a fraction. Padded to six digits.
    fraction = f"substr(substr({column}, 21) || '000000', 1, 6)"
    return f"({whole_seconds} || '.' || {fraction})"
