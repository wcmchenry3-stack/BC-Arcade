/**
 * Tracked env files must not pin the Sentry environment (#851).
 *
 * Expo loads `.env.production` (then `.env`) into every production bundle, and
 * an explicit `EXPO_PUBLIC_SENTRY_ENVIRONMENT` beats the API-URL rule in
 * `sentryConfig.ts`. With `production` in `.env.production`, a Gradle release
 * bundle or the Render dev site built against the dev API still reported as
 * production; with `development` in `.env`, a store build would have reported
 * as development. The only safe value in a tracked file is none.
 */

import * as fs from "fs";
import * as path from "path";

const FRONTEND_ROOT = path.resolve(__dirname, "../../..");
const TRACKED_ENV_FILES = [".env", ".env.production", ".env.example"];

describe("tracked env files", () => {
  it.each(TRACKED_ENV_FILES)("%s does not set EXPO_PUBLIC_SENTRY_ENVIRONMENT", (file) => {
    const contents = fs.readFileSync(path.join(FRONTEND_ROOT, file), "utf8");
    const assignments = contents
      .split("\n")
      .filter((line) => /^\s*(export\s+)?EXPO_PUBLIC_SENTRY_ENVIRONMENT\s*=/.test(line));
    expect(assignments).toEqual([]);
  });
});
