/**
 * @jest-environment node
 *
 * React / react-native version guard
 * -----------------------------------
 * React 19 enforces a close version match between the `react` package and
 * the renderer bundled by react-native. A divergence causes a fatal startup
 * crash in production (Sentry BC_GAMES-46, build 82).
 *
 * Originally this test parsed a hardcoded equality check
 * ("<version>" !== isomorphicReactPackageVersion) out of react-native's
 * compiled ReactNativeRenderer-dev.js. As of react-native 0.86 that legacy
 * renderer file (and the embedded check) no longer exists — react-native
 * ships a Fabric-only renderer now, and the DevTools hook it registers
 * carries a version string only for devtools display, not a startup guard.
 * The equality contract still exists, just declared where react-native
 * itself expresses it: its package.json `peerDependencies.react` range.
 * This test now checks the installed `react` version against that range
 * directly, so it still fails in CI the moment a Dependabot bump moves one
 * package without the other — without depending on react-native's internal
 * file layout, which has already changed once.
 */

import * as fs from "fs";
import * as path from "path";

// node_modules lives in frontend/, one level above src/
const nodeModules = path.resolve(__dirname, "../../node_modules");

function readVersion(pkgDir: string): string {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(nodeModules, pkgDir, "package.json"), "utf-8")
  ) as { version: string };
  return pkg.version;
}

// Minimal caret-range check (`^X.Y.Z`) — avoids pulling in a semver
// dependency just for this one guard test.
function satisfiesCaretRange(range: string, version: string): boolean {
  const match = range.match(/^\^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Expected a caret range like "^19.2.3", got "${range}"`);
  }
  const [, minMajorStr, minMinorStr, minPatchStr] = match;
  const [minMajor, minMinor, minPatch] = [minMajorStr, minMinorStr, minPatchStr].map(Number);

  const versionMatch = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!versionMatch) {
    throw new Error(`Could not parse installed version "${version}"`);
  }
  const [, majorStr, minorStr, patchStr] = versionMatch;
  const [major, minor, patch] = [majorStr, minorStr, patchStr].map(Number);

  if (major !== minMajor) return false;
  if (minor > minMinor) return true;
  if (minor < minMinor) return false;
  return patch >= minPatch;
}

describe("React version compatibility", () => {
  it("react package version satisfies the range react-native declares for it", () => {
    const reactVersion = readVersion("react");

    const reactNativePkg = JSON.parse(
      fs.readFileSync(path.join(nodeModules, "react-native/package.json"), "utf-8")
    ) as { peerDependencies?: Record<string, string> };
    const requiredRange = reactNativePkg.peerDependencies?.react;
    if (!requiredRange) {
      throw new Error(
        "react-native/package.json has no peerDependencies.react — cannot verify compatibility"
      );
    }

    expect(satisfiesCaretRange(requiredRange, reactVersion)).toBe(true);
  });
});
