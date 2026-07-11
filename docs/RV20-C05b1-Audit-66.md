# RV20-C05b1 - Audit Round 66 (architect-run, 2 independent auditors)

Result: **A PASS-WITH-CONCERNS (2 LOW); B PASS-WITH-CONCERNS (2 LOW).** Zero
MED/HIGH. Counter stays 0/5.

Both auditors verified UNIFY (no bridge), no forbidden patterns, the all-rAF
executor, §9, the geometry, the interrupt handoff, and the `coverProgress`
continuity. Both were run with a clean, role-less, non-leading prompt that
**explicitly forbade reading the Journal and all `RV20-C05b1-Audit-*.md` files**.

## What happened after this round, and why

R66 audited the pre-refactor state. Its `chipExit`-related findings did NOT
proceed to a fix round. Instead the architect directed a refactor (Journal
Session 18, same day) that dissolved the `chipExit` concept entirely and unified
the pilot's FAB on `f(progress, target)`.

The reason: mid-review the architect identified that `chipExit` was an invented
category name for "a tab-click whose target is a tab root other than the
back-target", and that it forced several values to 0/false specifically for that
transition (the worst symptom: the FAB stayed hidden during a cross-tab slide
while it scaled in for a back-swipe:a divergent special-case). Patching the
R66 findings round-by-round would have left the invented category and the
per-transition forcing in place; the architect required the structural fix
instead (dissolve the concept; make the FAB follow the one slide progress
uniformly; leave no analogous invented category / forced value in scope).

So this round's `chipExit`-related findings are **superseded by Session 18**.
The non-`chipExit` findings below carry forward to R67, which audits the
post-refactor state.

## Findings (A 1-2 + B 1-2)

- **A C1 (LOW, carries to R67):`onSvelteKitBeforeNavigate` has no in-flight
  guard:** a second SvelteKit nav arriving during a ~200ms slide (a double-tap
  on another tab, or OS-back) is consumed and re-animated rather than passed
  through. GPL's `beforeNavigate` guards on `navInFlight`/`pendingNav` and lets
  the second nav swap immediately. The pilot's outcome is correct (right
  destination, single dispatch) but the visual differs (a slide plays vs an
  immediate swap) for a non-cross-tab interaction, which the spec holds to
  "indistinguishable from GPL". Narrow race; no e2e covers it. Unchanged by the
  refactor; R67 re-evaluates.
- **A C2 / B C2 (LOW, carries to R67):unreachable defensive code:** the
  skeleton branches (`ActivitySkeleton` / `DiscussionsSkeleton`) and the
  `{:else} getPreviewPanel(leftHref)` fallback are structurally unreachable
  (the eager-load always truthy; the pilot always passes a `left` snippet).
  The skeleton comment documents this honestly; the preview-panel fallback is
  undocumented. Spec-mandated defensive code, not a defect. The refactor renamed
  the gate (`leftPanelPathname`) but the branches remain unreachable.
- **B C1 (LOW, carries to R67):comment inaccuracy:** the `playEnterAnimation`
  comment said "`buildVisual` calls the fns but discards the result"; in fact
  `buildVisual` includes their results and `LiveNavDomDriver.write` discards
  them at write time (the host passes `fab: null, header: null`). Per the
  code-comment-accuracy rule this is a concern. The refactor rewrote
  `playEnterAnimation` (dropped the `chipExit` field) but this comment was not
  touched; R67 re-evaluates.

## Superseded by Session 18

The `chipExit` concept this round's `coverProgress = chipExit || ... ? 0`
forcing rested on no longer exists. The post-refactor state publishes
`coverProgress` = the raw slide fraction unconditionally and resolves the FAB
from the transition target, so the cross-tab FAB scales in with the slide
(locked by the new `messages-back-swipe` e2e). See Session 18 for the full
refactor.

## Gate outputs (real, pre-refactor:the state R66 audited)

```
$ bun run check                       0 errors / 0 warnings
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- ...                  91 passed
```

Consecutive pass votes: **0** (both PWC; the refactor in Session 18 supersedes
the `chipExit` findings; R67 audits the post-refactor state).
