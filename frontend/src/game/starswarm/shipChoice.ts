import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { DEFAULT_SHIP_ID, SHIP_IDS } from "./render/ship";
import type { ShipId } from "./render/ship";

/**
 * #3600: the player's chosen Star Swarm ship, kept on the device so the next run flies it. Purely
 * cosmetic and local: not sent to the server, not part of the profile, not in any event.
 */

export const SHIP_STORAGE_KEY = "starswarm.ship";

/** The stored ship, or the default when nothing valid is stored or storage fails. Never rejects. */
export async function loadShip(): Promise<ShipId> {
  try {
    const raw = await AsyncStorage.getItem(SHIP_STORAGE_KEY);
    return SHIP_IDS.find((id) => id === raw) ?? DEFAULT_SHIP_ID;
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "starswarmShip", op: "load" } });
    return DEFAULT_SHIP_ID;
  }
}

/** Never rejects. */
export async function saveShip(ship: ShipId): Promise<void> {
  try {
    await AsyncStorage.setItem(SHIP_STORAGE_KEY, ship);
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "starswarmShip", op: "save" } });
  }
}

export interface ShipChoice {
  /** The default until the stored ship loads, then the stored one (or whatever was tapped). */
  ship: ShipId;
  /** A tap in the picker: applies at once, stores nothing. */
  setShip: (ship: ShipId) => void;
  /**
   * Stores the ship a run starts with (called when a run starts: Start, Play Again). Writes only when the player
   * tapped a ship: with no tap there is nothing new to keep (the default, or what is stored).
   */
  rememberShip: () => void;
}

/**
 * The ship of the next run, restored on mount. A ship tapped before the stored one loads wins, so
 * the late read never overrides the player.
 */
export function useShipChoice(): ShipChoice {
  const [ship, setState] = useState<ShipId>(DEFAULT_SHIP_ID);
  const shipRef = useRef(ship);
  const chosenRef = useRef(false);

  useEffect(() => {
    let alive = true;
    void loadShip().then((stored) => {
      if (alive && !chosenRef.current) {
        shipRef.current = stored;
        setState(stored);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const setShip = useCallback((next: ShipId) => {
    chosenRef.current = true;
    shipRef.current = next;
    setState(next);
  }, []);

  const rememberShip = useCallback(() => {
    if (chosenRef.current) void saveShip(shipRef.current);
  }, []);

  return { ship, setShip, rememberShip };
}
