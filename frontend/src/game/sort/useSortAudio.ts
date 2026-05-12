import { useSound } from "../_shared/useSound";

export function useSortAudio() {
  const { play: playPour } = useSound("sort.pour");
  const { play: playWin } = useSound("sort.win");
  return { playPour, playWin };
}
