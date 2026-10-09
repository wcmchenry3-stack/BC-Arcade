/**
 * @jest-environment ./jest-env/node.js
 *
 * render.yaml deployment config guard
 * ------------------------------------
 * Verifies that the frontend build uses fetch-render-env.js to merge env vars
 * into .env, and that EXPO_PUBLIC_API_URL points to the custom domain rather
 * than a Render internal hostname.
 */

import * as fs from "fs";
import * as path from "path";

const renderYamlPath = path.resolve(__dirname, "../../../render.yaml");
const renderYaml = fs.readFileSync(renderYamlPath, "utf-8");

describe("render.yaml deployment configuration", () => {
  it("frontend buildCommand runs fetch-render-env.js before expo export", () => {
    const scriptIdx = renderYaml.indexOf("fetch-render-env.js");
    const exportIdx = renderYaml.indexOf("expo export");
    expect(scriptIdx).toBeGreaterThan(-1);
    expect(exportIdx).toBeGreaterThan(scriptIdx);
  });

  it("EXPO_PUBLIC_API_URL uses the custom domain, not a Render hostname", () => {
    expect(renderYaml).toContain("https://dev-games-api.buffingchi.com");
    expect(renderYaml).not.toMatch(/EXPO_PUBLIC_API_URL[\s\S]*?\.onrender\.com/);
  });

  it("does not use fromService for EXPO_PUBLIC_API_URL", () => {
    // fromService with property:host returns a bare Render hostname that
    // previously caused a double-.onrender.com bug. The custom domain is
    // hardcoded directly to avoid this class of issue.
    expect(renderYaml).not.toMatch(/EXPO_PUBLIC_API_URL[\s\S]*?fromService:/);
  });
});
