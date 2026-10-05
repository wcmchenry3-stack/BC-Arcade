/**
 * Owns the `PurchaseAdapter` lifecycle (docs/IAP.md §9.1): `init` at launch,
 * the transaction listener, and the silent `syncOwned` once entitlements have
 * loaded. UI reads the adapter through `usePurchases()` and never imports the
 * store library.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as Sentry from "@sentry/react-native";
import { PREMIUM_GAMES, useEntitlementGate } from "../entitlements/EntitlementContext";
import { selectPurchaseAdapter } from "./selectAdapter";
import type { PurchaseAdapter } from "./types";
import { unavailablePurchaseAdapter } from "./unavailableAdapter";

export interface PurchaseContextValue {
  adapter: PurchaseAdapter;
  /** False when the adapter is the unavailable one: hide purchase/restore entry points. */
  isAvailable: boolean;
}

const PurchaseContext = createContext<PurchaseContextValue>({
  adapter: unavailablePurchaseAdapter,
  isAvailable: false,
});

export function PurchaseProvider({
  children,
  adapter: adapterOverride,
}: {
  children: React.ReactNode;
  /** Test/dev seam: use this adapter instead of the selector's. */
  adapter?: PurchaseAdapter;
}) {
  const { canPlay, isLoading, applyToken, refresh } = useEntitlementGate();

  // The selector needs applyToken, which changes identity only if the
  // entitlement provider is replaced; a ref keeps the adapter stable.
  const applyTokenRef = useRef(applyToken);
  applyTokenRef.current = applyToken;

  const adapter = useMemo(
    () =>
      adapterOverride ??
      selectPurchaseAdapter({ applyToken: (token) => applyTokenRef.current(token) }),
    [adapterOverride]
  );
  const isAvailable = adapter !== unavailablePurchaseAdapter;
  // The adapter whose init() has completed; syncOwned waits for it.
  const [initedAdapter, setInitedAdapter] = useState<PurchaseAdapter | null>(null);

  useEffect(() => {
    if (!isAvailable) return;
    let cancelled = false;
    const unsubscribe = adapter.onTransaction((e) => {
      // A grant or revocation that happened outside the paywall: re-read the token.
      if (e.kind === "owned" || e.kind === "revoked") void refresh();
    });
    adapter
      .init()
      .then(() => {
        if (!cancelled) setInitedAdapter(adapter);
      })
      .catch((e) => {
        if (!cancelled) {
          Sentry.captureException(e, { tags: { subsystem: "purchases", op: "init" } });
        }
      });
    return () => {
      cancelled = true;
      unsubscribe();
      void adapter.dispose().catch(() => {});
    };
  }, [adapter, isAvailable, refresh]);

  // Silent sync at launch, once the adapter is initialised and entitlements
  // have loaded: post store-owned products this session is missing. Never
  // prompts (docs/IAP.md §5). The once-flag is set only after a successful
  // sync, so a failed one is retried when the effect next re-runs.
  const syncedRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const ready = initedAdapter === adapter;
  useEffect(() => {
    if (!isAvailable || !ready || isLoading || syncedRef.current || syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    const entitled = new Set([...PREMIUM_GAMES].filter((slug) => canPlay(slug)));
    adapter
      .syncOwned(entitled)
      .then((r) => {
        if (r.error) {
          Sentry.addBreadcrumb({
            category: "purchases",
            message: "syncOwned incomplete",
            level: "warning",
            data: { error: r.error },
          });
        } else {
          syncedRef.current = true;
        }
      })
      .catch((e) => {
        Sentry.captureException(e, { tags: { subsystem: "purchases", op: "syncOwned" } });
      })
      .finally(() => {
        syncInFlightRef.current = false;
      });
  }, [adapter, isAvailable, ready, isLoading, canPlay]);

  const value = useMemo(() => ({ adapter, isAvailable }), [adapter, isAvailable]);
  return <PurchaseContext.Provider value={value}>{children}</PurchaseContext.Provider>;
}

export function usePurchases(): PurchaseContextValue {
  return useContext(PurchaseContext);
}
