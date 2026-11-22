#!/usr/bin/env python3
"""Retry failed Maestro flows once (the nightly run only, #4054).

Usage (from the repo root):

    python3 e2e/maestro/retry.py plan <dir>          # "<flow path> <report path>" per line
    python3 e2e/maestro/retry.py verdict <dir> ...   # exit 1 if a flow still fails

The smoke workflows run one `maestro test --format junit --output maestro-results/<dir>/report.xml`
per flow directory. When the caller passes `nightly: true`, each failed flow then runs once more,
on its own, writing `maestro-retry/<dir>/<flow>.xml`, and `verdict` decides the step's result
from both rounds. `summarize.py` shows a flow that failed and then passed as "PASS on retry"
and counts those separately, so a flaky flow stays visible.

`plan` maps a failed junit test case to `e2e/maestro/flows/<dir>/<name>.yaml` (Maestro names a
case after its flow file when the flow sets no `name:`). When that is not possible (no report,
an unparseable one, a suite-level failure, or a case name with no matching file), it re-runs
the whole directory instead, into `maestro-retry/<dir>/__all__.xml`. Only names matching
SAFE are ever printed, so the shell loop that reads them never sees anything but a path.

Exit codes: the workflows touch `maestro-results/<dir>/maestro-failed` when a directory's
`maestro test` exits non-zero, and `<retry report>.failed` when a retry does. A directory
whose report has no test case at all, or whose run exited non-zero although its report shows
no failed case, is re-run whole and counts as failed unless that retry passes. A retry report
with no case, or with a non-zero exit, never counts as a pass.
"""

from __future__ import annotations

import glob
import os
import re
import sys
import xml.etree.ElementTree as ET

RESULTS = "maestro-results"
RETRY = "maestro-retry"
FLOWS = "e2e/maestro/flows"
WHOLE_DIR = "__all__"
FAILED_MARKER = "maestro-failed"
SAFE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")

# (test case name, or None for a suite with no cases; failed). A string, so `str | None` is
# never evaluated at runtime: with `from __future__ import annotations` every annotation that
# uses it stays a string too, and the runners' python3 may predate 3.10.
Case = "tuple[str | None, bool]"


def _count(suite: ET.Element, attr: str) -> int:
    try:
        return int(suite.get(attr, 0))
    except (TypeError, ValueError):
        return 1


def parse_report(path: str) -> list[Case] | None:
    """Every case in a junit report, or None when it is missing or unparseable."""
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError):
        return None
    suites = root.findall("testsuite") if root.tag == "testsuites" else [root]
    cases: list[Case] = []
    for suite in suites:
        found = suite.findall("testcase")
        if not found:
            cases.append((None, _count(suite, "failures") + _count(suite, "errors") > 0))
        for case in found:
            failed = case.find("failure") is not None or case.find("error") is not None
            cases.append((case.get("name", "unknown"), failed))
    return cases


def _needs_whole_dir(directory: str, cases: list[Case] | None, results: str) -> bool:
    """No usable report, no test case at all, or a non-zero exit the report doesn't explain."""
    if cases is None or not any(name is not None for name, _ in cases):
        return True
    exited_non_zero = os.path.exists(os.path.join(results, directory, FAILED_MARKER))
    return exited_non_zero and not any(failed for _, failed in cases)


def plan(
    directory: str, results: str = RESULTS, flows: str = FLOWS, retry: str = RETRY
) -> list[tuple[str, str]]:
    """(flow path, retry report path) pairs to re-run for one directory."""
    if not SAFE.match(directory):
        return []
    whole = [(f"{flows}/{directory}/", f"{retry}/{directory}/{WHOLE_DIR}.xml")]
    cases = parse_report(os.path.join(results, directory, "report.xml"))
    if _needs_whole_dir(directory, cases, results):
        return whole
    pairs = []
    for name, failed in cases:
        if not failed:
            continue
        if (
            name is None
            or not SAFE.match(name)
            or not os.path.isfile(os.path.join(flows, directory, f"{name}.yaml"))
        ):
            return whole
        pairs.append((f"{flows}/{directory}/{name}.yaml", f"{retry}/{directory}/{name}.xml"))
    return pairs


def outcomes(directory: str, retry: str = RETRY) -> dict[str | None, bool]:
    """Case name -> passed on the retry, over every retry report of a directory.

    Empty when nothing was retried (no nightly, or nothing failed)."""
    merged: dict[str | None, bool] = {}
    for path in sorted(glob.glob(os.path.join(retry, directory, "*.xml"))):
        cases = parse_report(path)
        if (
            cases is None
            or not any(name is not None for name, _ in cases)
            or (os.path.exists(f"{path}.failed") and not any(failed for _, failed in cases))
        ):
            # Unreadable, empty, or a non-zero exit the report doesn't explain: not a pass.
            merged[f"<{os.path.basename(path)}>"] = False
            continue
        for name, failed in cases:
            merged[name] = merged.get(name, True) and not failed
    return merged


def dir_passed(retried: dict[str | None, bool]) -> bool:
    """True when a retry ran and every case in it passed."""
    return bool(retried) and all(retried.values())


def case_passed_on_retry(name: str | None, retried: dict[str | None, bool]) -> bool:
    if name in retried:
        return retried[name]
    # A suite-level failure re-ran the whole directory, whose cases have their own names.
    return name is None and dir_passed(retried)


def remaining_failures(projects: list[str], results: str = RESULTS, retry: str = RETRY):
    """`<dir>` or `<dir>/<flow>` for every failure the retry did not clear."""
    left = []
    for directory in projects:
        retried = outcomes(directory, retry)
        cases = parse_report(os.path.join(results, directory, "report.xml"))
        if _needs_whole_dir(directory, cases, results):
            if not dir_passed(retried):
                left.append(directory)
            continue
        for name, failed in cases:
            if failed and not case_passed_on_retry(name, retried):
                left.append(f"{directory}/{name}" if name else directory)
    return left


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "plan":
        for flow, report in plan(argv[1]):
            print(f"{flow} {report}")
        return 0
    if argv and argv[0] == "verdict":
        left = remaining_failures(argv[1:])
        for item in left:
            print(f"::error::Maestro flow {item} failed, and failed again on retry")
        if not left:
            print("Every Maestro flow passed (some may have passed on retry; see the summary).")
        return 1 if left else 0
    print("usage: retry.py plan <dir> | retry.py verdict <dir> ...", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
