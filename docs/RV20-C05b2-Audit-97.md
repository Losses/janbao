# DV20 Cycle 5b2 - Audit 97 (R97)

**Date:** 2026-07-20. **Round:** R97, the sixth open-scoped round (first with the explicit PASS criterion in the audit prompt). **Counter after this round:** 0/5 (R97 produced concerns; not a PASS round). **Gate:** green, zero flakies.

Two independent open-scoped auditors ran. Auditor A returned 4 findings (all the id-0 truthy-guard class). Auditor B returned 3 (a regression from R93's `isRealUserId` migration, its sibling, and an avatar-route very-low). The orchestrator triaged every finding and applied fixes with binding class-wide sweeps. The full e2e then surfaced one flaky (`fab-release-snap`), which was root-caused to a real orchestrator defect (the settle ease popped under main-thread load) and fixed at the cause, not retried away. Full gate green, zero flakies.

## Findings and fixes

### CONCERN

**C1 (A). id-0 truthy-guard class, four sites.** A truthy guard on a numeric user-id field drops id 0 (the bootstrap super admin) because 0 is falsy. Sites: `src/lib/server/db/dao/notifications.ts` (`r.sourceUserId ? ... : null` -> `r.sourceUserId !== null ? ... : null`; the upstream filter already admitted id 0 into the source map), `src/routes/notifications/+page.svelte` (`{#if item.sourceUserId}` -> `{#if item.sourceUserId !== null}`, two sites, so the admin's notification shows the admin's name/avatar/link instead of "System"), and `src/lib/offline/sync-orchestrator.ts` (`if (r.editedBy)` -> `if (r.editedBy != null)`, mirroring the correct sibling `src/routes/offline/[discussionId]/+page.ts`). Horizontal: the orchestrator's own broad sweep across every user-id field name and every truthy-guard surface (TS `if (x.f)` / `x.f ?` / `x.f ||`, Svelte `{#if x.f}`) confirmed these four are the complete defect set; all other hits are legitimate (`!= null`, `isRealUserId`, equality, map-membership, length, NaN/Finite). Added a preventive test `src/lib/utils/user-id-truthy-guard.test.ts` that scans `src/` for truthy guards on user-id fields and fails on any unallowlisted site (empty allowlist), so this class cannot recur.

**C2 (B). `src/lib/server/messages.ts:40` regression, isRealUserId(0) prefills the super admin.** R93's migration of `id > 0` / truthy gates to `isRealUserId` was correct at most sites but introduced a regression here. `src/routes/messages/new/+page.server.ts` computed `recipientId = Number(searchParams.get('recipient'))`; when the param is absent `Number(null) === 0`, and `isRealUserId(0)` is true (id 0 is the real super admin), so the compose form prefilled the admin on every param-less visit to `/messages/new`. Fix at the boundary: pass `null` (not `Number(null)`) when the param is absent, so `isRealUserId(null)` is false. `/messages/add/[userId]` with an explicit 0 stays a legitimate super-admin target.

### LOW

**L1 (B). `src/routes/messages/[id]/[[page=page]]/+page.server.ts` form filter, Number('') collision.** The participant-add form filter did `Number(val)` then `isRealUserId`; an empty field yields `Number('') === 0`, kept by `isRealUserId`, which would insert the admin as a participant on a crafted submission. Fix: exclude the empty/missing case before `Number()`/`isRealUserId`.

**L2 (B). `src/routes/avatar/[userId]/[file]/+server.ts` raw param vs parsed number.** `pcloudStream` interpolated the raw URL segment (`userIdParam`) while the DB lookup used the parsed `userId = Number(userIdParam)`. Non-canonical numeric forms (`1e2`, `00`, `+1`) parsed to a valid integer, the DB lookup succeeded, but the pCloud path did not exist, so the avatar 404'd for an existing row. Fix: interpolate the parsed number. Horizontal: `attachment/[fileId]`, `category/rss`, and `backup.ts` use the same normalised value for both lookups; no sibling defect.

### Gate-found defect (not from the auditors)

**G1. `fab-release-snap` flaky, root-caused to a real orchestrator defect and fixed at the cause.** The full e2e reported one flaky on `fab-release-snap` (Family A forward), which passed in isolation (40/40 at one worker) and on retry. Investigation (with a 4-worker load stress that reproduced it at ~3%) showed the FAB genuinely popped under main-thread load: the captured trajectory was `...0.39, 0.39, 0.39, 0.05, 0.01, 0.00...`, a one-frame drop. Root cause: the executor's `sampleFrame` in `src/lib/utils/nav-executor-logic.ts` advanced `publication.progress` purely from elapsed wall-clock time (`u = (now - t0) / durationMs`); under main-thread load the first post-commit rAF tick is delayed, so the elapsed-time delta for that tick corresponds to many frames of advance, and progress jumps in one tick. The FAB reads the shared `publication.progress` (via `fabScale`), and the page-track is driven by the same progress, so both pop together. The same architectural defect was present in the orchestrator's settle-ease rAF (Header morph) and tap-scrub rAF (search scrub). Fix: a shared per-tick progress clamp. New helpers `commitEase(u)`, `SETTLE_NOMINAL_FRAME_MS = 16.7`, `SETTLE_PER_TICK_CLAMP_FACTOR = 1.25`, and `settlePerTickCap(durationMs, span)` in `nav-executor-logic.ts` bound the per-tick progress delta to 1.25 times the constant-deceleration curve's steepest normal-frame advance. Applied to the executor's `sampleFrame` (the binding fix), and to the orchestrator's settle-ease and tap-scrub rAFs (defense-in-depth). `sampleFrame` now clamps the per-tick delta and requires both `u >= 1` and `progress === target` for `done` (reschedules a few extra ticks to close the gap when the clamp lags). The 1.25 factor never engages on a 60fps frame (normal timing and easing shape unchanged) while capping a delayed first tick so the FAB scale drop per tick stays under the e2e leap guard's strict 0.2 threshold. Under load the animation now degrades gracefully (slower wall-clock finish, no pop). This was treated as a real defect and fixed at the cause; the earlier thought that it might be "acceptable load degradation" was rejected.

## The id-0 class recurrence

The id-0 class leaked again, in a new syntactic surface: the truthy guard (`x ?`, `{#if x}`, `if (x)`), which R93-R96's sweeps of the comparison surfaces (`> 0`, `!== SYSTEM_USER_ID`) did not cover. R96 fixed the sentinel-filter surface; R97 found the truthy-guard surface. The new `user-id-truthy-guard` preventive test scans every truthy-guard surface across every user-id field name, so the class is now blocked at the test level regardless of which surface a future edit uses.

## Gate (orchestrator-run, 2026-07-20)

```
$ bun run check                       0 errors / 0 warnings (1467 files)
$ bun run lint                        EXIT=0 (similarity informational; no new type duplicates)
$ bun test src/lib                    531 pass / 0 fail (2236 expect)
$ bunx tsc -p scripts/tsconfig.json   EXIT=0
$ bun run test:e2e                    210 passed / 0 flaky (exit 0, 9.1m)
```

The `fab-release-snap` pop is additionally gated by `bunx playwright test e2e/fab-release-snap.spec.ts --workers=4 --repeat-each=10 --retries=0` (30/30 after the fix; was ~3% failures before).

## Counter

0/5 (R97 had concerns; not a PASS round). R98 next.
