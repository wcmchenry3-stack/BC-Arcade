"""Integer bounds that match the database column types (#3304).

An ``int`` request field that is stored in a 32-bit ``Integer`` column, or a
16-bit ``SmallInteger`` one, must be bounded to that range: Postgres raises at
insert for a value outside it, which the API would answer with a 500. With the
bound pydantic answers 422 before the database is touched.

Pure constants and annotated types, no imports from the app, so any schema
module can use them.
"""

from typing import Annotated

from pydantic import Field

INT32_MAX = 2**31 - 1
INT32_MIN = -(2**31)
INT16_MAX = 2**15 - 1

Int32 = Annotated[int, Field(ge=INT32_MIN, le=INT32_MAX)]
"""A signed value that fits a 32-bit ``Integer`` column."""

NonNegInt32 = Annotated[int, Field(ge=0, le=INT32_MAX)]
"""A non-negative value that fits a 32-bit ``Integer`` column."""
