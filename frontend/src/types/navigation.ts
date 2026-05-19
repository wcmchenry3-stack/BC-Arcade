import type { AiDifficulty, GameState } from "../game/yacht/types";

export type RootStackParamList = {
  MainTabs: undefined;
};

export type HomeStackParamList = {
  Home: undefined;
  Game: { initialState: GameState; aiDifficulty?: AiDifficulty; aiState?: GameState };
  Cascade: undefined;
  StarSwarm: undefined;
  BlackjackBetting: undefined;
  BlackjackTable: undefined;
  BlackjackVictory: undefined;
  BlackjackStats: undefined;
  Twenty48: undefined;
  Solitaire: undefined;
  FreeCell: undefined;
  Hearts: undefined;
  Sudoku: undefined;
  Mahjong: undefined;
  MahjongLayoutInspector: undefined;
  MahjongLayoutDetail: { layoutId: string };
  Sort: undefined;
  DailyWord: undefined;
  Scoreboard: {
    gameKey:
      | "hearts"
      | "yacht"
      | "blackjack"
      | "twenty48"
      | "solitaire"
      | "sudoku"
      | "cascade"
      | "mahjong";
  };
};

export type ProfileStackParamList = {
  ProfileHome: undefined;
  GameDetail: { gameId: string };
};
