# Daily Challenge — Strategy (proposal)

**Status: draft for owner review (2026-11-21).** This is the *why* and the *rules of thumb* for the next version of
Daily Challenge. It does not describe live behaviour; [`DAILY-CHALLENGE.md`](DAILY-CHALLENGE.md) stays the contract
for what the code does today. Once the strategy is settled, the per-game design (step 2) and the offline/data
feasibility check (step 3) build on it, then stories are cut and shipped with `ship-story`.

Related backlog: #2946 (goals tuned to the player's history: this doc is its design spike), #2458 (premium goal
pools), #2459 (streak freezes), #2895 (schedule variety check), #3945 (Cascade targets).

## 1. What we are fixing

| Problem today                                                                                              | Where it comes from                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Daily Word sometimes asks for more than finishing ("solve in 4 guesses").                                  | The Daily Word *game* has no difficulty levels, but its *challenge goal* does: `FREE_GOAL_POOL` in `definitions.py` gives it complete / win / win in 4 guesses or fewer, picked by date. Of the 99 days the dev branch has frozen, 44 were complete, 33 win and 22 "in 4 guesses". Fixed by #3991. |
| Targets ignore the player. "Reach Bottle Sort level 60" for someone on level 4, "score 500 in 2048" for an expert. | One fixed target per tier, the same for everyone; the tier rotates by date, not by player.          |
| Goals can be for games the player never plays.                                                             | Games rotate through the whole pool by date.                                                        |
| Premium has no plan.                                                                                       | `PREMIUM_GOAL_POOL` is a copy of the free pool; the slate rule is all-or-nothing on ownership.      |
| Already-met goals ("reach level 10" when you are on 40).                                                   | Absolute targets. A relative target cannot be met before the day starts.                            |

## 2. What the product rules already decide

From [`PRODUCT.md`](PRODUCT.md), and they bind this design:

- **Short moments, calm, no grind.** A day's core goals should fit in one or two short sessions: roughly 10–15
  minutes in total for a typical player, never an hour.
- **No time pressure, no dark patterns.** No countdowns on goals, no "only 2 hours left" nudges, no loss framing.
- **No purchase prompts that exploit a streak.** A free player never sees a goal for a premium game they don't own,
  and never sees "buy X to keep your streak".
- **Free games stay complete.** Challenges never unlock or gate content.
- **Analytics (owner decision; PRODUCT.md update tracked in #3988).** First-party gameplay data may be used inside the app: to
  personalize features like Daily Challenge, and in aggregate to decide what to improve in the games. It is never
  sold, never used for marketing or ads outside the app, and never used to build profiles of identifiable people.

## 3. What the research says (short version)

- **Matching difficulty to the player is the biggest lever.** Frustration and boredom are the two main reasons
  players churn. A large field study of a freemium mobile game found that *lowering* difficulty for struggling
  players raised both engagement and long-term retention ([Ascarza, Netzer & Runge, "Personalized games"][cbs]).
  So a "beat yourself" goal beats a fixed number.
- **Aim for "likely, not certain".** Daily goals should be a small stretch of normal play, not a separate grind, and
  they must have a ceiling so they can't be farmed ([Deconstructor of Fun on daily missions][dof-puzzles],
  [Deconstructor of Fun: making of daily goals][dof-goals]).
- **Few goals, distinct types, filtered to what the player can do.** The common practical pattern: about three
  daily goals, each of a different type, with goals the player can't realistically do filtered out. Variety of
  *type* matters more than a large catalogue ([Roblox quest design guide][roblox]).
- **Dailies feel like a job when they are mandatory and tied to progression.** Optional, varied goals and "just
  playing counts" are what players praise ([PC Gamer][pcg], [Engadget][eng], [MassivelyOP][mop]).
- **Streaks work, and flexibility helps rather than hurts.** Duolingo reports that a 7-day streak makes a learner
  several times more likely to come back the next day. Allowing a "freeze" (a day off) *raised* daily activity, and
  the Penn/UCLA research it cites found some slack motivates more than rigid rules ([Duolingo: streak research][duo1],
  [Duolingo: how the streak builds habit][duo2]). The ethical line is a streak that serves the player versus one
  that traps them ([Yu-kai Chou on streak design][ykc]).

Caveat: most sources are practitioner writing and company blogs. The Columbia study is the only rigorous one. We
should treat the numbers in this doc as starting dials, not truths.

## 4. Proposed daily structure

```
┌───────────────────────────────────────────────────────────┐
│  Daily Challenge                                  🔥 12   │
│  ✓ Daily Word — complete today's word                     │   core 1 (always)
│  ○ Solitaire — win a game                                 │   core 2 (a game you play)
│  ○ Bottle Sort — solve 2 new levels                       │   core 3 (a game you play)
│  ─────────────────────────────────────────────────────    │
│  ☆ Bonus: try Sudoku — finish an Easy puzzle              │   optional (no streak)
└───────────────────────────────────────────────────────────┘
```

1. **Daily Word: always "complete today's word"** (finish it, win or lose). No tiers. This removes the "in 4
   guesses" variant. It can ship on its own, ahead of everything else.
2. **Two core goals** in two other games, personalized (§5) and picked from games the player actually plays (§6).
3. **One optional bonus goal.** Clearly marked as a bonus. It never counts toward the streak and is never needed for
   "day complete". It is the slot for discovery (a game they haven't tried) or a slightly bigger stretch.
4. **Streak unchanged: 2 of the 3 core goals.** With Daily Word always being "complete", Daily Word plus one other
   keeps the streak. That is the built-in slack the research favours and it fits the calm vision. Whether 2 of 3
   is too easy now is a dial to watch (§8), not something to change blind.
5. **No reroll, at least at first.** Picking from games the player plays makes most rerolls unnecessary, and a
   reroll adds UI and state. Revisit if completion data shows a slot being skipped.

## 5. How hard is a goal: "beat your normal, a little"

A small, fixed vocabulary of **goal archetypes**, with targets taken from the player's own recent results:

| Archetype            | Shape                                                    | Example                                  | Win-dependent? |
| -------------------- | -------------------------------------------------------- | ---------------------------------------- | -------------- |
| **Finish**           | Complete a game, any result.                             | "Finish a game of Yacht"                 | No             |
| **Personal stretch** | Beat a target set just above your recent typical result. | "Score 1,800+ in 2048" (typical: 1,500)  | No             |
| **Progress**         | Advance from where you are, never an absolute number.    | "Solve 2 new Bottle Sort levels"         | No             |
| **Skill**            | A win, or a win with a modest quality bar. Every game but Star Swarm has a clear win (§7a). | "Win a game of FreeCell"                 | Yes            |

Rules:

- **Targets are relative.** Set from the player's recent history at the start of their day and then pinned for the
  day: no moving goalposts mid-day. A relative target ("2 levels past where you started today") can never be met
  before the day starts. That fixes the "already achieved it" problem by design.
- **Aim for about a 65–75% chance of success** for a core goal. Start with a simple percentile rule: the stretch
  target is around the player's recent median plus a small step (e.g. 10–15%), and is **capped below their
  personal best** and **floored at a sane minimum**. No models, no ML.
- **Cold start.** With fewer than about 3 recent results in a game, use that game's static "easy" target (today's
  easy tier). New players get Finish goals.
- **Bad streaks ease off.** If the player missed the same game's stretch target the last two times, step the target
  down rather than up (the Columbia finding).
- **At most one win-dependent goal a day** (kept from today's rules), so luck can't sink a day.
- **Tiers become a per-player outcome, not a date roll.** "Easy/medium/hard" stops being a calendar choice; the
  archetype plus personal target replaces it.

## 6. Which games: focus vs discovery, free vs premium

### Eligible games

**Premium is one purchase that unlocks every premium game** (owner, 2026-11-21). So there are two kinds of player:

- **Free player:** eligible games = the free games. They never see a goal for a premium game.
- **Premium player:** eligible games = every game.

This replaces today's per-template "owns every premium game named" check with one flag. Note: `docs/IAP.md` still
describes one product per game with no bundle; the docs and the purchase code are changed by #3989.

### Focus on what they play (core slots)

- Each eligible game gets an **affinity score** from recent play: games finished in the last ~14 days, with recent
  days weighted more.
- **Both core slots come from games with affinity** (played in the window), chosen with probability proportional
  to affinity, so favourites appear most but not every day.
- **Variety guard:** a game isn't in the core slots two days running, unless the player only plays one or two games.
- **Players who play only one game** (beyond Daily Word): core 2 and 3 can be two different archetypes in that one
  game. We don't force them into games they've shown no interest in to keep their streak.
- **Players with no history** (new, or back after a long gap): core slots rotate over the free catalogue with
  Finish goals, as today.

### Discovery lives in the optional slot

- The bonus slot **mostly** (dial, start ~50%) suggests an eligible game the player **hasn't played in ~14 days or
  ever**, with a Finish goal: the lowest-friction ask.
- **Stop suggesting a game the player keeps ignoring.** If a discovery game is offered and not played 3 times, it
  rests for 30 days. This is the "if they're not into Sudoku, stop showing Sudoku" rule.
- Otherwise the bonus slot is a slightly bigger personal stretch in a favourite game.

### Premium players: free vs premium mix

- **Pick by play, not by price.** A premium player's core goals come from the games they actually play, free or
  premium. A premium game they play a lot shows up often.
- **Unplayed premium games surface through the bonus slot.** A premium game the player hasn't tried is a discovery
  candidate, with the same "rest it after 3 ignores" rule. That shows what they paid for without forcing it.
- **No extra quota** (an earlier draft had "a premium game at least twice a week"). Dropped as unnecessary given the
  bonus slot. It can come back as a dial if premium players turn out to see their premium games too rarely.
- Daily Word stays the anchor for everyone.

**Starting split (all dials):** core slots about 100% "games you play", bonus slot about 50% discovery and 50%
stretch.

## 7. How much variety is enough

Variety comes from combining a few things, not from many goal definitions:

- **Game** (rotated by affinity with the no-repeat guard) × **archetype** (4) × **personal target** (moves with the
  player) already gives plenty of different days.
- **Per game, 2–3 archetypes are enough.** Usually Finish, plus one or two of Stretch/Progress/Skill that suit the
  game. No need for a dozen per game.
- **Variety rules:** the two core goals are of different archetypes where possible; the same (game, archetype)
  doesn't repeat within ~3 days; at most one Skill (win) goal a day.

## 7a. One pattern for every game: play to the win

**Every game except Star Swarm has a clear win**, and goals treat them all the same way. This includes Blackjack
and Cascade. Their genres are usually endless: real blackjack has no end, and Suika-style drop games are built to
keep you paying to continue. Ours each give the player a designed **win**. That's a feature we want the challenge
to point at, not a special case to design around.

**The shared model**

- **One game = one deal, puzzle, board or run**, ending in a win, a loss or an abandon.
- **Finish** = a game that ended in a win or a loss.
- **Win** = the game's own win condition:
  - **Blackjack:** reach the table's chip goal.
  - **Cascade:** make the capstone.
  - **Sort / Sudoku:** solve the level or puzzle.
  - **Solitaire / FreeCell / Mahjong:** clear the board.
  - **Yacht / Hearts:** win the game.
  - **Daily Word:** guess the word.
  - **2048:** reach the 2048 tile.
- **Abandoned games never count, in any game**, including progress made before quitting. One rule, no
  per-game exceptions (this settles the "progress in a restarted game" question).
- **Personal targets** use the measure the game already reports (score, moves, level, time, table), as in §5.

**Blackjack** ([`games/blackjack.md`](games/blackjack.md))

- A run starts at a table with a fixed stack (Beginner 100, up to High Roller 500).
  - **Win:** reach its chip goal (then Cash Out, or Keep Playing).
  - **Loss:** chips run out first.
  - **Abandoned:** quit before the goal.
- The run is the game. Goals are "win a run", "finish a run", and a stretch of "win a run at the next table up".
- Drop the pending hand-count goals ("play 3 hands", "win 3 hands"). They don't fit the pattern: they would only
  count once the run ends.
- A win depends on the cards, so "win a run" is the day's one luck-dependent goal when it appears.
- A resumed run counts on the day it ends.
- The dev data has no Blackjack run that reached its goal yet, so step 2 must confirm a win records as `win`.

**Cascade** ([`games/cascade.md`](games/cascade.md))

- **Win:** the capstone. **Loss:** the stack over the lid. **Abandoned:** restart or switch piece sets.
- **Winning isn't rare or long.** In the owner's dev play, 9 wins took a median of 4.5 minutes and at most 7.5
  minutes. The extra tier (#3960) is meant to make it a little harder, **not** much longer: Cascade stays a
  few-minute game.
- So "Win a game of Cascade" is an ordinary daily goal, just like "win a game of Solitaire". **Tier goals ("reach a
  Melon") are dropped:** everything below the capstone is too easy to be a challenge.
- Stretch goals, if any, are on the win itself: for example, win within a time that is personal to the player
  (with the existing 20 s floor) or beat your best winning score. Keep the stretch goals light until the new
  tier's real win rate is known. #3945 (Cascade targets) should follow this.

**Star Swarm is the exception.** It's an endless arcade run with no win, so its goals are personal score or wave
stretches. It is designed in step 2 with the other premium games.

## 8. Measuring whether it works

Deliberately small, from data we already have (frozen assignments plus `games` rows). No new client analytics.

| Signal                                        | Target band (start)  | If outside                                             |
| --------------------------------------------- | -------------------- | ------------------------------------------------------ |
| Core goal completion rate, among players who attempt the game | 65–75%  | Turn the stretch step up or down                       |
| Days with 2 of 3 core met / active days       | Watch                | If ~100%, 2 of 3 may be too easy. If low, too hard.    |
| Bonus discovery: game played after suggestion | Watch                | Low means lower the discovery share                    |
| Next-day return after a qualifying day        | Watch                | The real retention signal                              |

**Current data reality:** production (`bc-arcade` `main`) holds almost nothing yet (52 games, 3 sessions). We launch
on the heuristics above with **server-controlled dials** and tune once real players arrive.

### What the dev branch shows (2026-11-21)

The Supabase `dev` branch has 763 finished game rows from 2026-10-10 to 2026-11-21 across 126 sessions. But 123 of
those sessions played only one game type (tests and reinstalls), and one session accounts for 584 rows over 35
active days: **the owner's own play**. The app is not live, so this is one person, who knows the games and
tests them on purpose. Treat it as a smoke test of the strategy's assumptions only. **Nothing here sets a
target, a weight or a dial.** Those come from real players after launch. What it suggests:

- **Play is concentrated with a long tail.** The heavy player touched all 12 games but mostly two: Star Swarm 234
  and Yacht 150, then Cascade/Solitaire 36 each and the rest between 4 and 30. "Played in the last 14 days" would
  include nearly every game for such a player, so affinity has to be **weighted by volume**, not a yes/no.
- **The fixed targets are miscalibrated, in both directions.**
  - 2048: median score ~2,970, so "500" (easy) and "2,500" (hard) are both trivial.
  - Yacht: median ~236, so "250" (hard) is a coin flip and "100" (easy) is a given.
  - Sort: median level 3.5, best 17, so the catalog goals of 30/60 are out of reach.

  This is exactly the "arbitrary" feel, and relative targets fix it.
- **Sessions are bite-sized.** Median game length is 0.3–6 minutes depending on the game. On a typical active day:
  ~13 games, 4 different games, ~30 minutes in total. Two core goals of one to three games each fit the vision.
- **Daily Word is already a habit.** 30 plays on 25 of 35 active days, so it works as the anchor.
- **The most-played game can't be a goal today.** Star Swarm, a premium game, has no goals in any pool (#2458).
  Under the affinity rule, a premium owner's favourite game must be eligible.
- **Abandons matter more than expected.** Abandoned rows never count toward a goal, and abandon rates are high in
  some games: Solitaire 72%, FreeCell 68%, Cascade 64%, Blackjack 92% (vs Yacht 6%, Daily Word 13%). Players often
  redeal rather than finish. Even "Finish a game" is a real ask in those games. Leaving a Blackjack run before its chip goal is
  correctly an abandon, not a bug.

## 9. Cost, performance and offline: early read (superseded by §13)

The CLAUDE.md order applies: cost, then performance, then data. A first look:

- **Server.** Per-player targets need a small per-session, per-day assignment record (games, archetypes, pinned
  targets): about 200 B per active player per day. At 1,000 daily players that is ~200 KB/day, and ~12 MB with a
  60-day retention prune (it also bounds the streak lookback). It needs a cap and a prune, like `daily_word_progress`.
  The alternative is recomputing targets from history on every read, which costs more CPU and is harder to replay.
- **Device.** Devices store personal bests and level progress (`personal_best_v1:<game>`, Sort progress) but **no
  recent-results history**. Offline personal targets need a tiny per-game ring buffer of the last ~10 key results:
  about 12 games × 10 × ~20 B, or ~2–3 KB total. It is written once at game end (not on the gameplay path). That
  looks like the "just another flag" kind of cost.
- **Offline flow (to be designed in step 3).** The device can choose games and set targets from local data alone,
  using the same rules, and pin them for the day. When it reconnects, the server accepts the pinned targets if
  they fall within the server's allowed band (floor/cap) for that archetype. Daily Word stays pre-scheduled as now.
  Offline must keep working for at least the current 3-day window.
- **Dials and kill switch.** The stretch step, discovery share, premium floor and a "static targets" kill switch
  (fall back to today's fixed easy-tier goals) are server settings, cached by the client, and changeable without an
  app release.

## 10. Owner decisions needed

1. ~~Streak rule.~~ **Decided (owner, 2026-11-21):** keep 2 of 3 core goals.
2. ~~Bonus slot.~~ **Decided (owner, 2026-11-21):** show the bonus goal every day; completing it gives nothing beyond
   its checkmark (a reward can be revisited later).
3. ~~Analytics rule.~~ **Decided (owner, 2026-11-21):** in bounds. First-party data is used inside the app to
   personalize features and improve the games; it is not sold, not used for outside marketing, and not used to
   profile identifiable people. PRODUCT.md update: #3988.
4. ~~Premium floor.~~ **Decided (owner, 2026-11-21):** premium unlocks every premium game, so a player is either free
   or premium. No extra quota; premium games are picked by play, and unplayed ones surface in the bonus slot.
5. ~~Ship order.~~ **Decided (owner, 2026-11-21):** all of this ships before go-live. "Daily Word = complete only" can
   be the first story, since it's small, but it's not a separate release.

## 11. Next steps

1. **Owner review of this doc** → resolve §10 → mark as accepted.
2. **Per-game design:** for each game, its 2–3 archetypes, what "recent typical" means (score, moves, level, time),
   floors/caps and cold-start targets. One table per game, appended here.
3. **Offline and data feasibility:** confirm §9 per archetype, size the ring buffer and assignment table, design
   the pin-and-reconcile flow, list fail-safe tests (epic #3273 style).
4. **Cut stories** with `plan-issues` (update #2946 / #2458 instead of duplicating them), then ship with
   `ship-story`.

## 12. Per-game design (draft for review)

Built from each game's spec in [`docs/games/`](games/) and its result fields. Every row follows §7a: win / loss /
abandon as the game defines them, and abandons never count. **Target rules** use §5: the personal target is set
from the player's last ~10 finished games of that game, pinned at the start of the day, capped below their best,
and eases off after two misses. Numbers marked *start* are cold-start values, used until the player has about 3
finished games, and are server dials.

### Ending rules per game

| Game         | Win                               | Loss                              | Abandon                    | Finish = |
| ------------ | --------------------------------- | --------------------------------- | -------------------------- | -------- |
| Daily Word   | solve the word                    | out of guesses                    | leave unfinished           | win or loss |
| 2048         | make the 2048 tile                | stuck before 2048                 | New Game / leave           | win or loss |
| Solitaire    | clear the deal                    | **none**                          | redeal / leave             | **win only** |
| FreeCell     | clear the deal                    | **none**                          | redeal / leave             | **win only** |
| Bottle Sort  | solve the level                   | none                              | leave the level            | win only |
| Sudoku       | solve the puzzle                  | none                              | leave / new puzzle         | win only |
| Yacht        | vs computer: beat it; solo: n/a   | vs computer: lose                 | leave mid-game             | 13 rounds scored |
| Hearts*      | lowest score at the end           | not lowest                        | leave mid-game             | win or loss |
| Mahjong*     | clear the board                   | deadlock (recorded on leaving)    | leave mid-board            | win or loss |
| Blackjack*   | reach the table's chip goal       | chips run out first               | quit before the goal       | win or loss |
| Cascade*     | make the capstone                 | stack over the lid                | restart / switch set       | win or loss |
| Star Swarm*  | **none** (endless run)            | game over                         | New Game mid-run           | game over |

\* premium. Solitaire and FreeCell deal only **provably solvable** deals, so their wins are skill, not luck.

### Goals per game

| Game         | Goals (2–3 each)                                                                                              | Personal measure                     | Cold start (*start*)                | Win-dependent goal |
| ------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------- | ------------------ |
| Daily Word   | **Complete today's word** (only goal, always core 1)                                                          | none                                 | same                                | none               |
| 2048         | Finish a game · Score at least *target* · Make the 2048 tile                                                  | `final_score`                        | Finish a game                       | 2048 tile          |
| Solitaire    | Win a deal · Win in at most *target* moves                                                                    | `moves` on wins                      | Win a deal                          | none (solvable)    |
| FreeCell     | Win a deal · Win in at most *target* moves                                                                    | `moves` on wins                      | Win a deal                          | none (solvable)    |
| Bottle Sort  | Solve *N* new levels (N = 1–3) · Earn 3 stars on a level you've solved                                         | levels solved per day; stars         | Solve 1 new level                   | none               |
| Sudoku       | Solve a puzzle · Solve one at your usual difficulty or one higher · Solve with at most *target* errors         | difficulty, `errors`                 | Solve an Easy puzzle                | none               |
| Yacht        | Finish a game · Score at least *target* · Beat the computer                                                   | `final_score`                        | Finish a game                       | beat the computer  |
| Hearts*      | Finish a game · Win a game                                                                                    | win rate (for picking, not target)   | Finish a game                       | win                |
| Mahjong*     | Clear a board · Clear one in under *target* time                                                              | `duration_ms` on clears              | Clear a board                       | none (a deadlock can be undone) |
| Blackjack*   | Finish a run · Win a run · Win a run one table up from your usual                                             | the table of your recent runs        | Finish a run at Beginner            | win a run          |
| Cascade*     | Finish a game · Win a game · (light) Win in under *target* time                                               | `duration_ms` on wins                | Finish a game                       | none (skill game)  |
| Star Swarm*  | Finish a run · Reach wave *target* · Score at least *target*                                                   | `wave_reached`, `final_score`        | Finish a run                        | none               |

Notes:

- **Finish-only games.** For Solitaire, FreeCell, Sort and Sudoku a finished game *is* a win, so their base goal is
  the win. That's fine because the deals and levels are always solvable. Their stretch is quality (fewer moves,
  fewer errors, a harder puzzle, stars), not score.
- **Bottle Sort.** "Solve N new levels" counts levels above the highest level solved before today, so it can never
  already be done, and it stops at level 120. A player who has finished the catalog gets the stars goal instead.
- **Star Swarm** has no win, so it has no Skill goal. Its stretch should use the difficulty tier the player
  usually plays, since score depends on the tier.
- **Hearts** games last longer (about 6 minutes), so it gets no score stretch. Winning is the stretch.
- **Cascade** stretch goals stay light until the new tier's win rate is known (§7a).

### What this changes in today's goal pool

- **Daily Word:** drop the "win" and "win in 4 guesses" goals (§4).
- **Solitaire / FreeCell:** "make 10 moves" and "make 5 moves" are not really easy goals. These games have no
  loss, so a finished row only exists for a win, and these goals already require one. They also wrongly mark
  Solitaire's win as luck-dependent: the code comment says "Klondike deals are not always winnable", but the deal
  bank is provably solvable.
- **Yacht:** the comment "abandoned games count with their score so far" is out of date: abandons are filtered.
- **Bottle Sort:** the absolute level targets (3/8/15 and 10/30/60) are replaced by "N new levels".
- **Blackjack:** the pending hand-count goals are dropped (§7a).

### Data needed per measure (input to step 3)

| Measure                            | Server today                    | Device today                              | Gap                                     |
| ---------------------------------- | ------------------------------- | ----------------------------------------- | --------------------------------------- |
| Recent finished games per game (scores, moves, times) | `games` rows (full history) | only the personal best                  | small per-game ring buffer (§9)         |
| Highest Sort level solved          | `final_score` on solves         | Sort progress save                        | none                                    |
| Sort stars per level               | not stored as a field           | `personal_best_v1:sort` (best moves) vs par | server: derive from moves and par, or skip offline |
| Sudoku difficulty, errors          | `games.metadata`                | personal best per variant                 | ring buffer                             |
| Blackjack table of recent runs     | `starting_chips` in metadata    | local run records                         | none                                    |
| Star Swarm tier, wave              | result block                    | `starswarm.*` best                        | ring buffer                             |
| Affinity (games played recently)   | `games` rows                    | none                                      | ring buffer gives it for free           |

## 13. Offline, cost and data design (step 3)

This replaces the early read in §9. The main change is that **the server picks every goal, and the device only
caches**. The pick logic lives in one place (Python) and is never re-implemented on the device, and **no new
on-device history is needed**. §9's ring buffer is dropped.

### How a day is assigned

1. **Pin when served.** On the first `/status` or `/upcoming` request that needs a given (install, local date),
   the server picks that day's goals for that install and **stores them as a pinned assignment**. Every later read,
   on any device, returns the same pinned goals. This applies the existing frozen-day idea (§4 of
   DAILY-CHALLENGE.md) per install instead of per date.
   - **Shipped in #3992** (storage and plumbing; the pick is still the shared template). Pinning starts only for
     an install with a `games` row created in the last `DAILY_CHALLENGE_PIN_RECENT_PLAY_HOURS` (48), and only while
     storage is under budget: the fuller of replay events vs `REPLAY_STORAGE_BUDGET_MB` and the whole database vs `DATABASE_PLAN_MB`, at the replay recorder's 90 % turn-down point. Any other install is served the shared
     template and nothing is stored. The slate is pinned with the day.
2. **Targets become plain numbers.** A personal target is resolved at pick time into an absolute value: "Score at
   least 1,800", "Reach Sort level 23" (baseline 21 + 2 new levels), "Win in at most 104 moves". The existing
   evaluator (`*_at_least`, `won_*_at_most`, `won`, `completed`) checks them with no per-player logic. Replaying a
   past day for the streak just reads the pinned row.
3. **Inputs at pick time** (one windowed query): the install's last ~10 finished games per game type and the last
   14 days of play, for affinity. Also the install's recent assignments, for the variety guard and the "rest a
   game after 3 ignored suggestions" rule. Plus entitlements, for eligibility.
4. **The 3-day offline window stays.** `/upcoming` becomes per-install: it returns today and the next 2 days,
   pinned. A device going offline has 3 days of its own goals, exactly as today. The device's progress display
   (`localProgress.ts`) already evaluates queued games against cached goals. It needs no change beyond knowing the
   bonus slot.
   - Trade-off: days +1 and +2 are pinned from the history known when they were first served, so their targets
     can be up to 2 days stale. That's accepted: the staleness is small and it keeps one pick per day per install.
5. **New installs.** The first `/status` of an install with no history gets cold-start goals (§12), but as shipped
   (#3992) they are **not pinned until its first game syncs**: a brand-new install's first-day goals, and the days
   it caches for offline play, come from the unpinned path and the next request after that game pins. An install
   that is offline from first launch has nothing cached and keeps today's "connect to get today's challenge" message.

### Wire compatibility with installed builds

- Core goals keep the current shape (`game_type`, `kind`, `target`). Sort's "N new levels" is sent as
  `final_score_at_least` with the pinned level, so **older app builds render every new core goal correctly**.
- The bonus goal goes in a **new `bonus` field** that older builds ignore. They keep showing 3 goals and a correct
  done count.
- Cross-game rules unchanged: at most one win-dependent goal a day, and abandons never count.

### Cost (CLAUDE.md priority 1)

| Item | Estimate | Bound |
| --- | --- | --- |
| Assignment row (install, date, 3 core goals, compact encoding) | **~250 B incl. index, measured** on Postgres 16 (193 B heap + 54 B index); a bonus goal adds ~40 B. The ~150 B first estimate was below the fixed per-row cost (~120 B) | 1 per recently active install per day served; at most 3 days ahead; none while over the storage budget |
| Per 1,000 daily players | ~250 KB/day; **~15 MB** held at 60-day retention | prune after `DAILY_CHALLENGE_ASSIGNMENT_RETENTION_DAYS` (default and minimum `STREAK_LOOKBACK_DAYS` + 1, 61), daily batched delete like `daily_word_progress` |
| Per 10,000 daily players | ~2.5 MB/day; **~150 MB** held | same prune. For scale: their `games` rows (~13 games/day, several hundred bytes each) grow many times faster |
| Pick query | one windowed read of the install's recent games, **once per install per day** | later reads of that day are one row lookup |
| Requests | none new: `/status` and `/upcoming` already exist and are called on Home focus | — |

Abandoned or never-opened days cost nothing: a row exists only when a day is served to an install that has played
in the last 48 h.

### Dials and kill switch (no app release needed)

Server env vars, read lazily like the existing daily-challenge settings:

- `DAILY_CHALLENGE_PERSONALIZED` (default on). **Kill switch**: off means every install gets the shared frozen
  template (today's behaviour with the Daily Word fix), and no assignment rows are written.
- Shipped in #3992: `DAILY_CHALLENGE_ASSIGNMENT_RETENTION_DAYS` (default `STREAK_LOOKBACK_DAYS` + 1, 61; refused below
  that) and `DAILY_CHALLENGE_PIN_RECENT_PLAY_HOURS` (48).
- Proposed for later stories: `DAILY_CHALLENGE_STRETCH_PCT` (start 12), `DAILY_CHALLENGE_DISCOVERY_SHARE` (start
  0.5), `DAILY_CHALLENGE_BONUS_ENABLED` (start on).

None of these touch the device, so the `/games/catalog` dial carrier isn't needed.

### Performance (priority 2)

Nothing is added to a game's frame, gesture or animation path, and nothing is uploaded mid-game. The device does no
new computation: the pick runs on the server once per install per day.

### Privacy and Delete My Data

- Assignment rows are keyed by install ID and derived only from that install's own games.
- **Delete My Data (`DELETE /me`) must delete them.** That's a fail-safe test.
- DATA-INVENTORY.md gets a row. No new store-privacy category: this is app functionality from first-party gameplay
  data (#3988).

### Fail-safe tests (epic #3273 style)

- Kill switch off: shared template served, no rows written.
- Retention prune removes rows older than the window, and the streak never reads past it.
- At most 3 future days pinned per install.
- Every personal target lies within its floor and cap, and never at or below what the player had already reached
  before the day (e.g. a Sort level already solved).
- Abandoned games never satisfy any goal.
- An older build's card shows 3 goals and a correct count when `bonus` is present.
- `DELETE /me` removes the install's assignment rows.
- Offline: cached per-install days are used for 3 days; a goal met offline is credited when the game syncs.
- The streak counts only core goals; the bonus never affects it.

## 14. Proposed stories

The epic covers updating or replacing #2946, #2458 and #3945. Model choice per story is the ship-story default
(cheapest capable). This is a suggestion.

| # | Story | Depends on | Size | Suggested model |
| - | ----- | ---------- | ---- | --------------- |
| 1 | Daily Word goal = "complete" only (pool change; frozen days untouched) | — | S | Sonnet |
| 2 | Per-install pinned assignments: table, pin-on-serve for `/status` and `/upcoming`, prune, `DELETE /me`, streak replay reads it, kill switch | — | L | Opus |
| 3 | Personal targets: per-game goal specs and target rules from §12 for the free games (incl. Sort "N new levels", Solitaire/FreeCell fixes) | 2 | M | Opus |
| 4 | Game selection: eligible set (free vs premium), affinity weighting, variety guard, discovery rest rule | 2 | M | Sonnet |
| 5 | Bonus goal: `bonus` field, Home card UI (marked optional), i18n, offline progress, never in the streak | 2, 4 | M | Sonnet |
| 6 | Premium games' goals (Blackjack, Cascade, Hearts, Mahjong, Star Swarm) per §12, replacing #2458 / #3945 | 3 | M | Sonnet |
| 7 | Docs: DAILY-CHALLENGE.md (new contract), DATA-INVENTORY.md row, retire superseded sections of this proposal | 2–6 | S | Haiku |
| 8 | Tuning query: the §8 metrics as a read-only SQL script for the dev/prod database (no new collection) | 2 | S | Sonnet |

[cbs]: https://business.columbia.edu/sites/default/files-efs/citation_file_upload/Personalized_games.pdf
[dof-puzzles]: https://www.deconstructoroffun.com/blog/2024/9/23/daily-missions-in-puzzles-why-should-we-see-them-more-often
[dof-goals]: https://www.deconstructoroffun.com/blog//2016/07/the-making-of-mechanic-daily-goals.html?format=amp
[roblox]: https://create.roblox.com/docs/production/game-design/introduction-to-quest-design
[pcg]: https://www.pcgamer.com/daily-quests-arent-fun-theyre-tedious
[eng]: https://www.engadget.com/2014-01-29-mmo-mechanics-encouraging-the-daily-grind.html
[mop]: https://massivelyop.com/2019/10/31/massively-overthinking-the-problem-with-mmo-dailies/
[duo1]: https://blog.duolingo.com/duolingo-streak-research/
[duo2]: https://blog.duolingo.com/how-duolingo-streak-builds-habit
[ykc]: https://yukaichou.com/gamification-study/master-the-art-of-streak-design-for-short-term-engagement-and-long-term-success/
