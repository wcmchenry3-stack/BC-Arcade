/**
 * #4079: the gesture-handler version the `starswarm.shipStuck` event reports must be the one
 * installed. Bumping react-native-gesture-handler fails this until `rnghVersion.ts` follows.
 */
import { RNGH_VERSION } from "../rnghVersion";

it("matches the installed react-native-gesture-handler", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const installed = require("react-native-gesture-handler/package.json").version;
  expect(RNGH_VERSION).toBe(installed);
});
