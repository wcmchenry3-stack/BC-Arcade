/**
 * #3934: keyboard aiming for Cascade on web. With the board focused: Left / Right move the aim one
 * step (`MOTION.aim.keyStep`), Shift + arrow a big step (`keyStepBig`), Space or Enter drops at the
 * aim, Escape cancels it. The first arrow starts aiming from the spawner's centre.
 *
 * It writes the same aim shared values as a drag (`useAimGesture`), so the board's guide, the
 * glides and Reduce Motion are the drag's, with no drawing code of their own. The drop goes
 * through the screen's drop path (`onDrop`, `handleTap`), so every gate applies there (the
 * cooldown, `canDrop()`, settling, game over, away); a refused aimed drop glides the piece back,
 * as a refused release does. Arrows move the aim while a drop is gated (as a drag may); only
 * `enabled` (game over) silences the keys.
 *
 * Web only: on iOS and Android `attach` does nothing and the board is not focusable. The listeners
 * go on the DOM node (React Native's View has no key props); `attach` is a callback ref.
 * No haptic, and nothing per frame: a key press is a few shared-value writes on the JS thread.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { AIM_STATE } from "../../game/cascade/aim";
import { WALL_THICKNESS, WORLD_WIDTH } from "../../game/cascade/constants";
import { SPAWNER } from "../../game/cascade/lidVisuals";
import { MOTION } from "../../game/cascade/motion";
import type { BoardMotionValues } from "./useBoardMotion";

/** The slice of a DOM KeyboardEvent the handler reads. */
export interface AimKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly repeat?: boolean;
  preventDefault(): void;
}

/** The slice of a DOM element `attach` uses. */
export interface AimKeyTarget {
  addEventListener(type: string, listener: (e: never) => void): void;
  removeEventListener(type: string, listener: (e: never) => void): void;
  setAttribute?(name: string, value: string): void;
  matches?(selector: string): boolean;
}

export interface AimKeyboardOptions {
  readonly values: BoardMotionValues;
  readonly wake: () => void;
  /** False while play cannot take input (game over, a win): the keys do nothing. */
  readonly enabled: boolean;
  /** The screen's drop path (aim-area's `drop`): the world x, and whether it was aimed. */
  readonly onDrop: (worldX: number, aimed: boolean) => void;
}

/** The aim x one step on, kept between the walls (the drop clamps by the piece's radius). */
export function aimKeyStepX(x: number, direction: -1 | 1, big: boolean): number {
  const step = big ? MOTION.aim.keyStepBig : MOTION.aim.keyStep;
  return Math.max(WALL_THICKNESS, Math.min(WORLD_WIDTH - WALL_THICKNESS, x + direction * step));
}

export function useAimKeyboard({ values, wake, enabled, onDrop }: AimKeyboardOptions) {
  const { aimState, aimX, aimAt, aimFromX } = values;
  // True while the keyboard owns the aim (a drag's aim is never moved by keys).
  const keyAiming = useRef(false);
  const [focusVisible, setFocusVisible] = useState(false);
  const cleanup = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    if (!keyAiming.current) return false;
    keyAiming.current = false;
    aimFromX.set(aimX.get());
    aimState.set(AIM_STATE.cancelled);
    aimAt.set(Number.NaN); // the UI thread stamps "now" (useBoardMotion)
    wake();
    return true;
  }, [aimAt, aimFromX, aimState, aimX, wake]);

  const handleKey = useCallback(
    (e: AimKeyEvent): void => {
      if (!enabled || e.ctrlKey || e.altKey || e.metaKey) return;
      const state = aimState.get();
      // A finger or mouse is aiming: its gesture owns the aim.
      const pointerOwns =
        state === AIM_STATE.pressed || (state === AIM_STATE.aiming && !keyAiming.current);
      if (pointerOwns) return;
      switch (e.key) {
        case "ArrowLeft":
        case "ArrowRight": {
          e.preventDefault();
          const from = keyAiming.current ? aimX.get() : SPAWNER.cx;
          aimX.set(aimKeyStepX(from, e.key === "ArrowLeft" ? -1 : 1, e.shiftKey));
          if (!keyAiming.current) {
            keyAiming.current = true;
            aimState.set(AIM_STATE.aiming);
            aimAt.set(Number.NaN);
          }
          wake();
          return;
        }
        case " ":
        case "Enter": {
          e.preventDefault();
          if (e.repeat) return;
          if (keyAiming.current) {
            keyAiming.current = false;
            const x = aimX.get();
            // The release fades the guide; a refused drop glides back (the area's `drop`).
            aimState.set(AIM_STATE.released);
            aimAt.set(Number.NaN);
            wake();
            onDrop(x, true);
          } else {
            onDrop(SPAWNER.cx, false); // no aim: the middle, as the accessibility action does
          }
          return;
        }
        case "Escape":
          if (cancel()) e.preventDefault();
          return;
        default:
          return;
      }
    },
    [aimAt, aimState, aimX, cancel, enabled, onDrop, wake]
  );

  // The latest handler, so the DOM listener never goes stale.
  const handler = useRef(handleKey);
  const cancelRef = useRef(cancel);
  useEffect(() => {
    handler.current = handleKey;
    cancelRef.current = cancel;
  }, [handleKey, cancel]);

  const attach = useCallback((node: unknown) => {
    cleanup.current?.();
    cleanup.current = null;
    const el = node as AimKeyTarget | null;
    if (Platform.OS !== "web" || !el || typeof el.addEventListener !== "function") return;
    const onKeyDown = (e: AimKeyEvent) => handler.current(e);
    const onFocus = () => {
      // Only a keyboard focus draws the ring, not a click (`:focus-visible`).
      let visible = true;
      try {
        visible = el.matches?.(":focus-visible") ?? true;
      } catch {
        visible = true;
      }
      setFocusVisible(visible);
    };
    const onBlur = () => {
      setFocusVisible(false);
      cancelRef.current(); // focus left mid-aim: the aim is abandoned, nothing drops
    };
    el.setAttribute?.(
      "aria-keyshortcuts",
      "ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight Space Enter Escape"
    );
    el.addEventListener("keydown", onKeyDown as (e: never) => void);
    el.addEventListener("focus", onFocus);
    el.addEventListener("blur", onBlur);
    cleanup.current = () => {
      el.removeEventListener("keydown", onKeyDown as (e: never) => void);
      el.removeEventListener("focus", onFocus);
      el.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => () => cleanup.current?.(), []);
  // Game over while the keyboard aims: drop the aim.
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled, cancel]);

  return { attach, focusVisible, handleKey, webKeyboard: Platform.OS === "web" };
}
