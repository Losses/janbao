# RV20-C05b2 - Audit Round 19 (post-R18-fix)

Result: **A PASS-WITH-CONCERNS (1 HIGH/CONCERN + 3 LOW); B PASS-WITH-CONCERNS
(5 LOW).** Counter stays **0/5**. R19 confirmed the §5 invariant is met (both
auditors verified: zero CSS transitions, zero setTimeout in the animation layer).
The remaining findings were a FAB edge case + documentation items.

## A findings

- **A F1 (HIGH/CONCERN):** FAB scale flash on /activity backward-to-deep-page
  (resting scale 0 but foregroundFraction gate returns ~1). Fixed: gate checks
  source route's resting fraction; returns 0 for /activity.
- **A F2 (LOW):** unmount() doesn't clear #mountInputs. Fixed.
- **A F3 (LOW):** Deep-snapshot overlay off-screen at activeIndex=0. Known UX
  limitation; suppressSlide handles the visual.
- **A F4 (LOW):** Header $effect.pre side-effect channel. Architecture concern;
  no current defect.

## B findings

- **B C1 (LOW):** Spec Known #6 overclaim for activeIndex=0 backward-to-deep-page.
  Fixed: softened the claim.
- **B C2 (LOW):** /messages/add/[userId] missing from FAB_ROUTE_ATTRIBUTES.
  Fixed: added compose-family entry.
- **B C3 (LOW):** §5 wording "owned by executor's rAF" overstates (live drag is
  synchronous). Fixed: spec wording split into live-drag + commit paths.
- **B C4 (LOW):** "One rAF per motion channel" wording. Same as C3. Fixed.
- **B C5 (LOW):** Header $effect.pre write-loop risk. Undetermined; no current
  defect found.

## Gate outputs (post-fix)

```
$ bun run check                       0 errors / 0 warnings (1462 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    418 pass / 0 fail
$ bun run test:e2e                    197 passed, EXIT=0
```
