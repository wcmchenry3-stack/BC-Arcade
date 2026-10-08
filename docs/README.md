# BC Arcade Documentation

This directory contains BC Arcade's product, architecture, gameplay, operations, release, research, and audit documentation.

The purpose of this index is to make one thing clear: **which document is the source of truth for which question**. A file can remain useful as history without being the current contract.

## Status vocabulary

- **Canonical** — evergreen source of truth for the subject. Update it when behavior changes.
- **Operational** — current procedure/runbook for building, testing, deploying, or verifying the product.
- **Release-specific** — tied to a particular release, submission, or dated rollout. Useful for execution/history, but not the evergreen product contract.
- **Research / design record** — investigation, spike, oracle, or design history. Preserve the evidence and decisions; do not treat old proposed behavior as current behavior.
- **Audit / snapshot** — findings at a point in time. Useful evidence, not an evergreen contract.
- **Public / legal artifact** — externally published or submission-facing material. Its path may be operationally significant.

## Where do I look?

| Question | Source of truth |
| --- | --- |
| What is BC Arcade trying to be? | [PRODUCT.md](PRODUCT.md) |
| How is the system divided between client and server? | [ARCHITECTURE.md](ARCHITECTURE.md) |
| How does every game open, sync, complete, and abandon? | [GAME-CONTRACT.md](GAME-CONTRACT.md) |
| How do leaderboards, Stats, Scorecards, and Profile work? | [LEADERBOARDS.md](LEADERBOARDS.md) |
| How does Arcade XP / player level work? | [PROGRESSION.md](PROGRESSION.md) |
| How does Daily Challenge work? | [DAILY-CHALLENGE.md](DAILY-CHALLENGE.md) |
| How do player feedback and Sentry diagnostics work? | [FEEDBACK-OBSERVABILITY.md](FEEDBACK-OBSERVABILITY.md) |
| How does localization/i18n work? | [I18N.md](I18N.md) |
| What are the shared gameplay/input/rendering standards? | [GAMEPLAY_STANDARDS.md](GAMEPLAY_STANDARDS.md) |
| How does a particular game play? | [Game specifications](games/) |
| How do accessibility requirements work? | [ACCESSIBILITY.md](ACCESSIBILITY.md) |
| How do I run or write tests? | [TESTING.md](TESTING.md) |
| How do I deploy the backend/web app? | [RENDER.md](RENDER.md) |
| How are iOS builds produced? | [IOS.md](IOS.md) |
| How are Android builds produced? | [ANDROID-CI.md](ANDROID-CI.md) |
| What are the performance and size budgets? | [PERFORMANCE.md](PERFORMANCE.md) |
| How are assets organized? | [ASSETS.md](ASSETS.md) |
| How do I manually verify leaderboards? | [MANUAL-QA-LEADERBOARDS.md](MANUAL-QA-LEADERBOARDS.md) |
| What is the current release plan? | [RELEASE-PLAN-2026-10.md](RELEASE-PLAN-2026-10.md) |
| What should I use for old leaderboard design rationale? | [animation-lab.html](research/animation-lab.html) | Dev-only animation/sound preview page (serve from the repo root; see its header) |
| [asset-preview.html](research/asset-preview.html) | Dev-only Cascade asset inspector and physics sandbox (serve from the repo root; see its header) |
| [../tools/README.md](../tools/README.md) | Dev tooling index: simulators, generators, asset pipeline, and the Sort palette check |
| [LEADERBOARDS-SCORING-PLAN.md](research/LEADERBOARDS-SCORING-PLAN.md) — historical/design record, not the current contract |

The shared-system canonical documents created under #2799 are now part of the source-of-truth set below.

## Canonical product and system documentation

| Document | Purpose | Notes |
| --- | --- | --- |
| [PRODUCT.md](PRODUCT.md) | Product principles, roster, monetization/identity intent | Canonical product intent, but roster/status/tier statements must be truth-synced when release decisions change. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | High-level client/server architecture, persistence, entitlements, environments, shared systems | Canonical architecture overview. Deep subsystem material may later become summaries linking to dedicated canonical docs. |
| [GAME-CONTRACT.md](GAME-CONTRACT.md) | Normative backend/frontend contract for game sessions, outcomes, modules, sync, results, ranking, Stats/Profile integration | **Normative source of truth for game integration.** Avoid duplicating these rules elsewhere. |
| [GAMEPLAY_STANDARDS.md](GAMEPLAY_STANDARDS.md) | Shared game logic/layout/input/animation/rendering standards | Canonical standards document. |
| [LEADERBOARDS.md](LEADERBOARDS.md) | Leaderboards, ranking, Stats, Scorecards, Profile, identity/partition behavior | Canonical reporting/ranking overview; GAME-CONTRACT remains normative for integration details. |
| [PROGRESSION.md](PROGRESSION.md) | Arcade XP and player levels | Canonical progression rules derived from session history. |
| [DAILY-CHALLENGE.md](DAILY-CHALLENGE.md) | Daily Challenge scheduling, evaluation, slates, streaks, timezone model | Canonical Daily Challenge contract. |
| [FEEDBACK-OBSERVABILITY.md](FEEDBACK-OBSERVABILITY.md) | Player-submitted feedback and automatic diagnostics/Sentry | Canonical feedback/observability behavior. |
| [I18N.md](I18N.md) | Supported locales, fallback, formatting, contributor workflow | Canonical localization contract. |
| [ACCESSIBILITY.md](ACCESSIBILITY.md) | Accessibility requirements and testing expectations | Canonical accessibility guidance. |
| [ASSETS.md](ASSETS.md) | Asset organization and delivery guidance | Canonical asset guidance; audio expansion is tracked in #1787. |
| [BRANDING.md](BRANDING.md) | Brand/visual identity guidance | Canonical brand reference. |

## Game specifications

The canonical home for per-game rules, scoring, AI, progression, special mechanics, and per-game deviations from shared contracts is `docs/games/`.

- [Blackjack](games/blackjack.md)
- [Cascade](games/cascade.md)
- [Daily Word](games/daily_word.md)
- [FreeCell](games/freecell.md)
- [Hearts](games/hearts.md)
- [Mahjong](games/mahjong.md)
- [Solitaire](games/solitaire.md)
- [Bottle Sort](games/sort.md)
- [Star Swarm](games/starswarm.md)
- [Sudoku](games/sudoku.md)
- [2048](games/twenty48.md)
- [Yacht](games/yacht.md)

Shared session, offline, leaderboard, Stats, and result-card behavior should be linked from the shared canonical documents rather than re-explained in full in every game file. Per-game docs should keep only their specific rules and exceptions.

## Operational documentation

These are current runbooks/procedures, not product-design sources of truth.

| Document | Purpose |
| --- | --- |
| [TESTING.md](TESTING.md) | Automated/manual testing strategy, commands, game-specific simulation guidance |
| [RENDER.md](RENDER.md) | Render environments, deployment, environment variables, production DB/health checks |
| [IOS.md](IOS.md) | Xcode Cloud/iOS build and release workflow |
| [ANDROID-CI.md](ANDROID-CI.md) | Android/Gradle/Play build and CI workflow |
| [PERFORMANCE.md](PERFORMANCE.md) | SLOs, Locust/Lighthouse, bundle/asset/per-game size budgets |
| [MAESTRO.md](MAESTRO.md) | Maestro E2E conventions and usage |
| [MANUAL-QA-LEADERBOARDS.md](MANUAL-QA-LEADERBOARDS.md) | Manual verification procedure for leaderboard/Stats/Profile behavior |
| [MAHJONG_LAYOUT_GUIDE.md](MAHJONG_LAYOUT_GUIDE.md) | Supporting technical guide for Mahjong layout work |

## Release, store, and legal material

These files can contain current release facts, but they are not the evergreen architecture/gameplay contract.

| Document | Status / purpose |
| --- | --- |
| [RELEASE-PLAN-2026-10.md](RELEASE-PLAN-2026-10.md) | **Release-specific.** Execution log/plan for the October 2026 release. Historical rows should remain historical. |
| [STORE-LISTING.md](STORE-LISTING.md) | **Release/store-specific.** Store copy, ratings and submission preparation. |
| [STORE-PRIVACY-ANSWERS.md](STORE-PRIVACY-ANSWERS.md) | **Release/store-specific.** App Store / Play privacy declarations. |
| [LEGAL-REVIEW-NOTES.md](LEGAL-REVIEW-NOTES.md) | **Release/legal working notes.** Not the public policy itself. |
| [LEGAL-PUBLISHING.md](LEGAL-PUBLISHING.md) | **Release/legal.** Final legal/support URLs, the file behind each, hosting status, owner-approval checklist and approved versions (#2780). |
| [privacy-policy.html](privacy-policy.html) | **Public/legal artifact.** Do not move without checking the publishing path. |
| [terms-of-service.html](terms-of-service.html) | **Public/legal artifact.** Do not move without checking the publishing path. |
| [support.html](support.html) | **Public/legal artifact.** Backs `https://buffingchi.com/support`. Do not move without checking the publishing path. |

## Research and design records

Preserve these because they contain evidence and rationale, but use the canonical docs/code for current behavior.

| Document | Purpose |
| --- | --- |
| [HEARTS_PIMC_SPIKE.md](research/HEARTS_PIMC_SPIKE.md) | Hearts AI PIMC research and follow-up evidence |
| [YACHT_ORACLE.md](research/YACHT_ORACLE.md) | Yacht optimal-play oracle design/reference |
| [CASCADE_ASSET_SPIKE.md](research/CASCADE_ASSET_SPIKE.md) | Cascade asset investigation |
| [CASCADE_PHYSICS.md](research/CASCADE_PHYSICS.md) | Cascade physics design/reference |
| [CASCADE-THEMING.md](research/CASCADE-THEMING.md) | Cascade theming design/reference |
| [LEADERBOARDS-SCORING-PLAN.md](research/LEADERBOARDS-SCORING-PLAN.md) | Historical leaderboard/scoring implementation plan. Current behavior lives in LEADERBOARDS.md + GAME-CONTRACT.md. |

## Audits and point-in-time snapshots

These record findings from a specific review/date. They should not silently become evergreen instructions.

| Document | Purpose |
| --- | --- |
| [ATT-AUDIT.md](audits/ATT-AUDIT.md) | App Tracking Transparency audit |
| [LAUNCH-TRIAGE-2026-09-26.html](audits/LAUNCH-TRIAGE-2026-09-26.html) | Dated launch-triage snapshot |
| [solitaire-qa-report.md](audits/solitaire-qa-report.md) | Solitaire QA snapshot |
| [sudoku-qa-report.md](audits/sudoku-qa-report.md) | Sudoku QA snapshot |

## Documentation ownership rules

When behavior changes:

1. Update the **one canonical document** that owns the rule.
2. In other evergreen docs, use a concise summary and link instead of copying the same normative explanation.
3. Preserve research, release logs, audits, and decision history, but label them so readers do not mistake them for current behavior.
4. When creating a new canonical document, search the repo for overlapping material first, merge the still-valid content, and replace duplicate current-state prose with links.
5. If a code comment/test is the only place a product rule is explained, move the durable rule into the appropriate canonical doc and keep the source comment implementation-focused.
6. Update documentation in the same PR as behavior changes when practical.

## Organization

The first low-risk reorganization under #2799 is complete in this branch:

- evergreen/canonical and operational docs remain at the top of `docs/` for low-friction access;
- per-game specs remain under `docs/games/`;
- research/design records live under `docs/research/`;
- point-in-time audits and QA snapshots live under `docs/audits/`;
- release/store/legal files stay at their current paths because they are active operational artifacts and some public/legal paths may be externally significant.

We deliberately did **not** create deep `product/`, `architecture/`, `operations/`, and `release/` nesting. The index provides the category map without forcing high-churn moves for heavily referenced canonical/operational files.
