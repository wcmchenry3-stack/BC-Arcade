/**
 * The drag debug overlay's touch line (#3878): diagnostics for a drag that
 * left no `drag #N` line at all.
 *
 * On the iOS simulator a flow's first swipe sometimes leaves no drag debug
 * line and no move (#3878, #3832). From the existing lines alone that can't be
 * told apart from a swipe that never reached a card. This line can: it counts,
 * per app process, what each layer saw.
 *
 *   down    touches a draggable card's pan saw begin (UI thread, onBegin)
 *   active  pans that activated (UI thread, onStart)
 *   end     activated pans that ended (UI thread, onEnd / onFinalize)
 *   js      drag starts the JS thread has handled (the onStart hop)
 *   lag     the last drag's onStart → JS hop, in ms
 *
 * So `down=0` (line hidden): the touch never reached a card's pan. `active=0`:
 * the pan saw it but didn't activate. `active=1 js=0`: the JS thread hadn't
 * handled the start yet (busy). A large `lag`: it handled it late, which is
 * what leaves the ghost unmounted for the whole swipe
 * (`drag-check: unmeasured notMounted`).
 *
 * The line is drawn from the UI thread (an animated TextInput), so it still
 * updates while the JS thread is blocked, which is the case it must show.
 *
 * Internal builds with the overlay on only. A card holds the counters and the
 * setting's shared value (dragDebug.ts) for the whole process and its pan
 * worklets read that flag at each phase, so the setting can flip after cards
 * mount without rebuilding their gestures, and a card writes nothing while it
 * is off. A store build gets neither (null: no flag, no counters, no reads).
 * Each count is one shared-value read, and with the overlay on one write, per
 * gesture phase (never per frame), with no storage or network.
 */
import { makeMutable } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";

import { getDragDebugEnabledFlag, isDragDebugEnabled } from "./dragDebug";

export const DRAG_DEBUG_TOUCH_TEST_ID = "drag-debug-touch";

/** The UI thread's counts. Written by the pan worklets only. */
export interface DragDebugTouchUi {
  readonly down: number;
  readonly active: number;
  readonly end: number;
}
export type DragDebugTouchPhase = keyof DragDebugTouchUi;

/** The JS thread's counts. Written by the JS thread only, so neither side
 *  ever writes back a stale copy of the other's counts. */
export interface DragDebugTouchJs {
  readonly js: number;
  /** The last drag's onStart → JS hop, ms; -1 before the first. */
  readonly lagMs: number;
}

export interface DragDebugTouch {
  readonly ui: SharedValue<DragDebugTouchUi>;
  readonly js: SharedValue<DragDebugTouchJs>;
}

const UI_ZERO: DragDebugTouchUi = { down: 0, active: 0, end: 0 };
const JS_ZERO: DragDebugTouchJs = { js: 0, lagMs: -1 };

let touch: DragDebugTouch | null = null;
let jsCount = 0;

/** The process's counters, made on first use. */
export function getDragDebugTouch(): DragDebugTouch {
  return (touch ??= { ui: makeMutable(UI_ZERO), js: makeMutable(JS_ZERO) });
}

/** The counters the JS thread should write: null (write nothing) while the
 *  overlay is off, and always in a store build. */
export function dragDebugTouchIfEnabled(): DragDebugTouch | null {
  return isDragDebugEnabled() ? getDragDebugTouch() : null;
}

/** Counts one pan phase (declared before its worklet callers, which the
 *  worklets transform needs). A worklet: UI thread, once per gesture phase. */
export function bumpDragDebugTouch(ui: SharedValue<DragDebugTouchUi>, phase: DragDebugTouchPhase) {
  "worklet";
  const c = ui.value;
  ui.value = {
    down: c.down + (phase === "down" ? 1 : 0),
    active: c.active + (phase === "active" ? 1 : 0),
    end: c.end + (phase === "end" ? 1 : 0),
  };
}

/** What a card's pan worklets hold: the UI counters and the setting's flag. */
export interface DragDebugTouchCard {
  readonly on: SharedValue<boolean>;
  readonly ui: SharedValue<DragDebugTouchUi>;
}

let card: DragDebugTouchCard | null = null;

/** The card's handle, the same object for the whole process (a stable memo
 *  dep whatever the setting does); null in a store build. */
export function dragDebugTouchForCard(): DragDebugTouchCard | null {
  const on = getDragDebugEnabledFlag();
  if (!on) return null;
  if (card?.on !== on) card = { on, ui: getDragDebugTouch().ui };
  return card;
}

/** Counts one pan phase if the overlay is on. A worklet: UI thread, once per
 *  gesture phase; one read, and a write only while on. */
export function noteDragDebugTouch(c: DragDebugTouchCard | null, phase: DragDebugTouchPhase) {
  "worklet";
  if (c && c.on.value) bumpDragDebugTouch(c.ui, phase);
}

/** Counts a drag start handled on the JS thread; `activatedAt` is the
 *  onStart worklet's Date.now(). JS thread, once per drag. */
export function noteDragDebugTouchJs(t: DragDebugTouch, activatedAt: number): void {
  jsCount += 1;
  t.js.value = { js: jsCount, lagMs: Math.max(0, Date.now() - activatedAt) };
}

/** `touch down=1 active=1 end=1 js=1 lag=845ms`. A worklet. */
export function formatDragDebugTouch(ui: DragDebugTouchUi, js: DragDebugTouchJs): string {
  "worklet";
  const lag = js.lagMs < 0 ? "none" : `${Math.round(js.lagMs)}ms`;
  return `touch down=${ui.down} active=${ui.active} end=${ui.end} js=${js.js} lag=${lag}`;
}

/** Test-only reset. @internal */
export function resetDragDebugTouchForTests(): void {
  touch = null;
  card = null;
  jsCount = 0;
}
