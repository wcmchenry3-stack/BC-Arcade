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
"""

import glob
import os
import sys
import xml.etree.ElementTree as ET

RESULTS = "maestro-results"


def _count(suite: ET.Element, attr: str) -> int:
    """A suite's failures/errors count; a malformed value counts as one failure."""
    try:
        return int(suite.get(attr, 0))
    except (TypeError, ValueError):
        return 1


def _dir_rows(directory: str, report: str) -> list[str]:
    try:
        root = ET.parse(report).getroot()
    except ET.ParseError as exc:
        return [f"| `{directory}` | _(parse error in {report}: {exc})_ |\n"]
    suites = root.findall("testsuite") if root.tag == "testsuites" else [root]
    rows = []
    for suite in suites:
        cases = suite.findall("testcase")
        if not cases:
            failed = _count(suite, "failures") + _count(suite, "errors")
            rows.append(f'| `{directory}` | {"❌ FAIL" if failed else "✅ PASS"} |\n')
        for case in cases:
            name = case.get("name", "unknown")
            failed = case.find("failure") is not None or case.find("error") is not None
            rows.append(f'| `{directory}/{name}` | {"❌ FAIL" if failed else "✅ PASS"} |\n')
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
        if report is None:
            rows.append(
                f"| `{directory}` | ❌ FAIL _(no report: flow parse error or runner crash)_ |\n"
            )
        else:
            rows.extend(_dir_rows(directory, report))
    if not rows:
        rows.append(
            "| _(no reports — test runner may have crashed before any directory ran)_ | — |\n"
        )
    return rows


def main(platform: str, label: str, projects: list[str]) -> None:
    out = os.environ.get("GITHUB_STEP_SUMMARY", "/dev/stdout")
    rows = build_rows(projects)
    with open(out, "a") as f:
        f.write(f"## Maestro {platform} Smoke ({label})\n\n| Flow | Result |\n|---|---|\n")
        f.writelines(rows)


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        sys.exit("usage: summarize.py <platform> <scope-label> [<projects>]")
    main(sys.argv[1], sys.argv[2], sys.argv[3].split() if len(sys.argv) == 4 else [])
