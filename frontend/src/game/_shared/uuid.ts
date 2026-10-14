/**
 * UUID v4 generation from a CSPRNG only (#3303).
 *
 * The session id minted from this is the player's only credential: the
 * backend reads and deletes a player's data by `X-Session-ID`. So there is no
 * predictable fallback. When no CSPRNG is available, `generateUUID` throws
 * `CsprngUnavailableError` and the caller decides what to do (fail closed).
 *
 * Sources, in order:
 *   1. `expo-modules-core` `uuid.v4()`. On iOS and Android this is the native
 *      CoreModule's `uuidv4` (installed over JSI as `globalThis.expo`): iOS
 *      `UUID()` (system CSPRNG), Android `java.util.UUID.randomUUID()`
 *      (`SecureRandom`). On web it is `crypto.randomUUID()`. This is the source
 *      on release Hermes builds: Hermes, React Native and Expo's runtime install
 *      no `crypto` global, so sources 2 and 3 do not exist there. It is the same
 *      primitive `expo-crypto` uses, without adding an encryption library (the
 *      iOS export-compliance declaration, `releaseBuildConfig.test.ts`).
 *   2. `globalThis.crypto.randomUUID()` (web, Node, Jest).
 *   3. `globalThis.crypto.getRandomValues()` (web pages outside a secure
 *      context, where `randomUUID` is not exposed).
 */

import { uuid as expoUuid } from "expo-modules-core";

export class CsprngUnavailableError extends Error {
  constructor() {
    super("No cryptographically secure random source is available to mint a UUID");
    this.name = "CsprngUnavailableError";
  }
}

export type UuidSource = "expo-modules-core" | "crypto.randomUUID" | "crypto.getRandomValues";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_V4_RE.test(value) ? value.toLowerCase() : null;
}

function fromExpoNative(): string | null {
  try {
    return validUuid(expoUuid.v4());
  } catch {
    // Native CoreModule not installed, or (web) no crypto.randomUUID: try the globals.
    return null;
  }
}

function fromGlobalRandomUUID(): string | null {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") return null;
  try {
    return validUuid(crypto.randomUUID());
  } catch {
    return null;
  }
}

function fromGlobalRandomValues(): string | null {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") return null;
  try {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  } catch {
    return null;
  }
}

/** A UUID v4 and the CSPRNG it came from. Throws `CsprngUnavailableError` when there is none. */
export function generateUUIDWithSource(): { uuid: string; source: UuidSource } {
  const native = fromExpoNative();
  if (native) return { uuid: native, source: "expo-modules-core" };
  const random = fromGlobalRandomUUID();
  if (random) return { uuid: random, source: "crypto.randomUUID" };
  const values = fromGlobalRandomValues();
  if (values) return { uuid: values, source: "crypto.getRandomValues" };
  throw new CsprngUnavailableError();
}

/** A UUID v4 from a CSPRNG. Throws `CsprngUnavailableError` when there is none. */
export function generateUUID(): string {
  return generateUUIDWithSource().uuid;
}
