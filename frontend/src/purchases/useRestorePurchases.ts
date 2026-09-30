/**
 * The explicit "Restore Purchases" action shared by the paywall and Settings
 * (Apple Guideline 3.1.1, docs/IAP.md §5, §9.3).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/react-native";
import { usePurchases } from "./PurchaseProvider";
import type { RestoreResult } from "./types";

export type RestoreStatus =
  | "idle"
  | "busy"
  | "restored" // something was restored or is already owned
  | "pending" // nothing restored yet, but an approval is waiting
  | "nothing" // the store account owns nothing to restore
  | "error";

export function statusOfRestore(result: RestoreResult): RestoreStatus {
  if (result.error) return "error";
  if (result.restored.length > 0 || result.alreadyOwned.length > 0) return "restored";
  if (result.pending.length > 0) return "pending";
  return "nothing";
}

export function useRestorePurchases() {
  const { adapter } = usePurchases();
  const [status, setStatus] = useState<RestoreStatus>("idle");
  const [result, setResult] = useState<RestoreResult | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const restore = useCallback(async (): Promise<RestoreResult | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setStatus("busy");
    try {
      const r = await adapter.restore();
      if (mounted.current) {
        setResult(r);
        setStatus(statusOfRestore(r));
      }
      return r;
    } catch (e) {
      Sentry.captureException(e, { tags: { subsystem: "purchases", op: "restore" } });
      if (mounted.current) setStatus("error");
      return null;
    } finally {
      inFlight.current = false;
    }
  }, [adapter]);

  return { restore, status, result, busy: status === "busy" };
}
