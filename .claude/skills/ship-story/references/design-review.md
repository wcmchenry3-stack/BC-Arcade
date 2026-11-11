# Design review: three proposals, a demo, then the owner's approval

The failure this prevents: a visual or audio change is built, reviewed and
merged before the owner has seen it or heard it, and then gets redone. So,
for any story the owner will see or hear, the owner picks the direction
**before** it is built and approves it working **before** it merges.

## When it applies

Run this gate when the story changes anything a player sees or hears:

- art, icons, colours, layout, typography, visual effects;
- motion and animation, haptics;
- sound effects, music, audio timing;
- physics or "feel" tuning that changes how the game looks in motion;
- any story labelled `owner-approval-required` whose ACs mention proposals,
  or whose epic says the gate applies.

It does not apply to refactors with no visible change, backend-only work,
tests, docs, or copy that follows existing wording. If unsure, run the gate.

## Step 1 — Three proposals, before any implementation (Phase 1)

1. Make **three genuinely different proposals**, not three tints of one idea.
   Each says in one line what makes it different and what it trades off.
2. Show, don't describe:
   - visuals: rendered images at real game size (and a close-up), on a phone
     frame where useful, light and dark if the game has both;
   - motion: a short clip or a frame strip with timings;
   - sound: the audio files themselves (and a clip over gameplay if timing
     matters), with duration and file size;
   - feel/physics: side-by-side clips on the same seed.

   Throwaway mockup code lives in the scratchpad or a `proposals/` folder on a
   scratch branch, never in the story branch.

3. Post them on the **story issue** in one comment headed
   `Proposals for #N`, numbered 1–3, plus your recommendation. Attach the
   files (or link them from a pushed scratch branch / artifact).
4. Add `blocked:owner-decision` to the story, list it under **Needs you**,
   and move on to other stories. Do not start implementing.
5. When the owner picks (or mixes, or asks for another round), record the
   choice on the issue, remove the label, and put the choice in the Phase 1
   plan. Another round means three new proposals informed by the feedback.

## Step 2 — Build it and show it working (Phase 2–3)

1. Implement the chosen proposal on the story branch as normal.
2. Push the branch and record a demo of it **running in the app**:
   - **Playwright (web)**: a recording or screenshot sequence of the real
     flow (use the game's test hooks to reach states such as a win quickly).
     Web is the fastest demo, not proof for iOS/Android.
   - **Maestro**: run the flow on the Android emulator and, when available,
     the iOS simulator; attach screenshots or the recording.
   - **Sound**: a capture with audio, or the files plus a note of which event
     plays which file and when.

   If a tool is unavailable in this environment, say which, attach what you
   could, and list the missing device check under **Manual QA for owner**.

3. Attach the demo to the **draft PR** in a comment headed `Demo for #N`,
   with a short list of what to look or listen for, and link it from the issue.

## Step 3 — Owner approval before merge (Phase 4)

1. Keep the `owner-approval-required` label on the PR. Do not mark it ready
   for merge on review and CI alone.
2. List it under **Needs you** as "PR #X demo approval".
3. Merge only after the owner approves on GitHub or in chat. If they ask for
   changes, make them, post a new demo, and ask again.
4. Device checks (60 fps, haptics, audio on a real phone) that the owner
   wants before merge are named in the PR; otherwise they go under
   **Manual QA for owner** and in an issue, as `escalation.md` describes.
