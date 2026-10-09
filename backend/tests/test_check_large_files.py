"""Unit tests for scripts/check_large_files.py (#2967). No DATABASE_URL needed."""

from __future__ import annotations

import importlib.util
import pathlib

SCRIPT = pathlib.Path(__file__).parent.parent.parent / "scripts" / "check_large_files.py"
_spec = importlib.util.spec_from_file_location("check_large_files", SCRIPT)
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)

GF_PATH, GF_CAP = next(iter(guard.GRANDFATHERED.items()))
GF_DIR = GF_PATH.split("/")[0]


def test_grandfathered_file_at_cap_passes():
    assert guard.find_offenders({GF_PATH: GF_CAP}) == []


def test_grandfathered_file_grown_fails():
    assert guard.find_offenders({GF_PATH: GF_CAP + 1}) == [(GF_PATH, GF_CAP + 1)]


def test_new_large_file_under_grandfathered_dir_fails():
    big = guard.LIMIT_BYTES + 1
    sizes = {f"{GF_DIR}/new.png": big, f"{GF_DIR}/sub/new.png": big}
    assert {p for p, _ in guard.find_offenders(sizes)} == set(sizes)


def test_small_file_passes():
    assert guard.find_offenders({"a.txt": 10, f"{GF_DIR}/small.png": 1024}) == []


def test_file_exactly_at_limit_passes():
    assert guard.find_offenders({"a.bin": guard.LIMIT_BYTES}) == []
