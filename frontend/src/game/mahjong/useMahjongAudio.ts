import { useBackgroundMusic } from "../_shared/useBackgroundMusic";
import { useSound } from "../_shared/useSound";
import { MAHJONG_SOUNDS } from "./sounds";

const BG_KEYS = ["mahjong.bg1", "mahjong.bg2", "mahjong.bg3"] as const;

export function useMahjongAudio(active: boolean) {
  useBackgroundMusic([...BG_KEYS], MAHJONG_SOUNDS, active);

  const { play: playTileSelect } = useSound("mahjong.tileSelect", MAHJONG_SOUNDS);
  const { play: playTileMatch } = useSound("mahjong.tileMatch", MAHJONG_SOUNDS);
  const { play: playShuffle } = useSound("mahjong.shuffle", MAHJONG_SOUNDS);
  const { play: playWin } = useSound("mahjong.win", MAHJONG_SOUNDS);
  const { play: playDeadlock } = useSound("mahjong.deadlock", MAHJONG_SOUNDS);

  return { playTileSelect, playTileMatch, playShuffle, playWin, playDeadlock };
}
