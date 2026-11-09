import { useBackgroundMusic } from "../_shared/useBackgroundMusic";
import { useSound } from "../_shared/useSound";
import { useSoundVariants } from "../_shared/useSoundVariants";
import { MAHJONG_SOUNDS, MAHJONG_TILE_MATCH, MAHJONG_TILE_SELECT } from "./sounds";

const BG_KEYS = ["mahjong.bg1", "mahjong.bg2", "mahjong.bg3"] as const;

export function useMahjongAudio(active: boolean) {
  useBackgroundMusic([...BG_KEYS], MAHJONG_SOUNDS, active);

  // Three variations each, never the same twice in a row (#3578).
  const { play: playTileSelect } = useSoundVariants(MAHJONG_TILE_SELECT, MAHJONG_SOUNDS);
  const { play: playTileMatch } = useSoundVariants(MAHJONG_TILE_MATCH, MAHJONG_SOUNDS);
  const { play: playShuffle } = useSound("mahjong.shuffle", MAHJONG_SOUNDS);
  const { play: playWin } = useSound("mahjong.win", MAHJONG_SOUNDS);
  const { play: playDeadlock } = useSound("mahjong.deadlock", MAHJONG_SOUNDS);

  return { playTileSelect, playTileMatch, playShuffle, playWin, playDeadlock };
}
