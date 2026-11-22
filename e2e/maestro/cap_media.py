#!/usr/bin/env python3
"""Delete oversized demo media before the CI upload (#3719).

A Maestro screen recording that never stops (a loss demo that never loses) once left a 1.35 GB
.mp4 in the artifact. Per file: any .mp4/.png above MAX_MEDIA_MB (default 100) is deleted and a
`::warning::` annotation names it, so the run stays green, the artifact stays small, and the
missing file is visible on the run page. Nothing else is touched.

Usage: cap_media.py PATH...   (files or directories; missing paths are ignored)
"""
import os
import sys

MEDIA_EXTENSIONS = (".mp4", ".png")


def media_files(paths):
    for path in paths:
        if os.path.isfile(path):
            yield path
        elif os.path.isdir(path):
            for root, _dirs, names in os.walk(path):
                for name in names:
                    yield os.path.join(root, name)


def cap(paths, max_bytes):
    """Deletes each media file over max_bytes; returns the deleted paths."""
    deleted = []
    for path in media_files(paths):
        if not path.lower().endswith(MEDIA_EXTENSIONS):
            continue
        try:
            size = os.path.getsize(path)
        except OSError:
            continue
        if size > max_bytes:
            os.remove(path)
            deleted.append(path)
            print(
                f"::warning title=Demo media over the cap::{path} was {size / 1e6:.0f} MB, "
                f"over {max_bytes / 1e6:.0f} MB, so it was deleted and not uploaded"
            )
    return deleted


def main(argv):
    max_mb = float(os.environ.get("MAX_MEDIA_MB", "100"))
    cap(argv[1:], int(max_mb * 1_000_000))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
