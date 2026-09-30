# Attribution & Licensing

This project incorporates data from publicly licensed sources. Please see below for attribution details.

## Wikimedia Content (CC BY-SA 4.0)

The following data sources are used in this project and are licensed under the **Creative Commons Attribution-ShareAlike 4.0 International License**:

- **Hindi Wiktionary Title Dump** — used to build the Hindi word list for the Daily Word game
  - Source: https://dumps.wikimedia.org/hiwiktionary/
  - License: https://creativecommons.org/licenses/by-sa/4.0/
  - Attribution: Wikimedia Foundation

### How to Comply

When distributing or modifying this project:

1. **Retain this notice** — keep a copy of this attribution file
2. **Provide attribution** — acknowledge that the Hindi word list is derived from the Hindi Wiktionary

> **Note on share-alike**: Individual words are not copyrightable; the filtered
> `valid_hi.txt` is a transformed subset of Wiktionary headword titles, not a
> verbatim copy of the database. Out of caution we treat the word list as
> CC BY-SA 4.0 data and provide attribution. Consult legal counsel if you need
> certainty about the share-alike obligation for your distribution.

For details, see [CC BY-SA 4.0 Deed](https://creativecommons.org/licenses/by-sa/4.0/).

## Audio (CC BY 4.0)

- **"Victory fanfare"** by humanoide9000 on Freesound, used as `frontend/assets/sounds/freecell-game-win.mp3` (FreeCell and Bottle Sort win sound; re-encoded to MP3)
  - Source: https://freesound.org/people/humanoide9000/sounds/466133/
  - License: https://creativecommons.org/licenses/by/4.0/

All other audio and sprites are CC0 or Pixabay Content License and need no attribution. Full asset
inventory: [`docs/audits/ASSET-RIGHTS-AUDIT.md`](docs/audits/ASSET-RIGHTS-AUDIT.md).

## Build Script Attribution

The script that builds the Hindi word list (`backend/scripts/gen_hindi_valid_words.py`) handles downloading and filtering Wiktionary data with proper Wikimedia rate-limiting compliance:

- Includes a descriptive User-Agent header (Wikimedia API Etiquette)
- Implements exponential backoff retry logic (Wikimedia request pacing)
- Filters to 5-character Devanagari words only
- Includes original game answers as mandatory entries

For more details, see the script's docstring.
