import React from "react";
import { useTranslation } from "react-i18next";
import HeroStatScoreboard from "./HeroStatScoreboard";
import type { SolitaireScoreboardSnapshot } from "../../game/solitaire/SolitaireScoreboardContext";
import { formatMs } from "../../game/solitaire/formatMs";

interface Props {
  snapshot: SolitaireScoreboardSnapshot;
}

export default function SolitaireScoreboard({ snapshot }: Props) {
  const { t } = useTranslation("solitaire");

  const heroValue = snapshot.hasGame ? formatMs(snapshot.elapsedMs) : "—";
  const heroSub = snapshot.hasGame
    ? t("scoreboard.heroSub", {
        moves: snapshot.moves,
        foundations: snapshot.foundationsComplete,
      })
    : t("scoreboard.heroSubEmpty");

  const cards = [
    {
      key: "bestTime",
      label: t("scoreboard.bestTime"),
      value: snapshot.bestTimeMs > 0 ? formatMs(snapshot.bestTimeMs) : "—",
      accent: true,
    },
    {
      key: "bestMoves",
      label: t("scoreboard.bestMoves"),
      value: snapshot.bestMoves > 0 ? snapshot.bestMoves.toLocaleString("en-US") : "—",
    },
    {
      key: "gamesPlayed",
      label: t("scoreboard.gamesPlayed"),
      value: snapshot.gamesPlayed > 0 ? snapshot.gamesPlayed.toLocaleString("en-US") : "—",
    },
    {
      key: "gamesWon",
      label: t("scoreboard.gamesWon"),
      value: snapshot.gamesWon > 0 ? snapshot.gamesWon.toLocaleString("en-US") : "—",
    },
  ] as const;

  return (
    <HeroStatScoreboard
      heroLabel={t("scoreboard.heroLabel")}
      heroValue={heroValue}
      heroSub={heroSub}
      cards={cards}
    />
  );
}
