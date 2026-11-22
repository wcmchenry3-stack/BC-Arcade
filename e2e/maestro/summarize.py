#!/usr/bin/env python3
"""Write the Maestro job summary (a Flow | Result table) to $GITHUB_STEP_SUMMARY.

Usage: python3 e2e/maestro/summarize.py <platform> <scope-label> [<projects>]

Shared by mobile-smoke-android.yml and mobile-smoke-ios.yml. The smoke
workflows run one `maestro test --format junit --test-suite-name <dir>
--output maestro-results/<dir>/report.xml` per flow directory, so a single
directory's failure can't abort the rest (#2350). This reads those reports
and writes one row per flow, labelled `<dir>/<flow>`.

<projects> is the space-separated directory list the job ran
(detect-maestro-scope's `projects` output). A directory in it with no
report.xml gets its own failure row: that is what a flow file that fails to
parse, or a crashed runner, looks like (#2400). Without <projects>, only the
directories that have a report are listed.

Nightly retry (#4054): when the run retried failed flows (e2e/maestro/retry.py, reports in
maestro-retry/<dir>/), a flow that failed and then passed shows as "PASS on retry" and is
counted on its own line. The count also goes to $GITHUB_OUTPUT as `passed_on_retry`. Without
a maestro-retry/ directory the table is exactly what it was before.
"""

import glob
import os
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import retry  # sibling module; this file runs as a script

RESULTS = "maestro-results"
FAIL = "❌ FAIL"
PASS = "✅ PASS"
RETRY_PASS = "🔁 PASS on retry"


def _count(suite: ET.Element, attr: str) -> int:
    """A suite's failures/errors count; a malformed value counts as one failure."""
    try:
        return int(suite.get(attr, 0))
    except (TypeError, ValueError):
        return 1


def _result(failed: bool, name, retried: dict) -> str:
    if not failed:
        return PASS
    return RETRY_PASS if retry.case_passed_on_retry(name, retried) else FAIL


def _dir_rows(directory: str, report: str, retried: dict) -> list[str]:
    try:
        root = ET.parse(report).getroot()
    except ET.ParseError as exc:
        if retry.dir_passed(retried):
            return [f"| `{directory}` | {RETRY_PASS} _(parse error in {report}: {exc})_ |\n"]
        return [f"| `{directory}` | _(parse error in {report}: {exc})_ |\n"]
    suites = root.findall("testsuite") if root.tag == "testsuites" else [root]
    rows = []
    for suite in suites:
        cases = suite.findall("testcase")
        if not cases:
            failed = _count(suite, "failures") + _count(suite, "errors")
            rows.append(f"| `{directory}` | {_result(bool(failed), None, retried)} |\n")
        for case in cases:
            name = case.get("name", "unknown")
            failed = case.find("failure") is not None or case.find("error") is not None
            rows.append(f"| `{directory}/{name}` | {_result(failed, name, retried)} |\n")
    return rows


def build_rows(projects: list[str]) -> list[str]:
    reports = {
        os.path.basename(os.path.dirname(path)): path
        for path in glob.glob(os.path.join(RESULTS, "*", "report.xml"))
    }
    directories = list(projects) + sorted(d for d in reports if d not in projects)
    rows = []
    for directory in directories:
        report = reports.get(directory)
        retried = retry.outcomes(directory)
        if report is None:
            result = RETRY_PASS if retry.dir_passed(retried) else FAIL
            rows.append(
                f"| `{directory}` | {result} _(no report: flow parse error or runner crash)_ |\n"
            )
        else:
            rows.extend(_dir_rows(directory, report, retried))
    if not rows:
        rows.append(
            "| _(no reports — test runner may have crashed before any directory ran)_ | — |\n"
        )
    return rows


def main(platform: str, label: str, projects: list[str]) -> None:
    out = os.environ.get("GITHUB_STEP_SUMMARY", "/dev/stdout")
    rows = build_rows(projects)
    passed_on_retry = sum(RETRY_PASS in row for row in rows)
    with open(out, "a") as f:
        f.write(f"## Maestro {platform} Smoke ({label})\n\n| Flow | Result |\n|---|---|\n")
        f.writelines(rows)
        if passed_on_retry:
            f.write(f"\n**Passed on retry:** {passed_on_retry} flow(s) failed once, then passed.\n")
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a") as f:
            f.write(f"passed_on_retry={passed_on_retry}\n")


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        sys.exit("usage: summarize.py <platform> <scope-label> [<projects>]")
    main(sys.argv[1], sys.argv[2], sys.argv[3].split() if len(sys.argv) == 4 else [])
