/**
 * Per-device session ID management.
 *
 * Every game sends its session ID as the `X-Session-ID` header so the
 * backend can isolate game state per client without requiring user
 * accounts. The ID is generated once per device and persisted in
 * AsyncStorage.
 *
 * This used to live in the Yacht client (`frontend/src/api/client.ts`)
 * which all other clients reached into. Moved to _shared during the
 * unified game module refactor (#153).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { generateUUID } from "./uuid";

const SESSION_KEY = "game_session_id";

export async function getOrCreateSessionId(): Promise<string> {
  let sid = await AsyncStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = generateUUID();
    await AsyncStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_KEY);
}
