# RV10-C01 - Audit Round 2

5 independent role-less auditors examined the post-effectiveKind implementation. Result: **5/5 ACCEPTABLE**. The R1 root cause (three unsynchronized signals driving kind and scale) is confirmed eliminated. One non-blocking finding (F1, stale sampledFractionalIndex on re-arm) is fixed inline.

## Tally

| Auditor | Verdict | Blocking | Major | Minor | Organic |
|---------|---------|----------|-------|-------|---------|
| 1 | ACCEPTABLE | 0 | 0 | 1 | clean |
| 2 | ACCEPTABLE | 0 | 0 | 3 | clean |
| 3 | ACCEPTABLE | 0 | 1 (F1) | 2 | clean (with polish recommendation) |
| 4 | ACCEPTABLE | 0 | 0 | 1 | clean |
| 5 | ACCEPTABLE | 0 | 1 (F1) | 2 | clean |

Result line: **5/5 ACCEPTABLE.**

## R1 root cause - confirmed eliminated (5/5)

All five independently verified:
- `effectiveKind` (FloatingActionButtonLayer.svelte:195-203) is the single source of truth for list-family kind during any transition.
- Kind and scale both derive from `sampledFractionalIndex` (the visual track position).
- The kind swap happens at sample=1 (the midpoint), where `scaleFromFraction(2f-1)` guarantees scale 0 for both kinds.
- The URL-swap frame cannot leak the incoming kind because `effectiveKind` ignores `fabConfig.kind` while the sampler is active.
- Overlay/compose families are correctly isolated (static kind from URL, separate scale signal).

## F1 - stale sampledFractionalIndex on re-arm (auditors 3, 5; non-blocking, fixed inline)

After a cross-family roundtrip (list→overlay→list), the sampler re-arms but `sampledFractionalIndex` holds the previous family's stale value for one frame (before the first rAF tick writes a fresh sample). `effectiveKind` reads this stale value and renders the wrong kind at scale 1 for one frame.

**Fix applied:** `stopSampler` resets `sampledFractionalIndex = null`, so `effectiveKind` falls back to the URL-derived resting kind until the first fresh sample arrives.

## Other findings (non-blocking, noted)

- **coverProgress commit jump (F3, auditors 2, 3, 4):** GesturePageLayout still publishes `coverProgress: 1` at commit (logical endpoint) rather than tracking the visual slide. Mitigated by the atom's CSS transition (`transitionEnabled` via `pendingNav`). The ideal (visual coverProgress through the commit slide) is future debt, not a current defect. e2e Case H passes.
- **Activity tab wrong kind at scale 0 (auditors 2, 5):** On /activity (sample=1), `effectiveKind` returns 'messages' (>=1 boundary). The atom is invisible (scale 0). Cosmetic only.
- **discreteNavInFlight retained (auditor 3):** R1's literal "delete" target is retained for Family C (compose) and overlay↔list swaps, which have no sampler-driven track. Justified isolation, not a desync.
- **retainedConfig dead-carry for list family (auditor 4):** `displayConfig` overrides the list kind via `effectiveKind` before reading `retainedConfig.kind`, so the retained kind is dead for list routes. The field is still needed for overlay/compose persistence (atom-on-no-FAB-tab). Stylistic, not a defect.
