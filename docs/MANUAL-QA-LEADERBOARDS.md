# Manual QA: results, leaderboards, stats and Profile

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

- [ ] The result card asks **"Pick a display name for leaderboards"** once. Save a name.
- [ ] The card's line becomes **"Saved as ‹name› · #N on the leaderboard"**, or "Saved as ‹name› · Your best: #N" when this wasn't your best game.
- [ ] **"View leaderboard"** opens that game's leaderboard with **your row highlighted** in the list, or pinned below it when you're outside the top 50.
- [ ] Going back returns to the result card. The card doesn't announce itself again, and nothing covers the leaderboard screen.
- [ ] Play the same game again. The name prompt does **not** appear a second time.

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

## 8. Remove my name

- [ ] **Profile → "Remove my name from leaderboards" → Remove.** Profile then says "You're not on any leaderboard…".
- [ ] Open a leaderboard. Your row is gone.
- [ ] Save a name again in Profile. Your row is back on the board.
- [ ] **Offline:** remove your name. It shows "Removing your name… It will sync when you're back online.", and it syncs once you reconnect.

## 9. Delete my data

- [ ] **Settings → Delete my data.** Then open a game's Stats: none of the old numbers appear, not even briefly.

## Known issues (not blockers for v1.0)

- **Game timers:** Solitaire, 2048, Cascade and Mahjong count time while the app is in the background, and Solitaire, 2048 and Mahjong mis-time a game resumed after an app kill (#2750). Time spent on Stats, Leaderboard or Scorecard is no longer counted (#2743).
- **Sort levels** differ per player, so the moves tie-break compares different puzzles (#2746).
