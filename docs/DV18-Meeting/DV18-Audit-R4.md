# DV18 - Audit Round 4 (reframe: general dispatch)

5 independent role-less auditors examined the Round-3 revision plus a `resolveForwardTarget` reframe (the forward edge resolves its target generically; the existing tab-forward path routes through the resolver too) against local `master` (`84099b5`). Result: **5/5 PASS, zero blocking, but organic 2 clean / 3 has-special-cases**; the reframe did not flip the verdict. Full detail is summarised here; the raw auditor outputs are in the session transcript.

## Tally

| Auditor | Verdict | Organic           | Confidence  |
| ------- | ------- | ----------------- | ----------- |
| 1       | PASS    | clean             | high        |
| 2       | PASS    | has-special-cases | medium-high |
| 3       | PASS    | has-special-cases | high        |
| 4       | PASS    | clean             | high        |
| 5       | PASS    | has-special-cases | high        |

## Finding; the dispatch was general, the bodies were feature-specific

The reframe genuinely generalised the DISPATCH: `resolveForwardTarget` returns `{kind:'tab'}`, `{kind:'deep'}`, or `null`, and the existing Discussions→Activity and Activity→Messages forward swipes route through it, so the deep target is a peer outcome rather than a last-tab special case. Three auditors confirmed this.

But the deep-branch BODIES still lived in `MobileTabPager.svelte`: `forwardEdgeReveal` state, the re-entry guard, and the overlay markup exist only for the deep case and only Messages exercises them. DV09 reached all-clean because its FAB logic lived in FAB-named files, leaving shared primitives with general hooks; DV18 had not yet isolated the deep-edge bodies. The literal "no feature-named tokens in shared primitives" gate was satisfied (no `search`/`peek` string token in `MobileTabPager.svelte`), but the "general mechanism, not feature branch" bar was not, in 3/5 judgments.

## Non-blocking concerns (carried to R5)

- The overlay affordance was a magnifier (search-branded); should be a generic forward arrow.
- `forwardGotoInFlight` did not clear on `goto` rejection.
- Minor citation drift (`Header.svelte:987-988` → actual `:985-986`; `FloatingActionButtonLayer.svelte:425` → `:433`).

## Revision decision

Extract the deep-edge bodies into feature-named files (`forward-edge.ts`, `stores/forward-edge.svelte.ts`, `ForwardEdgeOverlay.svelte`), leaving `MobileTabPager.svelte` a general dispatch hook; the DV09 `active-gesture-track` isolation pattern. See Round 5.
