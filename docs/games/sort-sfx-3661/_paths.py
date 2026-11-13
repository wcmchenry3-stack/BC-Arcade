"""Import paths and the scratch directory for the archived Sort sound prototypes (#3661).

Importing this puts this folder and tools/assets (for synth_common) on sys.path. Every output
(renders, previews, spectrograms, videos) goes under SCRATCH, never into frontend/assets:
set SORT_SFX_OUT to choose it, else a folder in the system temp directory.
"""

import os
import sys
import tempfile
from pathlib import Path

ARCHIVE = Path(__file__).resolve().parent
TOOLS = ARCHIVE.parents[2] / "tools" / "assets"  # docs/games/sort-sfx-3661 -> repo root
SCRATCH = Path(os.environ.get("SORT_SFX_OUT", Path(tempfile.gettempdir()) / "sort-sfx-3661"))
(SCRATCH / "out").mkdir(parents=True, exist_ok=True)
(SCRATCH / "preview").mkdir(parents=True, exist_ok=True)
for _p in (ARCHIVE, TOOLS):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))
