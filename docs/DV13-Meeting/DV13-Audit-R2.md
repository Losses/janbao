# DV13 - Audit Round 2

5 independent role-less auditors examined the revised `docs/DV13-Plan.md` against the codebase at `master`. Result: **3/5 PASS, 2/5 has-special-cases** (auditor 5 and output-2). Not a loop exit. The fix expression `(isSearch || searchScrubbing) ? 0 : 1 - morph` remains unanimously endorsed (correct, organic-clean, SSR-safe, robust to the gesture-path ambiguity); the dissent is again plan-text only.

## Tally

| Auditor | Verdict            | Blocking | Concerns | Organic | Confidence |
| ------- | ------------------ | -------- | -------- | ------- | ---------- |
| 1       | PASS               | 0        | 2        | clean   | high       |
| 2       | PASS               | 0        | 2        | clean   | high       |
| 3       | PASS               | 0        | 3        | clean   | high (fix) / medium (A1 text) |
| 4       | PASS               | 0        | 5        | clean   | high       |
| 5       | has-special-cases  | 2        | 4        | clean   | high       |

## Convergent endorsement (all 5)

- The fix is correct for the defect path, organic-clean, single-target (`grep -n iconProgress src/` = 2 hits: `:192` declaration, `:769` consumer), SSR-safe, and robust to the gesture-path ambiguity (the icon is frozen at the correct hamburger value whether or not the scrub fires on the gesture path).
- Round-1 A2 (intermittency) is correctly revised: Effect C's idle branch does NOT arm a settle for `/` (`title === ''`); the mask is a lingering commit settle. Resolved.
- The parenthesized form `(isSearch || searchScrubbing) ? 0 : 1 - morph` parses identically to the bare form; matches `slideT`'s style.

## Blocking issues (auditor 5, deduplicated)

**B1 - the §6.1 comment to be written into `Header.svelte:192` violates `no-error-history-comments`.** The clause "Without the scrub term the back direction (isSearch already false on the landing page) drives iconProgress 1 -> 0 over the scrub and the hamburger flashes into an arrow" describes the OLD buggy behavior, not current intent. The repo's `PreToolUse` hook enforces this rule at save time and would block the edit. The fix EXPRESSION is fine; only the comment's defect-narrative clause must be rewritten to current intent.

**B2 - §10 "removing the `if (settling) return` mask is a cleanup, not a fix" is false.** `searchScrubbing` (set by `startSearchScrub`, gated by the mask) drives `morph` branch 1b (`:150-153`), which feeds `rootLayerStyle`, `layerDownStyle`, `searchProgress`, `tabProgress`, `trackStyle`, `searchButtonStyle`, `tabBarStyle` - the entire horizontal search-track / scope-tab / search-button motion. The mask still load-bears for those consumers during a settle; removing it would defect them (even though `iconProgress` would stay frozen). The atomic-diff decision to leave it is correct; the stated reason is wrong.

## Notable concerns (non-blocking)

- **C1 - the §3 gesture-path mechanism is statically inconsistent (auditor 3 concern 2, auditor 5 output-2 blocking 1).** The plan says "Effect D ends the settle on nav-done, but in that SAME flush Effect E reads `settling === true` via untrack and returns early." Effect D (declaration order `:359`) runs BEFORE Effect E (`:378`) in the same flush, so if they fired together D would clear `settling` before E reads it. The empirical outcome (min morph on / after landing = 1.000) is correct, but the "same flush" framing is the wrong mechanism.
- **C2 - the destination-agnostic claim could be promoted (auditor 4 concern 1).** `/search` -> `/activity` and `/search` -> `/messages/inbox` are statically proven (identical `currentHasTabs` flip + `title === ''` predicate path through Effect E), but only `/` is e2e-covered. Acceptable as §11 UNVERIFIED-with-static-proof, or add parametrized coverage at implementation.
- **C3 - line-range citations inside the §6.1 comment are brittle (auditor 5 output-1 concern 3).** "slideT's ... style at lines 203-205" pins a range that drifts. Forward-looking rationale is good; drop the literal line range inside the code comment.
- **C4 - past-state markers in `docs/*.md` prose (auditor 5 output-1 concern 1).** "was intended", "no longer matters", "since removed". The no-history-comments hook skips `.md`, so these are not save-blocked, but they read as churn. Optional cleanup.

## Empirical resolution of C1 (this round, re-read of the Round-1 probe data)

The Round-1 `__headerMorphProbe` trajectory for the gesture back-swipe resolves the mechanism. It is INTER-flush, not intra-flush:

```
t=4113  /search  morph=0.57  settling=Y(sp=0.57)  navInFlight=false  pending='/'
t=4137  /search  morph=1.00  settling=Y(sp=1.00)  navInFlight=false  pending='/'
t=4378  /        morph=1.00  settling=Y(sp=1.00)  navInFlight=TRUE   backMorph=null
t=4384  /        morph=1.00  settling=N           navInFlight=FALSE
```

At the route-change flush (t=4378), `currentPath` flips to `/` but `navInFlight` is STILL `true` (SvelteKit's `afterNavigate` has not fired yet). Effect D ends the settle only when `navInFlight` clears (it tracks `navInFlight`/`pendingNav` outside untrack), so at the route-change flush `settling` is still `true`; Effect E re-runs (its tracked deps `currentHasTabs`/`isSearch` changed), reads `settling === true` via untrack at `:399`, and returns early. At the NEXT flush (t=4384) `navInFlight` clears, Effect D runs `endSettle()`, but Effect E does NOT re-run (its tracked deps have not changed again). The scrub never fires; `morph` never dips; `min morph on / after landing = 1.000`. This is a sound mechanism (no intra-flush D-vs-E ordering claim), and it matches the empirical observation.

## Revision decisions

1. **§3 / §8.4 - correct the gesture mechanism to the inter-flush form.** Replace "in that same flush Effect E reads settling" with "at the route-change flush `navInFlight` is still true (afterNavigate has not fired), so Effect D has not ended the settle; `settling` is still true, and Effect E returns early at `:399`. Effect D ends the settle at the next flush when `navInFlight` clears, but Effect E does not re-run (no tracked-dep change)."
2. **§6.1 - rewrite the comment to current intent only** (remove the "without the scrub term ... flashes into an arrow" defect-narrative clause; state what the code does and why). Drop the brittle line-range citation (C3).
3. **§10 - correct the mask rationale** (B2): the mask still load-bears for the search-track / scope-tab / button consumers during a settle; removing it would defect them; it is out of scope for DV13's icon-only fix.
4. **§11/§12 - promote the destination-agnostic claim** to "statically verified" (C2), with parametrized e2e coverage deferred to implementation.

The fix expression is unchanged. Round 3 re-audits the revised plan; the only remaining surface is plan-text accuracy.
