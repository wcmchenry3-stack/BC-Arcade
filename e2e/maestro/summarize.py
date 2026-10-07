#!/usr/bin/env python3
"""Write the Maestro job summary (a Flow | Result table) to $GITHUB_STEP_SUMMARY.

Usage: python3 e2e/maestro/summarize.py <platform> <scope-label>

Shared by mobile-smoke-android.yml and mobile-smoke-ios.yml. Reads one
report.xml per flow directory (maestro-results/<dir>/report.xml) — the smoke
workflows run one `maestro test --output maestro-results/<dir>` per directory
so a single directory's failure can't abort the rest (#2350).
"""
import glob
import os
import sys
import xml.etree.ElementTree as ET


def main(platform: str, label: str) -> None:
    out = os.environ.get("GITHUB_STEP_SUMMARY", "/dev/stdout")
    rows = []
    reports = sorted(glob.glob("maestro-results/*/report.xml"))
    if not reports:
        rows.append("| _(no reports — test runner may have crashed before any directory ran)_ | — |\n")
    for report in reports:
        try:
            root = ET.parse(report).getroot()
            suites = root.findall("testsuite") if root.tag == "testsuites" else [root]
            for s in suites:
                name = s.get("name", "unknown").removeprefix("e2e/maestro/flows/").removesuffix(".yaml")
                failed = int(s.get("failures", 0)) + int(s.get("errors", 0))
                rows.append(f'| `{name}` | {"❌ FAIL" if failed else "✅ PASS"} |\n')
        except ET.ParseError as exc:
            rows.append(f"| _(parse error in {report}: {exc})_ | — |\n")
    with open(out, "a") as f:
        f.write(f"## Maestro {platform} Smoke ({label})\n\n| Flow | Result |\n|---|---|\n")
        f.writelines(rows)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: summarize.py <platform> <scope-label>")
    main(sys.argv[1], sys.argv[2])
