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

// node_modules lives in frontend/, one level above src/
const nodeModules = path.resolve(__dirname, "../../node_modules");

describe("React version compatibility", () => {
  it("react package version exactly matches the version react-native-renderer expects", () => {
    const reactPkg = JSON.parse(
      fs.readFileSync(path.join(nodeModules, "react/package.json"), "utf-8")
    ) as { version: string };
    const reactVersion = reactPkg.version;

    // react-native compiles a hardcoded version equality check into its renderer:
    //   "<expected>" !== isomorphicReactPackageVersion
    // Grab the expected version from that source so the test stays accurate
    // across react-native upgrades without manual maintenance.
    const rendererPath = path.join(
      nodeModules,
      "react-native/Libraries/Renderer/implementations/ReactNativeRenderer-dev.js"
    );
    if (!fs.existsSync(rendererPath)) {
      throw new Error(`Renderer not found at ${rendererPath} — was npm install run in frontend/?`);
    }

    const rendererSource = fs.readFileSync(rendererPath, "utf-8");
    const match = rendererSource.match(/"(\d+\.\d+\.\d+)" !== isomorphicReactPackageVersion/);
    if (!match) {
      throw new Error(
        "Could not find version check in ReactNativeRenderer-dev.js — renderer format may have changed"
      );
    }
    const rendererExpectedVersion = match[1];

    expect(reactVersion).toBe(rendererExpectedVersion);
  });
});
