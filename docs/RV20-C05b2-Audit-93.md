# RV20-C05b2 - Audit Round 93

Result: **A FAIL (1 concern); B FAIL (5 concerns/lows).** Counter stays **0/5**.
The third OPEN-scoped round. A found a silent draft-loss data bug; B found a
whole defect class (id-0 bootstrap-admin filtered inconsistently across 13 call
sites). Both real, both fixed. The horizontal site-name sweep from R92 surfaced
no new sites this round; instead the i18n English-fallback convention violation
(A had flagged it unscored) was verified real and fixed, and a flaky e2e test
exposed during the gate was root-caused and made deterministic.

## A's finding (FIXED)

**Manual "Save Draft" silently drops the draft and leaks the row (concern,
FIXED).** `src/routes/post/discussion/+page.svelte:87` posted
`contextId: 'new'` (a STRING) to `/api/drafts/save`. The `drafts.context_id`
column has INTEGER affinity, so SQLite stored 'new' as TEXT; the load path
(`+page.server.ts:71`, `eq(drafts.contextId, 0)`) and the clear-on-publish path
(`:181`) query integer 0, so the manual-save row was never loaded and never
cleared (one orphan row per click). The auto-saver (LexicalEditor, contextId 0)
and the activities composer (`api/activities/+server.ts:129`, "contextId = 0
marks the new composer draft") both use integer 0. Fix (two layers,
defense-in-depth): call site changed to `contextId: 0`; and
`src/routes/api/drafts/save/+server.ts` now coerces contextId to a finite
integer at the boundary (`typeof contextId === 'number' && Number.isFinite(...) ?
contextId : 0`) so no caller can reintroduce the silent-data-loss class. The
existing `drafts_uniq_idx` on (authorId, contextType, contextId) makes manual
and auto saves converge to one row.

## B's findings (the id-0 class, all FIXED)

Per `src/lib/utils/user.ts`, id 0 IS a real account (the bootstrap super admin)
and the canonical guard is `isRealUserId(id)` (excludes only the -1 System and
-2 Ghost sentinels). `POST /api/messages` and the sync DAO already use it; 13
sites used `> 0` / `<= 0` / truthy / `!== 0` and wrongly dropped id 0. All
switched to `isRealUserId`:

1. **`addParticipant` silently drops id 0** (`messages/[id]/[[page=page]]/
+page.server.ts:232`, concern): `.filter((id) => !isNaN(id) && id > 0)` ->
   `.filter((id) => isRealUserId(id))`. Adding the bootstrap admin to a
   conversation was rejected (userIdRequired) or silently missing.
2. **Profile "Message" button hidden on the admin** (3 profile pages: `profile/
[userId]/[userSlug]/+page.svelte:96`, `profile/discussions/...:85`,
   `profile/comments/...:84`, concern): `targetUser.id !== 0` ->
   `isRealUserId(targetUser.id)`. The API allows messaging id 0; the UI now
   matches.
3. **`resolveMessageComposePrefill` truthy check drops id 0**
   (`src/lib/server/messages.ts:39`, concern): `if (recipientId && ...)` ->
   `if (isRealUserId(recipientId) && ...)`. `/messages/add/0` now prefills.
4. **Wall post to the admin silently downgraded to an undirected activity**
   (`src/routes/api/activities/+server.ts:88, 117, 133, 146, 203`, concern):
   the POST stored `recipientId: recipientId || null` (null instead of 0), so a
   profile post to the admin landed on the author's own feed, dispatched no
   notification, and the admin could never delete it (the DELETE recipient-auth
   branch saw null). Fixed all five sites to `isRealUserId`. This is the most
   consequential fix in the round (silent data + authorization downgrade).
5. **Offline browse-passthrough drops the admin from the author/editor cache**
   (`src/lib/offline/passthrough.ts:198, 277`, low): `r.editedBy <= 0` and
   `a.id <= 0` -> `!isRealUserId(...)`. The server sync path already used
   `isRealUserId`; the browse path now matches, so an admin-authored thread
   viewed offline no longer renders "Unknown user".

Sibling sweep added a 13th site B had not enumerated:
`src/lib/components/organisms/ActivityRow.svelte:116` `{#if recipientId && ...}`
-> `{#if isRealUserId(recipientId) && ...}` (recipientId is `number | null`; 0 is
a valid recipient and must render the chip). The correct `id === 0` /
`isRealUserId` sites (seed.ts:39, ProfileSidebar.svelte:46, user-preview.ts,
sync.ts, api/messages, sync-orchestrator.ts) were left untouched.

## Convention violation (A flagged unscored; verified real, FIXED)

**i18n English fallbacks (18 sites, FIXED).** The repo convention forbids English
fallbacks on i18n access. 18 sites used `|| 'English string'`; every key was
verified present in BOTH `en.json` and `zh-CN.json`, so the fallbacks were dead
code. Removed across AdminMenuPanel.svelte, SettingsMenuPanel.svelte,
admin/+page.svelte (2), profile/+page.svelte, profile/settings/+page.svelte (2),
and admin/stats/+page.svelte (10: stats title/header, six range options,
dateRange, discussions, replies). Post-fix sweep confirms zero i18n English
fallbacks remain in svelte. (The env-var fallbacks in title.ts and constants.ts
are not i18n and were left.) A's other unscored note, `restore: (value) =>` in
the discussion-thread page's SvelteKit `snapshot`, was verified a FALSE POSITIVE:
`value` is contextually typed by the route `snapshot` declaration (check 0
errors, lint green), not an implicit-any.

## Flaky test exposed by the gate (root-caused, made deterministic)

`e2e/fab-release-snap.spec.ts` "Family A forward: FAB eases out across the
release snap" flaked (failed attempt 1, passed retry 1). Root cause: the
`assertSmoothRelease` BAND-COUNT check ("at least 2 captured rAF samples in the
(0.05, 0.30) band") is fragile to rAF under-sampling. Route navigation blocks
the main thread for a few frames mid-slide, so the per-frame sampler can capture
as few as ONE sample in the band on a CORRECT eased release; the failing
trajectory `0.39, 0.09, 0.04, 0.00` is a smooth ease, not a pop. This is rAF-
sampling fragility (same class as the already-fixed `fab-deep-real-interaction`),
NOT a production defect (the R93 changes do not touch the FAB/animation layer).
Fix: removed the band-count check; kept the LEAP check (the robust core that
catches a real one-frame pop 0.39 -> 0.00); added a TIME-based descent guard
(wall-clock span from last sample > hi to first subsequent sample <= lo,
DESCENT_MS_FLOOR = 18ms; observed descent spans 31.4ms+, a one-frame pop ~16ms;
rAF timestamps advance through main-thread blocks so the span is sample-count-
independent). A one-frame pop fails BOTH guards; a correct ease passes both.
Determinism: 60/60 (--repeat-each=20). The `assertSmoothScaleIn` docstring,
which referenced the removed band-count check, was rewritten to current intent.

## Gate outputs (post-fix, 2026-07-19, orchestrator-run)

```
$ bun run check                       0 errors / 0 warnings (1456 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores src/lib/actions    400 pass / 0 fail
$ bun run test:e2e                    210 passed / 0 flaky (exit 0, 9.1m)
$ fab-release-snap --repeat-each=20    60 passed / 0 flaky (determinism)
```

R94 audits this state (open-scoped prompt).
