# RV20-C05b1 - Audit Round 28 (architect-run, 2 independent auditors, with e2e gate)

Result: **0/2 PASS**. Auditor A FAIL (2: a desktop tab-click architecture
violation + a stale docstring); auditor B PASS-WITH-CONCERNS (3 stale
docstrings, all the sub-threshold-release continuity claim). R21-R27
fixes held. The comment drift was self-inflicted by the R27 A-C2 fix
(sub-threshold cancel now lands immediately, bypassing the commit
publication, so the docstrings that claimed continuity for "sub-threshold
release" went stale) - fixed. The desktop tab-click (A-C1) is a SCOPE
question, deferred to the owner.

## Architect gate outputs (post-comment-fix, real)

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0 (no em-dashes; 0 type duplicates)
$ bun test src/lib/utils src/lib/stores    435 pass / 0 fail
$ bun run test:e2e (mobile, last R27 sweep)    79 passed
```

## Concerns + status

- **A-C1 (desktop tab-click, architecture + behavior) - FIXED**: the
  orchestrator was mounted/registered unconditionally, so on desktop a
  tab-click from `/messages/<id>` was consumed (cancel + slide), making
  the track jump to `translateX(-W)` and slide back. Plan §Scope binds
  the gesture state machine to mobile-only. Fix: `NavPipelineHost` now
  mounts + registers the orchestrator only when `isMobile` (and gates
  the forward-enter block + the reset `$effect` on `isMobile`); on
  desktop the singleton stays null, so the layout's `beforeNavigate`
  hook falls through to a plain SvelteKit nav (no slide, no transform
  writes). New desktop e2e (1280px viewport): the track element has no
  inline transform on desktop. (Desktop rendering itself was already
  correct - the mobile track panels only render under `{#if isMobile}`;
  the bug was solely the orchestrator being active on desktop.)
- **A-C2 / B-C1 / B-C2 / B-C3 (comment drift, fixed)**: the
  `#commitStartRaw`, `#onExecutorTick` docstrings, and the sub-threshold-
  cancel "no publication jump" comment claimed continuity / no-jump for
  the sub-threshold release, but the R27 A-C2 fix made a sub-threshold
  cancel land at rest immediately (bypassing the commit publication, so
  `progress` jumps from the live raw to 0 at land). Reworded to scope
  the continuity claim to transitions that actually run a commit/cancel
  rAF, and dropped the false "no publication jump."

## Convergence picture

R21 -> R28 (8 rounds). The §5 interruption family is closed (R25 re-grab,
R26 leftward re-grab, R27 leftward release + sub-threshold cancel). R28
found no new interruption edge - its findings are a desktop scope gap
(A-C1) and self-inflicted comment drift (fixed). The interruption logic
appears to have converged; the remaining R28 item is the desktop
rendering scope question.

Consecutive pass votes: **0** (R1-R28 each carried concerns).
