/**
 * @jest-environment node
 *
 * React / react-native-renderer version guard
 * -------------------------------------------
 * React 19 enforces an exact version match between the `react` package and
 * the renderer bundled by react-native. A patch-level divergence causes a
 * fatal startup crash in production (Sentry BC_GAMES-46, build 82).
 *
 * This test reads both versions directly from node_modules so it fails in CI
 * the moment a Dependabot bump upgrades one without the other.
 */

import * as fs from "fs";
import * as path from "path";

const nodeModules = path.resolve(__dirname, "../../../node_modules");

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
}

describe("React version compatibility", () => {
  it("react package version exactly matches the version react-native-renderer expects", () => {
    const reactVersion = readJson(path.join(nodeModules, "react/package.json")).version as string;

    // react-native compiles a hardcoded version equality check into its renderer:
    //   "<expected>" !== isomorphicReactPackageVersion
    // Grab the expected version from that source so the test stays accurate
    // across react-native upgrades without manual maintenance.
    const rendererPath = path.join(
      nodeModules,
      "react-native/Libraries/Renderer/implementations/ReactNativeRenderer-dev.js"
    );
    expect(fs.existsSync(rendererPath)).toBe(true);

    const rendererSource = fs.readFileSync(rendererPath, "utf-8");
    const match = rendererSource.match(/"(\d+\.\d+\.\d+)" !== isomorphicReactPackageVersion/);
    expect(match).not.toBeNull();
    const rendererExpectedVersion = match![1];

    expect(reactVersion).toBe(rendererExpectedVersion);
  });
});
