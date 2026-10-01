> **Verification procedure.** This checklist validates the current reporting system; it is not the product specification. See [LEADERBOARDS.md](LEADERBOARDS.md) for current behavior and [GAME-CONTRACT.md](GAME-CONTRACT.md) for the integration contract.\n\n# Manual QA: results, leaderboards, stats and Profile

A hand check of the leaderboards and scoring epic (#2519). Run it on real iOS and Android builds: the store-configuration builds (Wed 30 build #2 and the RC) and any TestFlight or Play test build that carries these changes.

This replaces native automation for now. The Maestro result-submission flow (#2643, draft #2736) is paused past v1.0 (see `docs/MAESTRO.md`).

**Time:** about 15 minutes per platform. Tick every box on each platform.

## Setup

- [ ] Install the build on a clean device, or use **Settings → Delete my data**, so the player has no name and no history.
- [ ] Know which build this is:
  - **Store configuration** (production API): exactly **7** games (Yacht, Solitaire, FreeCell, Daily Word, 2048, Sudoku, Sort).
  - **Pre-launch or test** build: all 12.
- [ ] Start online.

## 1. Navigation

- [ ] There are exactly **three** bottom tabs: Lobby, Profile, Settings. There is no Ranks tab (#2634).

## 2. First result, name and rank

Play one quick game to the end. A 2048 loss, an easy Sudoku or a solo Yacht game all work.

- [ ] The result card asks **"Join the leaderboards?"** once, with a **Join leaderboards** button and **no text field** (#2778). Press it.
- [ ] The card's line becomes **"Saved as ‹generated name› · #N on the leaderboard"** (e.g. "Brave Otter 4821"), or "Saved as ‹name› · Your best: #N" when this wasn't your best game.
- [ ] **"View leaderboard"** opens that game's leaderboard with **your row highlighted** in the list, or pinned below it when you're outside the top 50.
- [ ] Going back returns to the result card. The card doesn't announce itself again, and nothing covers the leaderboard screen.
- [ ] Play the same game again. The join prompt does **not** appear a second time.

## 3. Offline result

- [ ] Turn on airplane mode, then finish a game. The card shows the offline state and doesn't crash.
- [ ] Turn airplane mode off with the card still open. The rank appears within about 30 seconds.

## 4. The ⋯ menu, on every visible game

Open each game's ⋯ menu and check its items.

| Game                                                 | Stats | Leaderboard           | Scorecard |
| ---------------------------------------------------- | ----- | --------------------- | --------- |
| Yacht                                                | ✔     | ✔                     | ✔ (#2742) |
| Solitaire, FreeCell, 2048, Sudoku, Sort              | ✔     | ✔                     | —         |
| Daily Word                                           | ✔     | — (board disabled)    | —         |
| Pre-launch builds only: Hearts, Blackjack            | ✔     | Hearts ✔, Blackjack — | ✔         |
| Pre-launch builds only: Cascade, Mahjong, Star Swarm | ✔     | ✔                     | —         |

- [ ] Every item in the table is present, and nothing else unexpected is there.
- [ ] No menu says **"Scoreboard"**. After #2742, the live view is called **Scorecard**.

## 5. Leaderboard screen

- [ ] **Sudoku:** difficulty and variant chips switch the board.
- [ ] **FreeCell:** the metric column says **Moves** and the screen says "Lower is better".
- [ ] **Sort:** the metric column says **Level**.
- [ ] Pull to refresh works. The empty state reads "No one is on this board yet…".
- [ ] **Offline:** it shows "You're offline. The leaderboard loads when you reconnect.", then loads once you reconnect.

## 6. Stats screen (⋯ → Stats)

- [ ] **The game you finished:** Sessions, Completed, Best with its label (e.g. "87 moves" for FreeCell), Time Played and Last Played.
- [ ] **Daily Word** (play one): Wins, Losses, Win Rate and Win Streak are shown.
- [ ] **A score-only game** such as Solitaire: win figures show "—", and there are no streak tiles.
- [ ] "View leaderboard" appears on Stats for games with a board, and not on Daily Word.
- [ ] **Offline, after Stats has loaded once:** it shows "Showing your stats as last loaded…" rather than an error.

## 7. Profile

- [ ] The tiles are Sessions, Completed, Completion Rate, Time Played, Game Types Tried and Favorite Game. There is **no "Top score"** tile.
- [ ] The per-game list shows each game's best in its own terms, and a win rate or "—".
- [ ] Recent games show an icon **and** a label for every result: win, loss, tie, completed, kept playing, abandoned.
- [ ] Tap a recent game. The detail screen shows the same localised result label.

## 8. Leaderboard membership (#2778)

- [ ] Profile shows **"On leaderboards as “‹generated name›”."** and there is no name text field anywhere in the app.
- [ ] **Profile → "Get a new name".** The name changes to another generated name, and the leaderboard shows the new name on your row.
- [ ] **Offline:** "Get a new name" is disabled.
- [ ] **Profile → "Leave leaderboards" → Leave.** Profile then says "You're not on any leaderboard…" and shows **Join leaderboards**.
- [ ] Open a leaderboard. Your row is gone.
- [ ] **Join leaderboards** in Profile. Your row is back on the board under a new generated name.
- [ ] **Offline:** leave. It shows "Leaving the leaderboards… It will sync when you're back online.", and it syncs once you reconnect.
- [ ] **Offline:** join. It shows "Joining… Your leaderboard name will appear when you're back online.", and the generated name appears once you reconnect.
- [ ] **Upgrade from a build with a typed name** (migration 0030): after the update, Profile and the boards show a generated name, not the typed one, and you are still on the boards. A player who never set a name is still **not** on any board.

## 9. Delete my data

- [ ] **Settings → Delete my data.** Then open a game's Stats: none of the old numbers appear, not even briefly.

## Known issues (not blockers for v1.0)

- **Sort levels** differ per player, so players on the same level rank by who got there first, not by moves (#2746).
