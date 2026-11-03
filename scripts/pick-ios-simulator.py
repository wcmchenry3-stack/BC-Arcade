#!/usr/bin/env python3
"""Pick (or create) an iPhone simulator for the Maestro iOS smoke leg.

Usage: python3 scripts/pick-ios-simulator.py [--prefer-major N]
           [--runtimes-json FILE --devices-json FILE]

Prints the chosen simulator's UDID on stdout (and nothing else); progress goes
to stderr. Used by .github/workflows/mobile-smoke-ios.yml instead of a
hardcoded `name=iPhone 16` destination, which broke when the macos-15 runner
image stopped offering that device to the selected Xcode (#2347).

Choice, in order:
1. Runtime: the newest available iOS runtime whose major version is
   --prefer-major (if given and present), otherwise the newest available iOS
   runtime of any version.
2. Device on that runtime: a base-model iPhone ("iPhone 16"), then a Pro
   ("iPhone 16 Pro"), then any other iPhone except SE, then an SE — newest
   model number first. The SE's small screen pushes tiles below the fold.
3. If the runtime has no iPhone at all, create one (`simctl create`) from the
   runtime's supported device types, using the same ranking.

--runtimes-json / --devices-json read `xcrun simctl list runtimes|devices
available -j` output from files instead of running xcrun, for local testing on
machines without Xcode. With them, a "create" is printed but not executed.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys

CI_DEVICE_NAME = "Maestro CI iPhone"


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def version_key(version: str) -> tuple[int, ...]:
    return tuple(int(x) for x in re.findall(r"\d+", version))


def simctl_json(*args: str) -> dict:
    out = subprocess.check_output(["xcrun", "simctl", "list", *args, "-j"])
    return json.loads(out)


def is_ios_runtime(rt: dict) -> bool:
    if rt.get("isAvailable") is False:
        return False
    if rt.get("platform"):
        return rt["platform"] == "iOS"
    return rt.get("identifier", "").startswith(
        "com.apple.CoreSimulator.SimRuntime.iOS-"
    )


def iphone_rank(name: str) -> tuple[int, int]:
    """Lower sorts first. Second element: negative model number (newest first)."""
    m = re.search(r"\d+", name)
    model = -int(m.group()) if m else 0
    if re.fullmatch(r"iPhone \d+", name):
        tier = 0
    elif re.fullmatch(r"iPhone \d+ Pro", name):
        tier = 1
    elif "SE" in name:
        tier = 3
    else:
        tier = 2
    return (tier, model)


def pick_runtime(runtimes: list[dict], prefer_major: str | None) -> dict:
    ios = sorted(
        (r for r in runtimes if is_ios_runtime(r)),
        key=lambda r: version_key(r["version"]),
    )
    if not ios:
        sys.exit(
            "error: no available iOS simulator runtime (xcrun simctl list runtimes available)"
        )
    log("Available iOS runtimes: " + ", ".join(r["version"] for r in ios))
    if prefer_major:
        preferred = [r for r in ios if r["version"].split(".")[0] == prefer_major]
        if preferred:
            return preferred[-1]
        log(
            f"No iOS {prefer_major}.x runtime available; falling back to the newest runtime."
        )
    return ios[-1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prefer-major", default=None)
    ap.add_argument("--runtimes-json")
    ap.add_argument("--devices-json")
    a = ap.parse_args()

    dry_run = bool(a.runtimes_json)
    if dry_run:
        with open(a.runtimes_json) as f:
            runtimes = json.load(f)["runtimes"]
        with open(a.devices_json) as f:
            devices = json.load(f)["devices"]
    else:
        runtimes = simctl_json("runtimes", "available")["runtimes"]
        devices = simctl_json("devices", "available")["devices"]

    runtime = pick_runtime(runtimes, a.prefer_major or None)
    rt_id = runtime["identifier"]
    log(f"Runtime: iOS {runtime['version']} ({rt_id})")

    iphones = [
        d
        for d in devices.get(rt_id, [])
        if d.get("name", "").startswith("iPhone") and d.get("isAvailable", True)
    ]
    if iphones:
        dev = min(iphones, key=lambda d: iphone_rank(d["name"]))
        log(f"Device: {dev['name']} ({dev['udid']}, state {dev.get('state', '?')})")
        print(dev["udid"])
        return

    types = [
        t
        for t in runtime.get("supportedDeviceTypes", [])
        if t.get("productFamily") == "iPhone" or t.get("name", "").startswith("iPhone")
    ]
    if not types:
        sys.exit(
            f"error: runtime {rt_id} has no iPhone device and no supported iPhone device type"
        )
    dtype = min(types, key=lambda t: iphone_rank(t["name"]))
    log(f"No iPhone on this runtime; creating '{CI_DEVICE_NAME}' as {dtype['name']}")
    cmd = ["xcrun", "simctl", "create", CI_DEVICE_NAME, dtype["identifier"], rt_id]
    if dry_run:
        log("dry run: " + " ".join(cmd))
        print("DRY-RUN-UDID")
        return
    print(subprocess.check_output(cmd, text=True).strip())


if __name__ == "__main__":
    main()
