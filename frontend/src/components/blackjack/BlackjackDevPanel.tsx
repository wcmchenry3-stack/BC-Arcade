/**
 * Blackjack's developer panel (#3576): pick the cards the engine deals next, to
 * check layout, motion and sound against rare hands (5-6 card hands, long dealer
 * draws, four split hands, naturals, a dealer bust). Dev builds and internal
 * (pre-launch API) builds only. Stacking goes through `devSetEngine`, so it is
 * never recorded as a player action or replay event.
 */
import React, { useState } from "react";
import { useBlackjackGame } from "../../game/blackjack/BlackjackGameContext";
import { isPreLaunchApiBuild } from "../../game/_shared/envFlags";
import { BLACKJACK_DEV_PRESETS, stackDeck } from "../../game/blackjack/devDeck";
import { DevActionButton, DevPanelShell } from "../dev/DevPanelShell";
import { DevCardPicker, type DevPickerCard } from "../dev/DevCardPicker";

/** Read at each render so a test can flip the build flags. */
function devPanelEnabled(): boolean {
  return __DEV__ || isPreLaunchApiBuild();
}

export default function BlackjackDevPanel() {
  if (!devPanelEnabled()) return null;
  return <BlackjackDevPanelBody />;
}

function BlackjackDevPanelBody() {
  const { devSetEngine } = useBlackjackGame();
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState<readonly DevPickerCard[]>([]);

  const stack = () => {
    devSetEngine((s) => stackDeck(s, cards));
    setOpen(false);
  };

  return (
    <DevPanelShell
      enabled
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      buttonPosition="bottom-right"
      title="DEV — Blackjack deck"
      testID="blackjack-dev-panel"
    >
      <DevCardPicker cards={cards} onChange={setCards} presets={BLACKJACK_DEV_PRESETS} />
      <DevActionButton
        label="Stack next cards"
        variant="primary"
        onPress={stack}
        testID="blackjack-dev-stack"
      />
      <DevActionButton label="Close" onPress={() => setOpen(false)} />
    </DevPanelShell>
  );
}
