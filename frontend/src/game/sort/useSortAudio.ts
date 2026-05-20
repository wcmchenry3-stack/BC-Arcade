import { useSound } from "../_shared/useSound";
import { SORT_SOUNDS } from "./sounds";

export function useSortAudio() {
  const { play: playPour } = useSound("sort.pour", SORT_SOUNDS);
  const { play: playWin } = useSound("sort.win", SORT_SOUNDS);
  return { playPour, playWin };
}
