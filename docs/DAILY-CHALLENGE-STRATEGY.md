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
| Daily Word sometimes asks for more than finishing ("solve in 4 guesses").                                  | Daily Word has easy/medium/hard tiers like every other game (`definitions.py`).                     |
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
- **"Never build: advanced analytics beyond error reporting."** This is in tension with the "deep analytics" idea.
  The personalization below uses only first-party results we already store for gameplay. Anything beyond that is an
  owner decision (see §10). It must not slip in through this feature.

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
| **Skill**            | A win, or a win with a modest quality bar.               | "Win a game of FreeCell"                 | Yes            |

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

A player's **eligible set** = free games + premium games **they own**. A free player only ever sees free games.
This replaces today's "premium slate only if you own every premium game named" rule with one per-player list, so a
player who owns one premium game gets it, without either pool needing to change.

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

### Premium owners: free vs premium mix

- **Don't weight by price, weight by play.** A premium game they play a lot naturally shows up often; one they
  bought and never touch is a discovery candidate, not a forced core goal.
- **A light floor for what they paid for.** If a player owns a premium game, it appears somewhere on the card
  (core or bonus) at least about twice a week. That makes the purchase feel seen without crowding out their free
  favourites.
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
those sessions played only one game type (tests and reinstalls), and one session (a heavy tester) accounts for
584 rows over 35 active days. So this is a **sanity check of the strategy, not a tuning set**. What it shows:

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
  redeal rather than finish. Even "Finish a game" is a real ask in those games, and the per-game step must check how
  each game records its normal end. Blackjack's 92% suggests a normal "leave the table" ends as `abandoned`, which
  would make every Blackjack goal unreachable.

## 9. Cost, performance and offline: early read (step 3 will verify)

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

1. **Streak rule.** Keep 2 of 3 core goals (recommended), or move to 3 of 3 now that Daily Word is "complete only"?
2. **Bonus slot.** Show it every day (recommended), or only on some days? Does completing it give anything (nothing,
   recommended; or a small cosmetic/XP bonus later)?
3. **"Advanced analytics" rule.** PRODUCT.md says never build analytics beyond error reporting. Confirm that using
   first-party game results for personalization and the small §8 metrics is in bounds, and that "deep analytics" is
   a separate, later decision.
4. **Premium floor.** Is "an owned premium game appears ~2×/week" right, or should premium games get no special
   treatment at all?
5. **Ship order.** Ship "Daily Word = complete only" now as a quick win, ahead of the rest? (Recommended.)

## 11. Next steps

1. **Owner review of this doc** → resolve §10 → mark as accepted.
2. **Per-game design:** for each game, its 2–3 archetypes, what "recent typical" means (score, moves, level, time),
   floors/caps and cold-start targets. One table per game, appended here.
3. **Offline and data feasibility:** confirm §9 per archetype, size the ring buffer and assignment table, design
   the pin-and-reconcile flow, list fail-safe tests (epic #3273 style).
4. **Cut stories** with `plan-issues` (update #2946 / #2458 instead of duplicating them), then ship with
   `ship-story`.

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
