import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { createGameClient } from "../game/_shared/httpClient";
import { clearGame as clearHearts } from "../game/hearts/storage";
import { clearGame as clearYacht } from "../game/yacht/storage";
import { clearGame as clearSudoku } from "../game/sudoku/storage";
import { clearGame as clearCascade } from "../game/cascade/storage";
import { clearGame as clearSort } from "../game/sort/storage";
import { scoreQueue } from "../game/_shared/scoreQueue";
import type { GameType } from "../api/vocab";

// Maps premium game slugs to their AsyncStorage clear functions.
// starswarm has no local game state, so it is intentionally absent.
const GAME_STORAGE_CLEARERS: Partial<Record<string, () => Promise<void>>> = {
  hearts: clearHearts,
  yacht: clearYacht,
  sudoku: clearSudoku,
  cascade: clearCascade,
  sort: clearSort,
};

// Premium games — sourced from backend migration 0014_game_types_premium_cat
export const PREMIUM_GAMES = new Set(["yacht", "cascade", "hearts", "sudoku", "starswarm", "sort"]);

export const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export const TOKEN_STORAGE_KEY = "entitlement_token";
export const CACHED_AT_STORAGE_KEY = "entitlement_cached_at";

interface EntitlementJWTPayload {
  sub: string;
  entitled_games: string[];
  iat: number;
  exp: number;
}

function decodeJwtPayload(rawToken: string): EntitlementJWTPayload {
  const parts = rawToken.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT");
  const base64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(atob(padded)) as EntitlementJWTPayload;
}

export type ParseResult =
  | { valid: true; payload: EntitlementJWTPayload; expired: boolean }
  | { valid: false };

export interface EntitlementContextValue {
  /** Returns false for premium games while isLoading is true. Gate on isLoading before trusting the result. */
  canPlay: (gameSlug: string) => boolean;
  isLoading: boolean;
  lastRefreshed: Date | null;
}

const EntitlementContext = createContext<EntitlementContextValue>({
  canPlay: (slug) => !PREMIUM_GAMES.has(slug),
  isLoading: true,
  lastRefreshed: null,
});

const _entitlementsClient = createGameClient({ apiTag: "entitlements" });

export async function fetchRawToken(): Promise<string> {
  const res = await _entitlementsClient<{ token: string; expires_at: string }>("/entitlements");
  return res.token;
}

export async function parseRawToken(rawToken: string): Promise<ParseResult> {
  try {
    const payload = decodeJwtPayload(rawToken);
    const expired = Math.floor(Date.now() / 1000) > payload.exp;
    return { valid: true, payload, expired };
  } catch {
    return { valid: false };
  }
}

export async function loadCachedEntitlements(): Promise<Set<string>> {
  try {
    const pairs = await AsyncStorage.multiGet([TOKEN_STORAGE_KEY, CACHED_AT_STORAGE_KEY]);
    const token = pairs[0]?.[1] ?? null;
    const cachedAt = pairs[1]?.[1] ?? null;

    if (!token || !cachedAt) return new Set();

    const result = await parseRawToken(token);
    if (!result.valid) return new Set();

    if (!result.expired) return new Set(result.payload.entitled_games);

    // Expired token: grant access during offline grace period
    const ageMs = Date.now() - new Date(cachedAt).getTime();
    if (ageMs < OFFLINE_GRACE_MS) {
      console.warn(
        "[entitlements] Expired token within 7-day grace period — granting cached access"
      );
      return new Set(result.payload.entitled_games);
    }

    console.warn("[entitlements] Offline grace period expired — denying premium access");
    return new Set();
  } catch {
    return new Set();
  }
}

// Shared core: fetch a fresh token and apply it to state, falling back to
// the cache when the token is expired or undecodable (clock skew, TTL edge case).
async function fetchAndApplyToken(
  setEntitledGames: (games: Set<string>) => void,
  setLastRefreshed: (date: Date) => void
): Promise<void> {
  const rawToken = await fetchRawToken();
  const result = await parseRawToken(rawToken);
  if (result.valid && !result.expired) {
    await AsyncStorage.multiSet([
      [TOKEN_STORAGE_KEY, rawToken],
      [CACHED_AT_STORAGE_KEY, new Date().toISOString()],
    ]);
    setEntitledGames(new Set(result.payload.entitled_games));
    setLastRefreshed(new Date());
  } else {
    setEntitledGames(await loadCachedEntitlements());
  }
}

export function EntitlementProvider({ children }: { children: React.ReactNode }) {
  const [entitledGames, setEntitledGames] = useState<Set<string> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const prevEntitledRef = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    try {
      await fetchAndApplyToken(setEntitledGames, setLastRefreshed);
    } catch (e) {
      // Network errors (TypeError) are swallowed — in-memory state stays as-is.
      // Unlike init(), refresh() intentionally does not fall back to cache:
      // a transient error should not downgrade access the user already has.
      if (!(e instanceof TypeError)) {
        Sentry.addBreadcrumb({
          category: "entitlements",
          message: "token refresh failed",
          level: "warning",
          data: { error: String(e) },
        });
      }
    }
  }, []);

  useEffect(() => {
    async function init() {
      try {
        await fetchAndApplyToken(setEntitledGames, setLastRefreshed);
      } catch {
        setEntitledGames(await loadCachedEntitlements());
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  // Re-fetch on every foreground transition.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") {
        refresh();
      }
    });
    return () => sub.remove();
  }, [refresh]);

  // Detect revocations and clean up local state for any game no longer entitled.
  // Note: this effect fires after the new entitledGames state commits (canPlay has already
  // updated). Cleanup is fire-and-forget and completes before the next render cycle, so
  // the locked UI is shown while cleanup runs — intentional per issue #1056.
  useEffect(() => {
    if (entitledGames === null) return;
    const prev = prevEntitledRef.current;
    prevEntitledRef.current = entitledGames;
    if (prev === null) return; // first load — no prior entitlements to compare

    const revoked = [...PREMIUM_GAMES].filter((slug) => prev.has(slug) && !entitledGames.has(slug));
    if (revoked.length === 0) return;

    void Promise.all(
      revoked.map(async (slug) => {
        try {
          const clear = GAME_STORAGE_CLEARERS[slug];
          if (clear) await clear();
          await scoreQueue.dropByGameType(slug as GameType);
          console.log(`entitlement revoked: ${slug} — local state cleared`);
        } catch (e) {
          Sentry.captureException(e, {
            tags: { subsystem: "entitlements", op: "revocation" },
            extra: { slug },
          });
        }
      })
    );
  }, [entitledGames]);

  const canPlay = useCallback(
    (gameSlug: string): boolean => {
      if (!PREMIUM_GAMES.has(gameSlug)) return true;
      if (entitledGames === null) return false;
      return entitledGames.has(gameSlug);
    },
    [entitledGames]
  );

  return (
    <EntitlementContext.Provider value={{ canPlay, isLoading, lastRefreshed }}>
      {children}
    </EntitlementContext.Provider>
  );
}

export function useEntitlements(): EntitlementContextValue {
  return useContext(EntitlementContext);
}
