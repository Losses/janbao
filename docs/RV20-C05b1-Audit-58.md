# RV20-C05b1 - Audit Round 58 (architect-run, 2 independent auditors)

Result: **A PASS-WITH-CONCERNS (3 low); B PASS-WITH-CONCERNS (5 low).**
Zero MED/HIGH. Both confirmed the R57 MED (cancel-dispatch) correctly
fixed.

## Concerns + fixes

- **skeleton comment inaccurate (A C1 / B C1, low):** the comment said
  "renders when the eager load rejected" but Promise.allSettled returns
  truthy EMPTY*\* objects (never null), so the skeleton is unreachable.
  FIX: rewrote to "spec-mandated fallback; currently unreachable because
  the root layout returns truthy EMPTY*\* on rejection."
- **isGesturePageLayoutRoute docstring stale (A C2, low):** said "mounts
  a GesturePageLayout" but the pilot now mounts NavPipelineHost. FIX:
  rewrote to "mounts a gesture-owning layout (GesturePageLayout or, since
  5b1, NavPipelineHost)."

## Documented / low

- hardcoded chip-exit targets (A C3 / B C3): documented 5b2 scope.
- pointerDisabled $derived wrapper (B C3): stylistic, functionally correct.
- chip-exit FAB stays at scale 0 (B C4): part of accepted divergence.
- recoverDesktopFlipNav dispatch-then-unmount race (B C5): extremely
  unlikely edge.
- SSR transform always translateX(-50%) (B C2): unreachable in practice.
- skeleton branches unreachable (A C1 / B C1): spec-mandated fallback;
  the root layout's EMPTY\__ objects make page.data._ always truthy.

## NOTE on audit independence

R58 auditor B referenced "The R57 MED" (a round number from the audit
history) despite the prompt not mentioning the Journal. The auditor
read the docs/ files on its own initiative (general-purpose agent with
full file access). This compromises independence. R59's prompt adds a
scope restriction: "Read ONLY the files listed below."

## Gate outputs (real, post-fix)

```
$ bun run check          0 errors / 0 warnings (1461 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- 8-spec pilot sweep    81 passed
```

Consecutive pass votes: **0** (R58 both PWC with low; fixable ones fixed;
R59 audits with a scope-restricted prompt).
