/**
 * The app's release version (#3858), for data that says which build made it (Cascade's
 * `game_started`). `package.json`'s `version`, which the release workflow
 * (`.github/workflows/version-sync.yml`) sets on every release together with `app.json`, the
 * Gradle `versionName` and the Xcode `MARKETING_VERSION`; `__tests__/appVersion.test.ts` holds it
 * equal to `app.json`. A dev build between releases reports the last release's version.
 */
import { version } from "../../package.json";

export const APP_VERSION: string = version;
