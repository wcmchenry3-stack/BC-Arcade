/**
 * NetInfo-backed hook exposing live network connectivity state.
 *
 * Before NetInfo's first report `isOnline` is optimistically true (so UI does
 * not flash an "offline" banner at boot) and `isInitialized` is false.
 * `isInitialized` flips true after the first NetInfo event. Code that must not
 * fire a request while possibly offline (e.g. at cold start) should gate on
 * `isInitialized && isOnline`, not `isOnline` alone (#4090).
 */

import NetInfo, { NetInfoState } from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

export interface NetworkStatus {
  isOnline: boolean;
  isInitialized: boolean;
}

function toOnline(state: NetInfoState): boolean {
  // `isInternetReachable` can be null on some platforms before the first
  // reachability check completes. Treat null as "assume reachable" when
  // `isConnected` is true — otherwise we'd flash offline on every boot.
  if (!state.isConnected) return false;
  return state.isInternetReachable !== false;
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isOnline: true,
    isInitialized: false,
  });

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (cancelled) return;
      setStatus({ isOnline: toOnline(state), isInitialized: true });
    });
    // Also do an immediate fetch in case the listener hasn't fired yet.
    NetInfo.fetch()
      .then((state) => {
        if (cancelled) return;
        setStatus({ isOnline: toOnline(state), isInitialized: true });
      })
      .catch(() => {
        // A failed fetch must not leave the status uninitialized forever: gated
        // requests (#4090) would never run. Keep the optimistic `isOnline` and
        // let a later listener event correct it.
        if (cancelled) return;
        setStatus((prev) => (prev.isInitialized ? prev : { ...prev, isInitialized: true }));
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return status;
}
