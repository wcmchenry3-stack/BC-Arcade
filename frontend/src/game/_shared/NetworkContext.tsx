/**
 * App-wide offline state + automatic queue flushing on reconnect.
 *
 * Wraps the tree so any component can call `useNetwork()` to get
 * `{ isOnline, isInitialized }`. Internally watches for offline→online
 * transitions and flushes `SyncWorker` and the display-name sync (#2624)
 * exactly once per reconnect edge. Both also flush on foreground, and the
 * name sync once at launch.
 */

import React, { createContext, useContext, useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import * as Sentry from "@sentry/react-native";
import { NetworkStatus, useNetworkStatus } from "./useNetworkStatus";
import { clearLegacyScoreQueue } from "./legacyScoreQueue";
import {
  flushDisplayNameSync,
  registerDisplayNameSync,
  syncDisplayNameOnLaunch,
} from "./displayNameSync";
import { gameEventClient } from "./gameEventClient";
import { syncWorker } from "./syncWorker";
import { registerLogstoreTestHooks } from "./testHooks";
import { CapacityWarningToast } from "../../components/shared/CapacityWarningToast";

const NetworkContext = createContext<NetworkStatus>({
  isOnline: true,
  isInitialized: false,
});

// Every saved display name is also sent to the server (#2624).
registerDisplayNameSync();

function flushNameSync(op: string): void {
  flushDisplayNameSync().catch((e) => {
    Sentry.captureException(e, { tags: { subsystem: "displayNameSync", op } });
  });
}

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const status = useNetworkStatus();
  const wasOnlineRef = useRef<boolean>(status.isOnline);

  // Start the log SyncWorker interval on mount and stop it on unmount.
  // Also initialize the gameEventClient's in-memory pending-games state
  // and install e2e test hooks (no-op unless EXPO_PUBLIC_TEST_HOOKS=1).
  useEffect(() => {
    gameEventClient.init().catch((e) => {
      Sentry.captureException(e, {
        tags: { subsystem: "gameEventClient", op: "init" },
      });
    });
    syncWorker.start();
    // What an older build left in the removed score queue (#2644).
    void clearLegacyScoreQueue();
    // A stored name the server has never been sent (set before #2624) is
    // synced once; any pending name sync is retried.
    syncDisplayNameOnLaunch().catch((e) => {
      Sentry.captureException(e, { tags: { subsystem: "displayNameSync", op: "launch" } });
    });
    const unregisterTestHooks = registerLogstoreTestHooks();
    const appStateSub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        syncWorker.stop();
        Sentry.addBreadcrumb({
          category: "syncWorker",
          message: "paused (background)",
          level: "info",
        });
      } else if (next === "active") {
        syncWorker.start();
        syncWorker.flush().catch((e) => {
          Sentry.captureException(e, {
            tags: { subsystem: "syncWorker", op: "flush-on-foreground" },
          });
        });
        flushNameSync("flush-on-foreground");
        Sentry.addBreadcrumb({
          category: "syncWorker",
          message: "resumed (active)",
          level: "info",
        });
      }
    });
    return () => {
      appStateSub.remove();
      unregisterTestHooks();
      syncWorker.stop();
    };
  }, []);

  useEffect(() => {
    const prev = wasOnlineRef.current;
    wasOnlineRef.current = status.isOnline;
    // Trigger flush on the offline → online edge (only after init so the
    // initial "true → true" mount isn't misread as a reconnect).
    if (status.isInitialized && !prev && status.isOnline) {
      syncWorker.flush().catch((e) => {
        Sentry.captureException(e, { tags: { subsystem: "syncWorker", op: "flush-on-reconnect" } });
      });
      flushNameSync("flush-on-reconnect");
    }
  }, [status.isOnline, status.isInitialized]);

  return (
    <NetworkContext.Provider value={status}>
      {children}
      <CapacityWarningToast />
    </NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkStatus {
  return useContext(NetworkContext);
}
