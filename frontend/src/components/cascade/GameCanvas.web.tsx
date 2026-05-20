import React, { forwardRef } from "react";
import { View } from "react-native";
import type { FruitDefinition, FruitSet } from "../../theme/fruitSets";

export interface CascadeEngineState {
  fruitCount: number;
  dangerRatio: number;
  fruits: Array<{ id: number; tier: number; x: number; y: number; angle: number }>;
}

export interface SavedFruitInput {
  tier: number;
  x: number;
  y: number;
}

type GameEvent =
  | { type: "fruitMerge"; tier: number; x: number; y: number }
  | { type: "cascadeCombo" }
  | { type: "gameOver" };

export interface GameCanvasHandle {
  drop: (def: FruitDefinition, x: number) => void;
  reset: () => void;
  announceEvent: (message: string) => void;
  getEngineState: () => CascadeEngineState;
  restoreFruits: (fruits: readonly SavedFruitInput[], fruitSet: FruitSet) => void;
  fastForward?: (ms: number) => void;
  isReady?: () => boolean;
  setSeed?: (seed: number) => void;
  spawnRaw?: (def: FruitDefinition, x: number) => void;
}

interface Props {
  fruitSet: FruitSet;
  nextDef: FruitDefinition;
  onEvents?: (events: GameEvent[]) => void;
  onTap: (x: number) => void;
  onReady?: () => void;
  onSetSeed?: (seed: number) => void;
  width: number;
  height: number;
  scale: number;
}

const EMPTY_STATE: CascadeEngineState = { fruitCount: 0, dangerRatio: 0, fruits: [] };

const GameCanvas = forwardRef<GameCanvasHandle, Props>((_props, ref) => {
  React.useImperativeHandle(ref, () => ({
    drop: () => {},
    reset: () => {},
    announceEvent: () => {},
    getEngineState: () => EMPTY_STATE,
    restoreFruits: () => {},
    fastForward: () => {},
    isReady: () => false,
    spawnRaw: () => {},
  }));
  return <View />;
});
GameCanvas.displayName = "GameCanvas";
export default GameCanvas;
