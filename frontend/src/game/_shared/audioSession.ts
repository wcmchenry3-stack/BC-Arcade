import { Platform } from "react-native";
import { setIsAudioActiveAsync, type AudioPlayerOptions } from "expo-audio";

// Options for every in-game expo-audio player (BGM and SFX). See #2923.
//
// Why: on iOS, expo-audio (57.x, ios/AudioModule.swift) schedules deactivateSession() after
// every player.pause() and after every one-shot player finishes, unless that player was
// created with keepAudioSessionActive. deactivateSession() waits 100 ms and, if no player is
// *playing* at that instant, calls AVAudioSession.setActive(false). A freshly created BGM
// player that is still loading is not "playing", so a laser SFX finishing during that window
// (Star Swarm fires ~14/s) tears the session down under it and the music stays silent for the
// whole run. Opting every game player out means routine pauses and SFX completions never
// deactivate the session mid-game; play() still activates it as before.
//
// The option is iOS-only. Android's audio-focus handling ignores it (it releases focus when no
// player is playing, unchanged), and web ignores it.
export const GAME_AUDIO_PLAYER_OPTIONS: AudioPlayerOptions = { keepAudioSessionActive: true };

// Trade-off: with no automatic deactivation, nothing would hand the audio session back to
// other apps (Music, podcasts) when the player leaves a game. The app never calls
// setAudioModeAsync, so iOS uses its default non-mixable category: starting our audio stops
// other-app audio, and only a deactivation with .notifyOthersOnDeactivation lets it resume.
// So each game screen retains the session while its players exist, and when the last one is
// released we deactivate it explicitly via setIsAudioActiveAsync(false), which on iOS pauses
// any of our players and deactivates with .notifyOthersOnDeactivation. Net effect: other-app
// audio stays stopped for the whole game (before, it could flicker back on between SFX), and
// resumes when the player leaves the game screen, as it did before.
//
// The deactivation is iOS-only on purpose: on Android and web, setIsAudioActiveAsync(false)
// disables playback for every later player until it is set back to true, and those platforms
// never needed it because keepAudioSessionActive changes nothing there.
//
// The short delay absorbs a screen-to-screen hand-off (one game unmounting as another mounts)
// so the new screen's players aren't paused by the old screen's release.
export const SESSION_RELEASE_DELAY_MS = 300;

let holders = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Marks the audio session as in use by a game screen. Returns a release function (idempotent).
 * When the last holder releases, the session is deactivated on iOS after SESSION_RELEASE_DELAY_MS.
 */
export function retainAudioSession(): () => void {
  holders += 1;
  if (releaseTimer !== null) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders > 0 || Platform.OS !== "ios") return;
    if (releaseTimer !== null) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      releaseTimer = null;
      if (holders > 0) return;
      try {
        Promise.resolve(setIsAudioActiveAsync(false)).catch(() => {});
      } catch {
        // audio cleanup, failure is safe
      }
    }, SESSION_RELEASE_DELAY_MS);
  };
}

/**
 * Test-only: reset module state between tests.
 * @internal Exported for tests only; no production caller (knip --production, #3126).
 */
export function resetAudioSessionForTests(): void {
  holders = 0;
  if (releaseTimer !== null) clearTimeout(releaseTimer);
  releaseTimer = null;
}
