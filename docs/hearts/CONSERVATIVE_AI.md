# Conservative Hearts CPU: principles and rulebook

- **Status:** Implemented (#3159, epic #3156) in [`frontend/src/game/hearts/conservative/`](../../frontend/src/game/hearts/conservative/): `terms.ts` (§2.1 terms, §3 knowledge), `play.ts` (`choosePlay`: §2.4 Leading / Following / Discarding) and `pass.ts` (`choosePass`: §2.4 Passing). Every CPU seat players see plays it (`ai.ts` routes the `conservative` persona there). Spec: story #3157.
- **Builds on it:** the CPU (#3159), the rulebook tests (#3160) and the independent simulator principle checker (#3161).
- **Game rules:** [games/hearts.md](../games/hearts.md) and the engine, [`frontend/src/game/hearts/engine.ts`](../../frontend/src/game/hearts/engine.ts). This file does not restate them. Every expected card below is legal under `getValidPlays`.

This spec defines one CPU that plays plain, careful Hearts from a short list of principles. It does not code each scenario. **When the principles handle a hand badly, the fix is to change a principle, not to add a special case.**

Why this exists: the current CPUs (`ai.ts`, `aiConsiderations.ts`, `aiWeights.ts`) try to score every scenario and have become hard to manage. One visible symptom is that they follow trick 1 with their **lowest** club. The engine keeps hearts and Q♠ off trick 1, so trick 1 is free and the highest club is the right play.

---

## 1. The plan: nullo

The CPU plays "nullo": it tries to win no tricks, or only tricks that cannot hurt it (Hoyle's). Every decision answers one question: _which card here is least likely to give me points, now or later?_ When the CPU can lose a trick, it loses it with the highest card it can afford to lose. When it cannot lose, or the trick is harmless, it wins with its highest card and so gets rid of a card that would be dangerous later. When it leads or discards, it picks the card most likely to be forced to win later. It treats Q♠ (13 points) with special care. It does one thing besides nullo: when one opponent has taken every point so far, it keeps a high heart, takes a trick from that player when it safely can, and never hands that player the queen when that would complete a moon. It never tries to shoot the moon.

---

## 2. Principles

### 2.1 Terms

The definitions below are exact, so two engineers implementing them pick the same card.

| Term                                | Definition                                                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Rank value**                      | 2–10 face value, J = 11, Q = 12, K = 13, A = 14. (The engine stores Ace as `rank: 1`; treat it as 14 everywhere here.)                                                                                             |
| **Played**                          | Every card in a completed trick this hand, plus every card already in the current trick.                                                                                                                           |
| **Out**                             | A card that is neither in the CPU's hand nor played. These are the cards the opponents can still play. The CPU's own passed cards count as out.                                                                    |
| **below(c)** / **above(c)**         | How many out cards of c's suit rank lower / higher than c.                                                                                                                                                         |
| **LOW**                             | A card with below(c) ≤ 3. It nearly always loses, because few out cards of its suit rank under it. A card becomes LOW as lower cards are played.                                                                   |
| **GUARDED suit**                    | A suit in which the CPU holds at least 2 LOW cards and at least as many LOW cards as non-LOW cards. ("Aces and high cards accompanied by some low cards are not dangerous.")                                       |
| **DANGEROUS**                       | A non-LOW card in a suit that is not GUARDED. ("Middle cards without low cards are very dangerous.")                                                                                                               |
| **Danger order**                    | Compare cards on these keys in turn, most dangerous first: DANGEROUS before not; then larger below(c); then higher rank value; then the suit tie-break. "The most dangerous card" is the first card in this order. |
| **HIGH heart**                      | A heart that is not LOW and has above(c) ≤ 3. In a fresh deck that means J♥, Q♥, K♥ and A♥.                                                                                                                        |
| **Q♠ live**                         | Q♠ has not been played (it may be in the CPU's hand). Used where the CPU's own queen matters too: lead step 2 and discard step 3.                                                                                  |
| **Q♠ out**                          | Q♠ is live and not in the CPU's hand. Used where only another player's queen matters: follow step 6.                                                                                                               |
| **Spades PROTECTED** (passing only) | The CPU holds at least 3 spades ranked below the queen (2♠–J♠).                                                                                                                                                    |
| **Trick points**                    | Hearts (1 each) plus Q♠ (13) among the cards already in the current trick.                                                                                                                                         |
| **Players after**                   | The number of players still to play in the current trick after the CPU (0 means the CPU plays last).                                                                                                               |
| **Winning card W**                  | The highest card of the led suit in the current trick so far. Its player is the current winner.                                                                                                                    |
| **Moon threat**                     | Points have been taken this hand, every point taken belongs to one opponent X, and X has at least **10** points (`MOON_THRESHOLD`). Points still in the current trick do not count.                                |
| **Guard heart G**                   | The CPU's highest heart. It matters only while there is a moon threat.                                                                                                                                             |
| **Moon complete**                   | There is a moon threat by X, the CPU holds Q♠, and X's points plus the hearts in the current trick equal 13. X then has, or is about to have, every heart, so Q♠ landing on X's trick gives X all 26.              |
| **X can overtake**                  | X plays after the CPU in the current trick and some out card of the led suit beats W (above(W) ≥ 1). If nothing out beats W, X cannot win this trick whatever it holds.                                            |
| **Candidates**                      | The cards a procedure is still choosing between. They start as the legal cards; some steps remove cards from them.                                                                                                 |
| **Suit tie-break**                  | Applied last when cards still tie: the card whose suit comes first in **♣, ♦, ♠, ♥**. It never depends on the order of cards in the hand.                                                                          |

### 2.2 The principles

| ID              | Principle (one sentence)                                                                                                                                                                                                                                                                                                                                                   | Source                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-DUCK`       | If you can lose the trick, play the highest card that still loses; if you can't, play your highest card other than Q♠ (and other than A♠/K♠ while another player could still drop the queen on it, per P5).                                                                                                                                                                | Nullo (Hoyle's)                                                                                                                                     |
| `P2-FREE-TRICK` | A trick that cannot hold points is free: on every trick-1 follow, and as last seat on a trick with no points, play your highest led-suit card other than Q♠.                                                                                                                                                                                                               | Hoyle's: "only harmless tricks"                                                                                                                     |
| `P3-SHED`       | When you lead, lead your most dangerous non-heart card if you hold one.                                                                                                                                                                                                                                                                                                    | Hoyle's: "High cards that can be forced… should be played early rather than late"; "Q-9-8 should be led each and every time the opportunity offers" |
| `P4-DANGER`     | Danger comes from middle and high cards with no low cards behind them, judged against the cards still out; aces and kings backed by low cards can wait.                                                                                                                                                                                                                    | Hoyle's: "middle cards without low cards are very dangerous"                                                                                        |
| `P5-QUEEN`      | Respect the queen: get rid of Q♠ the first time it cannot win (when you are void, or under A♠/K♠ in the trick); never lead Q♠, or A♠/K♠ while Q♠ is live; never play A♠/K♠ into a spade trick that the queen can still drop onto; pass Q♠/A♠/K♠ unless spades are PROTECTED.                                                                                               | Modern Hearts advice                                                                                                                                |
| `P6-DISCARD`    | When void, discard in this order: Q♠, then A♠/K♠ while Q♠ is live, then your highest HIGH heart, then your most dangerous card.                                                                                                                                                                                                                                            | Combines P3–P5                                                                                                                                      |
| `P7-MOON-GUARD` | While one opponent X holds every point taken and has at least 10: keep your highest heart (also when ducking, while X can overtake), lead it when nothing out can beat it, take a pointed trick X is winning when you play last or hold a certain winner, and never drop Q♠ on a trick X is winning or can overtake when X's hearts plus the hearts in this trick make 13. | Hoyle's: "a high-card entry… to interrupt a 'take-all'"                                                                                             |
| `P8-PASS`       | Pass the three cards P5 and P6 would most want to get rid of: an early discard, chosen in the same order.                                                                                                                                                                                                                                                                  | Same principles                                                                                                                                     |
| `P9-EXIT`       | With nothing dangerous to lead, lead the card least likely to win: among cards some out card can beat, the one with the fewest out cards below it, then the lowest rank; if every card would win, the lowest non-heart.                                                                                                                                                    | Nullo; beginner "lead low"                                                                                                                          |

P4 is a definition used by P3, P6 and P8. It never picks a card by itself, so no rulebook position names it.

**§2.4 is normative; the §2.2 sentences are summaries.** Where they seem to differ, implement §2.4.

### 2.3 Priority when principles disagree

The CPU always plays a legal card first (`getValidPlays`). If only one card is legal, it plays that card. Otherwise principles apply in this order, and the first one that names a card decides:

1. **P7-MOON-GUARD, moon-complete case only.** Never drop Q♠ onto a trick that X is winning or can overtake, when X's hearts plus the hearts in this trick make 13. That could hand X the moon (26 to everyone else), and with every heart gone nothing could stop it.
2. **P5-QUEEN.** Q♠ costs 13, which is half the hand. Ridding yourself of the queen, and not giving it a target, comes before everything else. Dropping Q♠ onto a possible moon shooter is still right in every other case, because some heart is still out, so X cannot yet take all 26 from this trick.
3. **P7-MOON-GUARD** (the rest). A moon costs 26. When the threat is real, the guard comes before nullo.
4. **P2-FREE-TRICK.** It comes before the duck: when nothing can go wrong, shed a high card.
5. **P1-DUCK** (lose with the highest card that loses, or win with the highest card).
6. **P6-DISCARD / P3-SHED / P9-EXIT.** These choose the card when you are void (discard) or leading. P4 supplies their danger order.

P8 is the only pass rule, and it is just P5 followed by P6.

**Attribution.** The principle a decision is credited to (the rulebook's `principle` field, and the simulator checker's blame) is **the principle of the step in §2.4 that names the card**. A step that only removes candidates gets no credit, even when the removal changes the answer: lead step 2 (P5), discard steps 1 and 4 (P7), follow step 5's guard filter (P7), and follow step 6b's filter (P5). A single legal card is credited to no principle.

### 2.4 Decision procedures

Each step names its principle. A step either names exactly one card or passes to the next step; a step marked _filter_ only removes candidates. "Highest" and "lowest" mean by rank value, because a set of cards in one suit has no ties.

#### Leading (trick 2 onward; on trick 1 the engine forces 2♣)

Candidates start as the legal cards.

1. **P7.** If there is a moon threat, G is legal and above(G) = 0 (no out heart can beat it), lead G. Winning any heart breaks the moon. This step runs before P5 because G is a heart, so it can never clash with P5's spade rules.
2. **P5 (filter).** Remove Q♠, and remove A♠ and K♠ while Q♠ is **live**. If that leaves nothing, remove only Q♠. (Live, not out: when the CPU holds the queen itself, A♠/K♠ are its cover, and leading them strips it.) Something always remains: if Q♠ were the only legal card, it was played up front.
3. **P3.** If any candidate is a DANGEROUS non-heart, lead the most dangerous one.
4. **P9.** Otherwise, among candidates with above(c) ≥ 1, lead the card with the smallest below(c); break ties by lower rank, then the suit tie-break.
5. **P9.** If every candidate would win for certain (above = 0), lead the lowest non-heart (lowest rank, then suit tie-break), or the lowest heart if only hearts remain.

#### Following (the CPU holds the led suit)

W is the winning card and "after" is the number of players after the CPU.

1. **P7.** If spades were led, the CPU holds Q♠, W is K♠ or A♠, the moon is complete for X, and X is the current winner or X can overtake, play the CPU's highest spade other than Q♠.
2. **P5.** If spades were led, the CPU holds Q♠ and W is K♠ or A♠, play Q♠. It cannot win.
3. **P7.** If there is a moon threat, X is the current winner and the trick has points, let h be the CPU's highest led-suit card other than Q♠, and also other than A♠/K♠ when spades were led, Q♠ is out and someone plays after the CPU (P5 outranks P7, so this step never offers the queen a target; with no such card, go on to step 4). If h beats W, and either the CPU plays last or above(h) = 0 (a certain winner), play h. Taking any point from X breaks the moon.
4. **P2.** If this is trick 1, or the CPU plays last and the trick has no points, play its highest led-suit card other than Q♠ (Q♠ only if it is the only one).
5. **P1.** If the CPU holds led-suit cards lower than W, play the highest of them. It is certain to lose. **P7 (filter) first:** if there is a moon threat, X can overtake, and G is one of these cards along with at least one other, remove G, so the guard is not spent on a trick X may still take.
6. Otherwise every led-suit card the CPU holds beats W, and it wins unless someone after it overtakes.
   - a. Candidates are its led-suit cards other than Q♠. This set is never empty here: Q♠ as its only led-suit card would be the only legal card.
   - b. **P5 (filter).** If spades were led, after ≥ 1 and Q♠ is **out**, remove A♠ and K♠. (Out, not live: the danger is another player dropping the queen on this trick, and nobody can if the CPU holds her.) If that empties the candidates, **P5** names the lower of A♠ and K♠ that the CPU holds.
   - c. **P1.** Play the highest candidate.

#### Discarding (the CPU is void in the led suit)

Candidates start as the legal cards from the engine. On trick 1 that excludes hearts and Q♠ unless the hand holds nothing else.

1. **P7 (filter).** If the moon is complete for X, and X is the current winner or X can overtake, remove Q♠.
2. **P5.** Q♠, if it is a candidate.
3. **P5.** A♠, then K♠, if a candidate and Q♠ is **live**. (Live, not out: a discarded A♠/K♠ can never win, and while the queen is unplayed they are liabilities wherever she is. On trick 1 the CPU may hold Q♠ without being allowed to discard it.)
4. **P7 (filter).** If there is a moon threat, remove G. This never empties the candidates: a lone legal G was played up front, and after step 1 removes Q♠ the CPU holds no hearts at all, because the moon is complete.
5. **P6.** Discard the highest-ranked HIGH heart among the candidates.
6. **P6 (via P4).** Discard the most dangerous candidate.

#### Passing (P8)

The CPU judges all cards against its original 13 (below/above count every card not in its hand as out). It takes the first three cards from this list:

1. **P5:** if spades are not PROTECTED, pass Q♠, A♠ and K♠ (those it holds, in that order). If spades are PROTECTED, it keeps all three and no later step may pass them.
2. **P6:** HIGH hearts, highest first.
3. **P4:** every other card in danger order.

The 2♣ is always LOW with below = 0, so it is never passed in practice. Passing it would be legal: `commitPass` finds the new 2♣ holder.

---

## 3. What the CPU knows

The CPU is meant to play like a careful beginner, not a card counter. It uses only:

| Knows                                                                                                | Engine source                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------ |
| Its own hand                                                                                         | `playerHands[seat]`            |
| Trick number (1–13)                                                                                  | `tricksPlayedInHand + 1`       |
| Current trick, with seats                                                                            | `currentTrick`                 |
| Hearts broken                                                                                        | `heartsBroken`                 |
| Every card played this hand (public). Used only to count below/above and to know whether Q♠ is live. | `wonCards` plus `currentTrick` |
| Points each player has taken this hand                                                               | `handScores`                   |
| Pass direction (passing only; it does not change the choice)                                         | `passDirection`                |

It deliberately does **not** use: known voids (`knownVoids`), what it passed or received (`passedAwayByPlayer`/`receivedByPlayer`), cumulative scores, who is leading the game, or any guess at opponents' hands. Played-card memory is the one piece of counting it does. P4 needs it ("so long as any lower cards of the suit remain unplayed"), and it is limited to rank counts within a suit.

The default thresholds are `LOW` when below ≤ 3, `GUARDED` when there are ≥ 2 LOW cards and LOW ≥ non-LOW, `HIGH heart` when above ≤ 3, `PROTECTED` with ≥ 3 spades under the queen, and `MOON_THRESHOLD` = 10. These are the only tuning constants.

---

## 4. Passing uses the same principles

There is no separate pass rule set. Passing is an early discard (P8 = P5 then P6), and the pass direction does not change the choice. One check of consistency: with Q♠ unprotected, the CPU passes Q♠, A♠ and K♠, the same three cards it would discard first once void. With spades protected, it keeps all three, and P5 lets it dump Q♠ later under A♠/K♠ or when it is void.

---

## 5. Rulebook

Each position below is one fenced `yaml` block (a mapping). A parser should read every `yaml` block in this section and nothing else. Fields:

| Field                           | Meaning                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                            | Stable ID (`R01`…).                                                                                                                                    |
| `decision`                      | `pass`, `lead`, `follow` (holds the led suit) or `discard` (void in the led suit).                                                                     |
| `seat`                          | The CPU's seat (0–3). Play goes seat → seat + 1 (mod 4), and "left" is seat + 1.                                                                       |
| `trick_number`                  | 1–13, or `0` for the pass phase.                                                                                                                       |
| `hand`                          | The CPU's cards. Cards are written rank + suit: `2`–`10`, `J`, `Q`, `K`, `A` with `C` `D` `S` `H`.                                                     |
| `played`                        | Completed tricks in order, each `{ lead: seat, cards: [...] }` with the cards in play order. The leader of each trick is the winner of the one before. |
| `trick`                         | The current trick so far, in play order, with seats.                                                                                                   |
| `hearts_broken`, `queen_played` | Must match `played` + `trick`.                                                                                                                         |
| `points`                        | Points taken this hand per seat `[0, 1, 2, 3]`, from completed tricks only.                                                                            |
| `pass_direction`                | Pass positions only.                                                                                                                                   |
| `expected`                      | The one card to play, or the three cards to pass, in P8 order.                                                                                         |
| `principle`                     | The principle of the §2.4 step that names the card (see Attribution in §2.3).                                                                          |
| `reason`                        | One plain-English sentence.                                                                                                                            |

All positions are internally consistent. There are no duplicate cards, hand size = 14 − trick number, and `played` has trick number − 1 tricks, each led by the previous winner. `points`, `hearts_broken` and `queen_played` match the history. **The CPU seat's own earlier plays in `played` are exactly what §2.4 picks at that moment**, so a test can replay a history through the CPU. Each expected card is legal under `getValidPlays`. All of this was checked against a scratch implementation of §2.4, which was not committed.

### Trick 1

```yaml
id: R01
decision: follow
seat: 1
trick_number: 1
hand: [4C, 9C, KC, 3D, 8D, JD, 5S, 7S, 10S, 2H, 6H, 9H, QH]
played: []
trick: [{ seat: 0, card: 2C }]
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [KC]
principle: P2-FREE-TRICK
reason: "Second seat on trick 1 plays its highest club, because no points can fall on trick 1."
```

```yaml
id: R02
decision: follow
seat: 2
trick_number: 1
hand: [3C, 6C, AC, 4D, 7D, 10D, KD, 2S, 9S, JS, 3H, 8H, KH]
played: []
trick: [{ seat: 0, card: 2C }, { seat: 1, card: 5C }]
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [AC]
principle: P2-FREE-TRICK
reason: "Third seat on trick 1 sheds the ace of clubs while the trick is free."
```

```yaml
id: R03
decision: follow
seat: 3
trick_number: 1
hand: [3C, 8C, QC, 2D, 5D, 9D, 3S, 6S, 8S, 4H, 7H, 10H, AH]
played: []
trick: [{ seat: 0, card: 2C }, { seat: 1, card: 7C }, { seat: 2, card: JC }]
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [QC]
principle: P2-FREE-TRICK
reason: "Fourth seat on trick 1 wins with its highest club, since the trick is harmless and winning costs nothing."
```

```yaml
id: R04
decision: discard
seat: 2
trick_number: 1
hand: [AS, 4S, 8S, 10S, 2D, 6D, 9D, QD, 3H, 5H, 8H, JH, KH]
played: []
trick: [{ seat: 0, card: 2C }, { seat: 1, card: KC }]
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [AS]
principle: P5-QUEEN
reason: "Void in clubs on trick 1, it dumps the ace of spades, the card most likely to catch the queen later; hearts are not legal here."
```

```yaml
id: R05
decision: discard
seat: 1
trick_number: 1
hand: [AD, 9D, 8D, 2S, 3S, 7S, 9S, 4H, 6H, 10H, QH, KH, AH]
played: []
trick: [{ seat: 0, card: 2C }]
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [AD]
principle: P6-DISCARD
reason: "Void in clubs with no high spades, it discards the ace of its unguarded diamonds (A-9-8); its hearts are illegal on trick 1."
```

### Following: ducking, forced wins and free tricks

```yaml
id: R06
decision: follow
seat: 0
trick_number: 2
hand: [3D, 9D, KD, 4C, 8C, 2S, 7S, 10S, 5H, 6H, 9H, QH]
played:
  - { lead: 0, cards: [2C, 3C, 9C, JC] }
trick: [{ seat: 3, card: 10D }]
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [9D]
principle: P1-DUCK
reason: "It can lose under the 10, so it plays the highest diamond that still loses."
```

```yaml
id: R07
decision: follow
seat: 2
trick_number: 4
hand: [4H, 10H, AH, 6D, 9D, 3C, 7C, 4S, 9S, JS]
played:
  - { lead: 0, cards: [2C, 8C, 10C, QC] }
  - { lead: 3, cards: [3D, 5D, KD, JD] }
  - { lead: 1, cards: [7S, 6S, 3H, AS] }
trick: [{ seat: 0, card: 6H }, { seat: 1, card: JH }]
hearts_broken: true
queen_played: false
points: [1, 0, 0, 0]
expected: [10H]
principle: P1-DUCK
reason: "The highest heart under the jack is the 10, which loses and gets rid of a dangerous heart; one point held by one player is not a moon threat."
```

```yaml
id: R08
decision: follow
seat: 1
trick_number: 2
hand: [7D, QD, 4C, 5C, 2S, 6S, 9S, 3H, 5H, 8H, JH, KH]
played:
  - { lead: 0, cards: [2C, 10C, 8C, AC] }
trick: [{ seat: 3, card: 3D }, { seat: 0, card: 6D }]
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [QD]
principle: P1-DUCK
reason: "Every diamond it holds beats the 6, so it cannot lose; it wins with its highest diamond to shed it."
```

```yaml
id: R09
decision: follow
seat: 2
trick_number: 2
hand: [9S, QS, AS, 3C, 4C, 2D, 8D, KD, 4H, 6H, 10H, QH]
played:
  - { lead: 0, cards: [2C, QC, 7C, 9C] }
trick: [{ seat: 1, card: 5S }]
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [AS]
principle: P1-DUCK
reason: "A forced win: every spade beats the 5, so it wins with its highest spade other than the queen it holds, keeping Q♠ out of the trick."
```

```yaml
id: R10
decision: follow
seat: 1
trick_number: 3
hand: [JS, AS, 8C, 7C, 7D, 6D, 2H, 4H, 6H, 9H, KH]
played:
  - { lead: 0, cards: [2C, 10C, JC, 3C] }
  - { lead: 2, cards: [5D, 4D, AD, QD] }
trick: [{ seat: 0, card: 8S }]
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [JS]
principle: P1-DUCK
reason: "It must win the spade trick; with the queen still out and two players to come, P5 removes the ace she could drop under, and P1 plays the highest spade left, the jack."
```

```yaml
id: R11
decision: follow
seat: 3
trick_number: 2
hand: [QS, KS, 4S, 3C, 8C, 5D, 8D, JD, 2H, 7H, 9H, AH]
played:
  - { lead: 0, cards: [2C, KC, 5C, 10C] }
trick: [{ seat: 1, card: AS }, { seat: 2, card: 6S }]
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [QS]
principle: P5-QUEEN
reason: "The ace of spades is winning, so the queen cannot win; it drops Q♠ now rather than ducking with the king."
```

```yaml
id: R12
decision: follow
seat: 0
trick_number: 3
hand: [4D, AD, 7C, QC, 4S, 10S, 3H, 5H, 8H, JH, QH]
played:
  - { lead: 0, cards: [2C, 4C, 10C, 6C] }
  - { lead: 2, cards: [8S, 2S, 6S, JS] }
trick: [{ seat: 1, card: 3D }, { seat: 2, card: 6D }, { seat: 3, card: 9D }]
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [AD]
principle: P2-FREE-TRICK
reason: "Last to play on a trick with no points, it wins with the ace of diamonds to shed it for free."
```

```yaml
id: R13
decision: follow
seat: 0
trick_number: 3
hand: [7C, KC, 5D, 8D, 3S, 7S, 10S, 2H, 6H, 9H, AH]
played:
  - { lead: 0, cards: [2C, QC, 4C, 6C] }
  - { lead: 1, cards: [KD, 10D, 2D, JD] }
trick: [{ seat: 1, card: 5C }, { seat: 2, card: 9C }, { seat: 3, card: 3H }]
hearts_broken: true
queen_played: false
points: [0, 0, 0, 0]
expected: [7C]
principle: P1-DUCK
reason: "Last to play, but the trick holds a heart, so it is not free; it ducks with the 7 instead of winning with the king."
```

```yaml
id: R36
decision: follow
seat: 2
trick_number: 2
hand: [KS, AS, 3C, 5C, 2D, 6D, 9D, JD, 3H, 7H, 10H, QH]
played:
  - { lead: 0, cards: [2C, KC, 9C, 4C] }
trick: [{ seat: 1, card: 6S }]
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [KS]
principle: P5-QUEEN
reason: "It must win the spade trick and only has the ace and king, with the queen out and two players to come, so it plays the lower one, the king."
```

```yaml
id: R37
decision: follow
seat: 2
trick_number: 2
hand: [QS, 4S, 9S, 4C, 6C, 2D, 5D, 10D, 2H, 8H, JH, KH]
played:
  - { lead: 0, cards: [2C, AC, 8C, 3C] }
trick: [{ seat: 1, card: KS }]
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [QS]
principle: P5-QUEEN
reason: "The king of spades is winning, so the queen cannot win even with two players still to come; it drops Q♠ now."
```

### Discarding

```yaml
id: R14
decision: discard
seat: 1
trick_number: 3
hand: [QS, 3S, 6S, 8C, JC, 7C, 2H, 4H, 9H, JH, AH]
played:
  - { lead: 0, cards: [2C, QC, AC, 4C] }
  - { lead: 2, cards: [3D, 9D, KD, 5D] }
trick: [{ seat: 0, card: 10D }]
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [QS]
principle: P5-QUEEN
reason: "The first time it cannot follow suit, it discards the queen of spades."
```

```yaml
id: R15
decision: discard
seat: 0
trick_number: 2
hand: [AS, 7S, 4S, 2D, 8D, JD, KD, 3H, 6H, 10H, QH, KH]
played:
  - { lead: 0, cards: [2C, 9C, QC, 3C] }
trick: [{ seat: 2, card: 5C }, { seat: 3, card: 10C }]
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [AS]
principle: P5-QUEEN
reason: "The queen of spades is still out, so the ace of spades goes before its high hearts."
```

```yaml
id: R16
decision: discard
seat: 2
trick_number: 3
hand: [4C, 4S, 6S, 8S, 2H, 4H, 5H, 7H, 9H, JH, QH]
played:
  - { lead: 0, cards: [2C, 6C, JC, 8C] }
  - { lead: 2, cards: [3C, KC, 5C, 9C] }
trick: [{ seat: 3, card: 5D }, { seat: 0, card: 9D }, { seat: 1, card: KD }]
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [QH]
principle: P6-DISCARD
reason: "With no spade honours to dump, it discards its highest high heart."
```

```yaml
id: R17
decision: discard
seat: 0
trick_number: 2
hand: [AC, 3C, 4C, JD, 10D, 9D, 8D, 6D, 2H, 3H, 4H, 5H]
played:
  - { lead: 0, cards: [2C, 9C, 5C, KC] }
trick: [{ seat: 3, card: 6S }]
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [JD]
principle: P6-DISCARD
reason: "J-10-9-8-6 of diamonds with 2-5 still out is the worst holding, so it discards the jack; the ace of clubs is guarded by the 3 and 4."
```

```yaml
id: R18
decision: discard
seat: 0
trick_number: 4
hand: [AS, 6S, QH, 7H, 4H, 3C, 5C, 10C, JC, AC]
played:
  - { lead: 0, cards: [2C, 4C, 9C, KC] }
  - { lead: 3, cards: [KS, QS, 3S, 7S] }
  - { lead: 3, cards: [6D, 5D, 2H, JD] }
trick: [{ seat: 2, card: 4D }, { seat: 3, card: 8D }]
hearts_broken: true
queen_played: true
points: [0, 0, 1, 13]
expected: [QH]
principle: P6-DISCARD
reason: "The queen of spades has been played, so the ace of spades is just another card, and the high heart goes first."
```

### Leading

```yaml
id: R19
decision: lead
seat: 2
trick_number: 2
hand: [QD, 9D, 8D, 3C, 5C, 2S, 4S, 6S, 3H, 7H, 10H, KH]
played:
  - { lead: 0, cards: [2C, 4C, AC, 6C] }
trick: []
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [QD]
principle: P3-SHED
reason: "Q-9-8 of diamonds with no low diamond is the danger holding, so it leads from it at the first chance, starting with the queen."
```

```yaml
id: R20
decision: lead
seat: 3
trick_number: 2
hand: [AS, 3S, 2D, 3D, 4D, 4C, 5C, 2H, 5H, 9H, JH, KH]
played:
  - { lead: 0, cards: [2C, 8C, QC, AC] }
trick: []
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [2D]
principle: P9-EXIT
reason: "The ace of spades is its only dangerous non-heart, but P5 never leads it while the queen is unplayed, so P9 exits with its lowest safe card."
```

```yaml
id: R21
decision: lead
seat: 2
trick_number: 2
hand: [3C, 4C, 2D, 4D, 6D, 2S, 4S, 6S, 7H, 10H, QH, KH]
played:
  - { lead: 0, cards: [2C, 9C, AC, 5C] }
trick: []
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [2D]
principle: P9-EXIT
reason: "With nothing dangerous to lead, it leads its lowest card; 3♣, 4♣, 2♦ and 2♠ all have nothing below them, and the 2♦ wins on rank, then on suit order (♣ ♦ ♠ ♥)."
```

```yaml
id: R22
decision: lead
seat: 0
trick_number: 4
hand: [2H, 9H, 10H, JH, 3C, 4C, 6C, 9C, 7D, 5D]
played:
  - { lead: 0, cards: [2C, 8C, 10C, QC] }
  - { lead: 3, cards: [3D, 8D, KD, 9D] }
  - { lead: 1, cards: [7S, 4S, 3H, AS] }
trick: []
hearts_broken: true
queen_played: false
points: [1, 0, 0, 0]
expected: [2H]
principle: P9-EXIT
reason: "Hearts are broken and the 2 of hearts is its surest loser, so it leads it and lets someone else take the point."
```

```yaml
id: R33
decision: lead
seat: 1
trick_number: 2
hand: [QS, AS, 2H, 3H, 4H, 5H, 6H, 7H, 8H, 9H, 10H, JH]
played:
  - { lead: 0, cards: [2C, AC, 5C, 9C] }
trick: []
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [AS]
principle: P3-SHED
reason: "Hearts are not broken, so only Q♠ and A♠ are legal; P5 never leads the queen, so the ace is the only candidate left."
```

```yaml
id: R34
decision: lead
seat: 2
trick_number: 2
hand: [2H, 3H, 4H, 5H, 6H, 7H, 8H, 9H, 10H, JH, QH, AH]
played:
  - { lead: 0, cards: [2C, 5C, AC, 9C] }
trick: []
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [2H]
principle: P9-EXIT
reason: "Its hand is all hearts, so it may lead one before hearts are broken, and it leads its surest loser, the 2."
```

```yaml
id: R35
decision: lead
seat: 2
trick_number: 2
hand: [3D, 4D, 5D, 6D, 7D, 8D, 9D, 10D, JD, QD, KD, AD]
played:
  - { lead: 0, cards: [2C, 5C, AC, 9C] }
trick: []
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [3D]
principle: P9-EXIT
reason: "Only the 2 of diamonds is out, so every card it holds would win; it leads its lowest card."
```

### Moon guard

```yaml
id: R23
decision: discard
seat: 0
trick_number: 4
hand: [AH, KH, 7H, 3H, 3C, 10C, JC, 9D, JD, QD]
played:
  - { lead: 0, cards: [2C, 5C, 9C, AC] }
  - { lead: 3, cards: [KS, 8S, QS, 3S] }
  - { lead: 3, cards: [6D, 4D, 2D, 10D] }
trick: [{ seat: 2, card: 7S }, { seat: 3, card: JS }]
hearts_broken: false
queen_played: true
points: [0, 0, 0, 13]
expected: [KH]
principle: P6-DISCARD
reason: "Seat 3 holds every point taken (13), so P7 sets the ace of hearts aside as the guard, and P6 discards the highest high heart left, the king."
```

```yaml
id: R24
decision: lead
seat: 2
trick_number: 5
hand: [AH, 9H, 8H, 6H, 5H, 4H, 2D, 4S, 2S]
played:
  - { lead: 0, cards: [2C, AC, KC, 7C] }
  - { lead: 1, cards: [AS, 5S, 6S, QS] }
  - { lead: 1, cards: [KD, 3D, 2H, 9D] }
  - { lead: 1, cards: [10C, QC, 8C, 3C] }
trick: []
hearts_broken: true
queen_played: true
points: [0, 14, 0, 0]
expected: [AH]
principle: P7-MOON-GUARD
reason: "Seat 1 holds all 14 points so far, and the ace of hearts is a sure winner, so it leads it to take a heart and stop the moon."
```

```yaml
id: R25
decision: follow
seat: 3
trick_number: 5
hand: [AD, 3D, 6S, 9S, 7C, 8C, 3H, 8H, 10H]
played:
  - { lead: 0, cards: [2C, AC, 4C, QC] }
  - { lead: 1, cards: [KD, 2H, 4D, 9D] }
  - { lead: 1, cards: [AS, 5S, JS, QS] }
  - { lead: 1, cards: [10C, 3C, 9C, KC] }
trick: [{ seat: 0, card: 6D }, { seat: 1, card: QD }, { seat: 2, card: 7H }]
hearts_broken: true
queen_played: true
points: [0, 14, 0, 0]
expected: [AD]
principle: P7-MOON-GUARD
reason: "The possible moon shooter is winning a trick with a heart in it and it plays last, so it takes the trick with the ace instead of ducking with the 3."
```

```yaml
id: R30
decision: follow
seat: 3
trick_number: 6
hand: [QS, KS, 3S, 10S, JS, 5D, 6D, 5C]
played:
  - { lead: 0, cards: [2C, AC, 3C, 9C] }
  - { lead: 1, cards: [KD, 2H, 7D, 4D] }
  - { lead: 1, cards: [AH, 3H, JH, 4H] }
  - { lead: 1, cards: [KH, 5H, 10H, 6H] }
  - { lead: 1, cards: [QH, 7H, 9H, 8H] }
trick: [{ seat: 1, card: AS }, { seat: 2, card: 4S }]
hearts_broken: true
queen_played: false
points: [0, 13, 0, 0]
expected: [KS]
principle: P7-MOON-GUARD
reason: "Seat 1 has taken all 13 hearts, so dropping Q♠ on its ace would give it the moon; it plays the king and keeps the queen."
```

```yaml
id: R38
decision: follow
seat: 3
trick_number: 7
hand: [QS, 8S, 3S, 10S, JS, 5D, 6D]
played:
  - { lead: 0, cards: [2C, AC, 3C, 9C] }
  - { lead: 1, cards: [KD, 2H, 7D, 4D] }
  - { lead: 1, cards: [AH, 3H, JH, 4H] }
  - { lead: 1, cards: [KH, 5H, 10H, 6H] }
  - { lead: 1, cards: [QH, 7H, 9H, 8H] }
  - { lead: 1, cards: [4C, QC, 5C, 6C] }
trick: [{ seat: 2, card: KS }]
hearts_broken: true
queen_played: false
points: [0, 13, 0, 0]
expected: [JS]
principle: P7-MOON-GUARD
reason: "Seat 1 has taken all 13 hearts and still plays to this trick, so it could overtake the king with the ace; the CPU keeps the queen and plays its highest other spade."
```

```yaml
id: R39
decision: discard
seat: 3
trick_number: 7
hand: [QS, 8S, 3S, 10S, JS, 5D, 6D]
played:
  - { lead: 0, cards: [2C, AC, 3C, 9C] }
  - { lead: 1, cards: [KD, 2H, 7D, 4D] }
  - { lead: 1, cards: [AH, 3H, JH, 4H] }
  - { lead: 1, cards: [KH, 5H, 10H, 6H] }
  - { lead: 1, cards: [QH, 7H, 9H, 8H] }
  - { lead: 1, cards: [4C, QC, 5C, 6C] }
trick: [{ seat: 2, card: JC }]
hearts_broken: true
queen_played: false
points: [0, 13, 0, 0]
expected: [JS]
principle: P6-DISCARD
reason: "Seat 1 has taken all 13 hearts and still plays to this club trick, so the CPU will not discard Q♠ where it could be overtaken; P6 discards its most dangerous other card, the jack of spades."
```

```yaml
id: R40
decision: follow
seat: 3
trick_number: 6
hand: [AS, 2S, AD, 6D, 5D, 3D, 5C, 4C]
played:
  - { lead: 0, cards: [2C, AC, 3C, 9C] }
  - { lead: 1, cards: [KD, 2H, 7D, 4D] }
  - { lead: 1, cards: [AH, 3H, JH, 4H] }
  - { lead: 1, cards: [KH, 5H, 10H, 6H] }
  - { lead: 1, cards: [QH, 7H, 9H, 8C] }
trick: [{ seat: 1, card: 9S }, { seat: 2, card: 8H }]
hearts_broken: true
queen_played: false
points: [0, 12, 0, 0]
expected: [2S]
principle: P1-DUCK
reason: "Seat 1 has every point (12) and is winning a trick with a heart in it, but with the queen out and seat 0 still to play, the moon guard may not use the ace of spades as its winner, so the CPU ducks with the 2."
```

```yaml
id: R41
decision: follow
seat: 3
trick_number: 7
hand: [QS, 8S, 3S, 10S, JS, 5D, 6D]
played:
  - { lead: 0, cards: [2C, AC, 3C, 9C] }
  - { lead: 1, cards: [KD, 2H, 7D, 4D] }
  - { lead: 1, cards: [AH, 3H, JH, 4H] }
  - { lead: 1, cards: [KH, 5H, 10H, 6H] }
  - { lead: 1, cards: [QH, 7H, 9H, 8H] }
  - { lead: 1, cards: [4C, QC, 5C, 6C] }
trick: [{ seat: 2, card: AS }]
hearts_broken: true
queen_played: false
points: [0, 13, 0, 0]
expected: [QS]
principle: P5-QUEEN
reason: "Seat 1 has all 13 hearts and still plays to this trick, but nothing out beats seat 2's ace, so seat 1 cannot win it; the CPU drops Q♠ on seat 2, which sheds 13 and stops the moon."
```

```yaml
id: R42
decision: follow
seat: 3
trick_number: 5
hand: [JH, 8H, 5H, 4H, 3H, 2D, 2S, 3S, 4S]
played:
  - { lead: 0, cards: [2C, AC, 4C, 7C] }
  - { lead: 1, cards: [AS, 5S, 6S, QS] }
  - { lead: 1, cards: [KD, 2H, 3D, 9D] }
  - { lead: 1, cards: [10C, KC, 5C, 3C] }
trick: [{ seat: 2, card: QH }]
hearts_broken: true
queen_played: true
points: [0, 14, 0, 0]
expected: [8H]
principle: P1-DUCK
reason: "Seat 1 holds every point and plays after the CPU, and the king or ace of hearts could still beat seat 2's queen, so the CPU keeps the jack as its guard and ducks with the 8."
```

```yaml
id: R31
decision: follow
seat: 2
trick_number: 5
hand: [AH, 10H, 9H, 8H, 7H, 6H, 5H, 2S, 2D]
played:
  - { lead: 0, cards: [2C, AC, 4C, 7C] }
  - { lead: 1, cards: [AS, 5S, 6S, QS] }
  - { lead: 1, cards: [KD, 3D, 2H, 9D] }
  - { lead: 1, cards: [10C, 3C, 8C, KC] }
trick: [{ seat: 0, card: 4H }, { seat: 1, card: JH }]
hearts_broken: true
queen_played: true
points: [0, 14, 0, 0]
expected: [AH]
principle: P7-MOON-GUARD
reason: "The possible moon shooter is winning a trick with hearts in it, and the ace of hearts cannot be beaten, so it takes the trick even with a player still to come."
```

```yaml
id: R32
decision: follow
seat: 2
trick_number: 5
hand: [AH, 10H, 9H, 8H, 7H, 6H, 5H, 2S, 2D]
played:
  - { lead: 0, cards: [2C, AC, 4C, 7C] }
  - { lead: 1, cards: [AS, 5S, 6S, QS] }
  - { lead: 1, cards: [KD, 3D, 2H, 9D] }
  - { lead: 1, cards: [10C, 3C, 8C, KC] }
trick: [{ seat: 0, card: JH }, { seat: 1, card: 4H }]
hearts_broken: true
queen_played: true
points: [0, 14, 0, 0]
expected: [10H]
principle: P1-DUCK
reason: "Seat 0, not the possible moon shooter, is winning, so the moon is already stopped and it ducks with the 10."
```

### Passing

```yaml
id: R26
decision: pass
seat: 0
trick_number: 0
pass_direction: left
hand: [QS, AS, 5S, 2C, 7C, 9C, 3D, 8D, KD, 4H, 9H, 10H, AH]
played: []
trick: []
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [QS, AS, AH]
principle: P8-PASS
reason: "With only one spade under the queen, Q♠ and A♠ go, then the highest high heart."
```

```yaml
id: R27
decision: pass
seat: 1
trick_number: 0
pass_direction: right
hand: [QS, 9S, 6S, 2S, KH, QH, 3H, AD, 10D, 7D, JC, 8C, 4C]
played: []
trick: []
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [KH, QH, AD]
principle: P8-PASS
reason: "Three spades under the queen protect it, so it keeps its spades and passes its two high hearts and the ace of its unguarded diamonds."
```

```yaml
id: R28
decision: pass
seat: 2
trick_number: 0
pass_direction: across
hand: [QD, 9D, 8D, JC, 10C, 9C, 8C, 6C, 2S, 3S, 4S, 2H, 5H]
played: []
trick: []
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [QD, 9D, 8D]
principle: P8-PASS
reason: "Q-9-8 of diamonds is the most dangerous holding (fewest low cards against the most out below), so it passes all three and voids diamonds."
```

```yaml
id: R29
decision: pass
seat: 3
trick_number: 0
pass_direction: left
hand: [AS, KS, 4S, 2C, 3C, 5C, KD, 6D, 3H, 6H, 8H, 9H, 10H]
played: []
trick: []
hearts_broken: false
queen_played: false
points: [0, 0, 0, 0]
expected: [AS, KS, KD]
principle: P8-PASS
reason: "Without the queen and with only one low spade, the ace and king of spades would attract her, so they go, then the king of its unguarded diamonds."
```

---

## 6. Out of scope

This CPU deliberately does **not**:

- **Shoot the moon,** or keep cards for a moon attempt. It never aims to take all the points.
- **Count cards beyond §3.** It does not infer voids, remember its pass, track who holds Q♠, or read opponents' discards for meaning.
- **Break a principle on purpose.** It never plays a "clever" card that a principle forbids (for example leading Q♠ to flush it, or keeping a high card to block a moon before a threat exists).
- **Play to the match score.** It does not try harder or differently near 100, or target the leader. Points are points.
- **Feed or spare a particular player.** It never picks a card by who is winning the trick. The one exception is the moon guard, which checks whether the threatening player is winning.
- **Use randomness.** The same position always gives the same card. Varying difficulty or style is a separate decision for #3156.
- **Create voids on purpose when passing.** Any voids come only from the danger order (R28).
- **Deliberately flush the queen.** It never leads low spades to draw Q♠ out. It may lead a spade while holding Q♠ when P3 or P9 picks one, even though that thins her cover (owner decision #3177: allowed).

---

## 7. Research notes

### Translating Hoyle's to our game

The Hoyle's passage the owner supplied describes the older chips game, in which only hearts count and there is no Q♠ penalty, no passing and no moon bonus. What carries over, and what changes:

| Hoyle's                                                                                                                            | Our game                                                                 | Effect on this spec                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Only hearts score.                                                                                                                 | Hearts 1 point each, Q♠ 13, game to 100.                                 | Q♠ outweighs everything, so P5 is new and comes first.                                     |
| "Once a player has taken a heart, he does not care how many more." His only hope is to win them all or "paint" every other player. | Every point counts toward 100.                                           | Dropped. A player who has taken hearts still ducks.                                        |
| Nullo: win no tricks, or only harmless ones.                                                                                       | Same idea.                                                               | P1 and P2. Trick 1 is harmless because the engine bans hearts and Q♠ there.                |
| High cards that can be forced within three leads should be played early.                                                           | Same.                                                                    | P3 and the GUARDED test (two or more LOW cards, and at least as many as the non-LOW ones). |
| Middle cards without low cards are very dangerous; lead Q-9-8 every time; discard J-10-9-8-6 while lower cards are unplayed.       | Same.                                                                    | P4 (LOW and DANGEROUS are relative to cards still out), R19 and R17.                       |
| A high-card entry interrupts a "take-all".                                                                                         | The moon is all 13 hearts + Q♠: 0 for the shooter, 26 for everyone else. | P7. Our moon also needs Q♠, so the threat counts all points.                               |
| No passing.                                                                                                                        | Left, right, across, none.                                               | P8 reuses P5/P6, and the direction does not change the choice.                             |

### Sources consulted

- **Hoyle's** (the passage above, transcribed from the owner's photo). This is the main source for P1–P4 and P7.
- **pagat.com Hearts page** (`https://www.pagat.com/reverse/hearts.html`). The research environment could not reach it: its DNS failed and the proxy refused the connection. Its rules summary and its pointer to Joe Andrews' _The Complete Win at Hearts_ came only through search snippets. Before #3159 lands, someone should read its strategy notes directly and record any disagreement here.
- **General beginner guides** (search results: worldofcardgames.com, rarepike.com, dummies.com, yppedia). These agree on four points: pass Q♠ unless you hold enough lower spades (anywhere from 3 to 5 spades with her), pass A♠/K♠ when you have little spade length, keep low spades to play under the queen, and treat trick 1 as point-free. P5's thresholds come from this.

### Open-source CPUs studied (ideas only; no code copied)

| Repo                                                                                                         | License                                          | How its basic CPU picks a card                                                                                                                                                                                                                                                | Taken from it                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [yyjhao/html5-hearts](https://github.com/yyjhao/html5-hearts) (`js/SimpleBrain.js`)                          | BSD 2-Clause                                     | Following: the highest card under the current winner, else the lowest; as last seat with no way under, the highest. Void: Q♠, then any heart, then the highest card. Leading: the lowest card. Passing: random.                                                               | It confirms the duck rule (P1) and the discard order (P6). Its last-seat rule plays high only when it cannot get under, which is weaker than our P2. |
| [Rescator7/Hearts](https://github.com/Rescator7/Hearts) (`chearts.cpp`, `AI_get_cpu_move`, `AI_pass_spades`) | MIT                                              | Scores every legal card. Void: Q♠, then A♠/K♠ while Q♠ is unplayed, then hearts by rank, then the highest card. Last seat with no Q♠ in the trick: play big. Never lead Q♠, or A♠/K♠ while Q♠ is unplayed. Passes Q♠ with fewer than 5 spades, and A♠/K♠ when not keeping Q♠. | It is the closest match to P5 and P6. We use a lower spade-protection threshold (3 below the queen, about 4–5 spades) and add relative danger (P4).  |
| [StephenA0/Hearts-Player](https://github.com/StephenA0/Hearts-Player) (`make_decision.py`)                   | No license file (all rights reserved; read only) | Uses card counting and probability: void-building leads, a "Q♠ risk" estimate, and a "kth lowest" test for whether a card is safe. Passes Q♠ with two or fewer spades; passes A♠/K♠ with three or fewer. It does not shoot the moon.                                          | The idea of judging safety by how many cards out rank lower (our below/LOW). Its probability machinery is beyond beginner level and is not used.     |
| [Devking/HeartsAI](https://github.com/Devking/HeartsAI) (`LowPlayAI.java`)                                   | No license file (read only)                      | `LowPlayAI` plays the lowest legal card every time; there are also random, look-ahead and MCTS players.                                                                                                                                                                       | A counter-example: "always lowest" is exactly the trick-1 mistake our current CPUs make.                                                             |

### Where this spec differs from common advice

- **Leading high from danger (P3).** Many beginner guides say "lead low". Hoyle's says to lead a holding like Q-9-8 at every chance, so P3 leads the top of a dangerous non-heart suit. Low leads (P9) are used only when nothing is dangerous.
- **High hearts before other high cards when discarding (P6).** This follows the Rescator7 CPU and the epic draft. Hoyle's (hearts-only) agrees.
- **Q♠ protection threshold.** Sources range from 3 to 5 spades with the queen. We chose 3 below the queen (4 or more spades in all). It is a tuning constant.
