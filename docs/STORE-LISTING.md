# Store listing prep — v1.0 (Play #825, App Store #823)

Everything needed to fill in both consoles' **age-rating questionnaires** and **listing text** in one
sitting. Privacy forms (Apple App Privacy, Play Data safety, #2014) are already answered in
[`STORE-PRIVACY-ANSWERS.md`](STORE-PRIVACY-ANSWERS.md) and are not repeated here.

> Draft prepared by an AI assistant on 2026-09-23 from the code and `docs/games/`. Age-rating answers
> and listing claims are the publisher's statements — review before submitting. Rating rules were
> checked against Apple's and IARC's published definitions on that date; **confirm the result in
> each console's rating preview before saving.**

**What the rating covers:** the v1.0 store build, which ships six games — Yacht, Solitaire,
FreeCell, Mahjong, Daily Word, 2048. The six premium games are compiled out of store builds
(`gameVisibility.ts`), so they are not rated now. **When a premium game ships (IAP, #822), redo both
questionnaires** — Blackjack adds simulated gambling (§1), Star Swarm cartoon/fantasy violence, and
Hearts needs a fresh look.

---

## 1. Decided 2026-09-23: Blackjack is premium, Yacht is free

Blackjack is standard casino Blackjack played for chips: bets with a min/max per table, 3:2
payouts, double down and split, and a chip-run progression across three tables. No real money, no
purchasable chips, no prizes. That is **simulated gambling** under both stores' definitions, and
it is the game's core loop — not an incidental reference.

What it does to the rating:

| Store / board               | Simulated gambling →                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Apple**                   | "Infrequent" → **13+**; "Frequent" → **18+**. Frequent/Intense also requires a Rating Classification Number in Korea.   |
| **PEGI** (Europe, via Play) | Any simulated gambling → **PEGI 18** (policy since 2020).                                                               |
| **ESRB** (US, via Play)     | Typically **Teen** for social-casino content.                                                                           |
| **Everything else in v1.0** | Nothing — card, tile, word and number puzzles with no violence, language or mature themes → **4+ / Everyone / PEGI 3**. |

**Which Apple frequency is honest?** Apple rates how prevalent the content is in the app. Blackjack
is one of six games but is gambling for its entire duration, so "Frequent/Intense" is the
conservative answer, and "Infrequent/Mild" is the argument a reviewer could reject. Under-declaring
risks rejection or later removal; over-declaring only costs audience.

**Decision (owner, 2026-09-23):** Blackjack moved to the premium tier —
hidden in store builds until IAP (#822), like the other premium games — and **Yacht** (dice, no
gambling, no betting) moved to free, so v1.0 still ships six games. Implemented in #2531
(visibility + entitlement lists, migration `0020_swap_yacht_blackjack`, Yacht score goals in the daily
challenge, Blackjack's goals parked for #2458). **The v1.0 rating is therefore 4+ / Everyone / PEGI 3,
and every answer below is the no-gambling answer.**

Options that were considered, for when Blackjack returns in a paid update:

1. Declare it Frequent → Apple 18+, PEGI 18, ESRB Teen, Korea needs an RCN. Honest, safest with
   review.
2. Declare it Infrequent → Apple 13+, PEGI 18 anyway. Defensible only if you are comfortable arguing
   prevalence to App Review.

---

## 2. Google Play — IARC content rating questionnaire (#825)

Play Console → Policy → App content → **Content rating** → Start questionnaire.

- **Email:** the developer account email. **Category:** _Game_ (the questionnaire's own
  category — not the store category).

| Question area                                                        | Answer                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------ |
| Violence (any kind, incl. cartoon / fantasy)                         | **No**                                                       |
| Fear / horror                                                        | **No**                                                       |
| Sexuality, nudity                                                    | **No**                                                       |
| Language (profanity, crude humour)                                   | **No**                                                       |
| Controlled substances (drugs, alcohol, tobacco)                      | **No**                                                       |
| **Gambling — simulated gambling (casino games, no real money)**      | **No** (Blackjack is premium, hidden in v1.0)                |
| Gambling — real money, or anything of value can be won               | **No**                                                       |
| Gambling themes / references only                                    | **No**                                                       |
| Users can interact or exchange content (chat, UGC visible to others) | **No** — feedback goes privately to the developer (Sentry)   |
| Shares the user's location with other users                          | **No**                                                       |
| Digital purchases                                                    | **No** (no IAP in v1.0)                                      |
| Unrestricted internet access (web browser, search)                   | **No** — only fixed links (Privacy / Terms) open the browser |
| Loot boxes / random paid items                                       | **No**                                                       |
| Miscellaneous (e.g. user-generated content, personal info sharing)   | **No**                                                       |

Expected result: ESRB Everyone · PEGI 3 · USK 0 (IARC may add a mild descriptor for the Yacht
computer opponent — none expected). Check the preview screen before submitting — IARC assigns all regional ratings at once.

Also in App content (same page, separate cards):

- **Target audience:** 13–15, 16–17, 18+. Do **not** select under-13
  groups — the privacy policy says the app is not directed at children under 13, and selecting
  them pulls in the Families policy.
- **Ads:** "No, my app does not contain ads."
- **Data safety:** answers in `STORE-PRIVACY-ANSWERS.md` (#2014).
- **Government app / financial features / health:** No.

---

## 3. Apple — Age rating questionnaire (#823)

App Store Connect → the app → App Information → **Age Rating** → Edit. (The 2025 questionnaire —
the 4+ / 9+ / 13+ / 16+ / 18+ system.)

| Section                                                                               | Answer                                                                |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **In-app controls** — parental controls                                               | No                                                                    |
| **In-app controls** — age assurance                                                   | No                                                                    |
| **Capabilities** — unrestricted web access                                            | No                                                                    |
| **Capabilities** — user-generated content                                             | No (feedback is private to the developer, never shown to other users) |
| **Capabilities** — messaging / chat                                                   | No                                                                    |
| **Capabilities** — advertising                                                        | No                                                                    |
| **Mature themes** — profanity or crude humour; horror / fear; alcohol, tobacco, drugs | None                                                                  |
| **Medical or wellness** — medical info; health / wellness topics                      | None / No                                                             |
| **Sexuality or nudity** — all items                                                   | None                                                                  |
| **Violence** — cartoon / fantasy; realistic; prolonged graphic; guns / weapons        | None                                                                  |
| **Chance-based** — gambling (real money)                                              | No                                                                    |
| **Chance-based — simulated gambling**                                                 | **None** (Blackjack is premium, hidden in v1.0)                       |
| **Chance-based** — contests                                                           | No                                                                    |
| **Chance-based** — loot boxes                                                         | No                                                                    |

Expected result: **4+**.
Apps in the Games category also show an additional regional rating on the product page.

---

## 4. Listing text

Written to the product principles in [`PRODUCT.md`](PRODUCT.md) (calm, short sessions, no forced
login, no ads) and only claiming what the v1.0 store build does. Name is always **BC Arcade**
(`BRANDING.md`).

### Shared facts (both stores)

- **App name:** BC Arcade
- **Primary category:** Games → **Puzzle** (Apple secondary: **Card**). Play has one category —
  **Puzzle** (Card is the alternative; Casino must not be used).
- **Privacy Policy URL:** `https://buffingchi.com/privacy` (must be live, #828)
- **Support / marketing URL:** `https://buffingchi.com` (needs a contact route — an email address or
  form on the site; the in-app feedback button does not count for Apple)
- **Languages to list:** English first. The UI is translated into 13 locales (ar, de, en, es, fr-CA,
  he, hi, ja, ko, nl, pt, ru, zh); Daily Word itself plays in English and Hindi. Listing text in
  English only for v1.0 is fine — localize the listing post-launch.

### Google Play

**Short description** (80 max — 76 chars):

```
Six calm classics, one daily challenge. No ads, no login, no timers to beat.
```

**Full description** (4,000 max):

```
BC Arcade is a small arcade of classic games built for short moments — open it, play a round, put your phone down. No ads interrupt you, nothing asks you to sign in, and you can leave any game at any time without a penalty.

SIX GAMES
• Solitaire — Klondike with draw-3 and unlimited undo
• FreeCell — every card face-up; nearly every deal can be won
• Mahjong — classic tile-matching solitaire on the Turtle layout
• Daily Word — one word puzzle a day, six guesses, the same word for everyone (English and Hindi)
• 2048 — slide and merge tiles to reach 2048 and beyond
• Yacht — roll five dice, fill 13 scoring boxes, and try to beat the computer

A DAILY CHALLENGE
Every day brings three goals: today's Daily Word plus one goal in each of two other games. Finish two of the three to keep your streak going.

PROGRESS THAT ADDS UP
Every game you finish earns Arcade XP toward your player level. The home screen shows your level and streak; your profile shows your history in each game.

MADE TO BE CALM
• No ads, no pop-ups, no in-app purchases
• No account needed — just open and play
• No countdown timers or energy meters
• Works offline — results sync when you're back online

Your games are saved under a random ID, not your name or email, and you can delete all of your data from Settings at any time.
```

### App Store

**Subtitle** (30 max — 27 chars):

```
Calm classics, a daily goal
```

**Promotional text** (170 max — editable without a new build):

```
Three new goals every day across six classic games. Keep your streak alive — no ads, no login, no timers.
```

**Description:** same as the Play full description above (Apple has no separate short description).

**Keywords** (100 max, comma-separated, no spaces after commas, don't repeat the name or category):

```
solitaire,freecell,mahjong,dice,word,2048,daily,klondike,cards,tiles,offline,streak,classic,casual
```

_(Avoid `casino` and `poker`, even when Blackjack returns: they invite gambling-app scrutiny.)_

**What's New** (v1.0): `First release.`

### App Review notes (Apple — "Notes" field; Mac drafts the final version Sun Oct 4)

Points to cover for Guideline 4.2 (minimum functionality) — expand into prose on Oct 4:

1. BC Arcade is one app with shared progression, not a bundle of unrelated mini-apps: a server-side
   **Arcade XP / player level** earned in every game, and a **daily cross-game challenge** (three
   goals a day, Daily Word plus two other games) with a streak.
2. Walkthrough: open the app → Home shows the level pill and streak → the Daily Challenge card lists
   today's goals → play Daily Word → return to Home and see the goal checked and XP added → Profile
   shows level and per-game history.
3. No login, no demo account needed. No IAP in this version. No tracking (no ATT prompt; see the
   privacy manifest).

---

## 5. Before you save each form

1. The build being rated is the store build (no Blackjack), so every gambling answer is No / None.
2. The privacy-policy URL resolves (#828).
3. Rating previews show the expected result; screenshot them into #825 / #823.
4. Screenshots (Sat Oct 3) come from a **store-configuration** build — the prod-API build from Wed 30
   — so no premium game or Ranks tab appears.

**Sources:** Apple — [Age ratings values and definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/),
[Updated age ratings in App Store Connect](https://developer.apple.com/news/?id=ks775ehf) ·
IARC — [Ratings definitions](https://www.globalratings.com/ratings-definitions/) ·
Google — [Apps & Games content ratings on Google Play](https://support.google.com/googleplay/answer/6209544?hl=en) ·
PEGI simulated-gambling policy — [PEGI (Wikipedia)](https://en.wikipedia.org/wiki/PEGI).
