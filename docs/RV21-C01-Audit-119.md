# RV21-C01 Audit 119 (R119)

**Date:** 2026-08-04. **Round:** R119. **Votes:** auditor A BLOCK,
auditor B PASS (invalid -- under-thorough). **Counter after: 0/5.**

## Outcome

A BLOCKed on a genuinely new lexical sub-class of the long-running
"drag-terminal / drag's-terminal overclaim" defect: the **hyphenated
form `drag-terminal`**, which the apostrophe-form (`drag's terminal`)
and `gesture-terminal` greps used in R100-R118 never matched. A found 3
sites (2759, 2789, 4354).

B voted PASS, but B's PASS is **invalid**. B's sweep grepped `drag's
terminal` / `gesture-terminal` (36 hits, all read as qualified) -- the
SAME two patterns that missed the hyphenated form in every prior round.
B's 36 hits do not include the hyphenated sites, and B additionally
mis-classified two apostrophe-form hits in the discrete-nav arm (2934, 3020) as qualified when they are not. The orchestrator's independent
verification superseded B's PASS.

## Orchestrator independent verification

The orchestrator re-ran a broad `terminal` grep over the orchestrator
file, read EVERY hit in context, and classified each by the criterion
R117 established: for the `onSvelteKitBeforeNavigate` discrete-nav /
takeover path, the captured value is the value at the **settle-arm
(interrupt) instant**, NOT the drag's natural terminal -- because the
discrete-nav arm fires for BOTH a live drag interrupted mid-flight
(the drag is cut short, never reaching terminal) AND a from-rest
tab-click (no drag at all; the capture collapses to the at-rest morph
or to `null`).

The class is NOT exhausted (contrary to R118's claim). 9 sites fixed,
all in the discrete-nav / takeover path:

- **`orchestrator:2700`** -- "the drag's terminal morph is computed by
  `#dragMorphAtSettleTakeover`". This re-introduces the exact overclaim
  R117 removed from that helper's own docstring (R117 retitled it "The
  morph value at the settle-arm instant"). A call-site comment
  re-stating the helper's output as "terminal" is inconsistent with the
  R117 fix. Fixed: "the morph at the settle-arm instant is computed by
  `#dragMorphAtSettleTakeover`."
- **`orchestrator:2759`** (A F1) -- "the FAB tier needs the same
  drag-terminal capture the morph tier made above as `liveDragMorph`."
  The morph capture serves from-rest (at-rest morph). Fixed: "same
  settle-arm-instant capture."
- **`orchestrator:2789`** (A F2) -- "the search axis needs the same
  drag-terminal capture the morph and FAB tiers made above." Same
  from-rest overclaim. Fixed: "same settle-arm-instant capture."
- **`orchestrator:2934`** (B mis-classified) -- shape (F,F,T) "morph
  eases from the drag's terminal (~0.37)." ~0.37 is the morph at the
  interrupt (raw ~= 0.37); the drag's actual terminal for a deep->tab
  drag is morph = 1. Fixed: "the drag's value at the interrupt (~0.37)."
- **`orchestrator:3020`** (B mis-classified) -- "keeps the first settle
  frame's `settleProgress` equal to the drag's terminal `pager.backMorph`."
  The next sentence documents the from-rest collapse to `startProgress
= 0` (no live drag), directly contradicting "terminal." Fixed: "equal
  to the live `pager.backMorph` at the interrupt."
- **`orchestrator:3055`** (A under-counted -- A marked it scoped) --
  discrete-nav FAB re-seed: "lerps from the captured drag-terminal
  value." The captured value is the interrupt-instant value; leaving
  it as "drag-terminal" is internally inconsistent with the 2759 fix
  (same `liveDragFabScale` capture). Fixed: "captured settle-arm-instant
  value."
- **`orchestrator:3066`** (A under-counted) -- discrete-nav search
  re-seed: "lerps from the captured drag-terminal value." Same as 3055
  for the search axis. Fixed: "captured settle-arm-instant value."
- **`orchestrator:3654`** -- R117's own `#dragMorphAtAnchorOrRaw`
  docstring rewrite missed this sentence: "the drag's actual terminal
  value is the anchor-shifted natural(raw)." R117 fixed the title
  (3650) and two body sentences (3657) but not this third one.
  Fixed: "the morph value at the settle-arm instant is the
  anchor-shifted natural(raw)."
- **`orchestrator:4354`** (A F3) -- `#fabScaleAtSettleInstant` docstring
  bullet: the discrete-nav arm "captures the drag-terminal FAB value."
  For from-rest the helper returns `null` (no capture). Fixed: "captures
  the FAB value at the interrupt."

## Why A and B both missed sites

- **A** found the hyphenated sub-class (3 sites) but its sibling sweep
  marked 3055 / 3066 as "properly scoped (inside the `captured !==
null` re-seed guards)." That reasoning is unsound: the guard fires
  whenever the publication was in-flight, which includes a live-drag
  interrupt (value is the interrupt instant, not terminal) and an
  in-flight settle interrupt (no drag at all). The orchestrator
  rejected A's scoping and fixed them.
- **B** grepped only `drag's terminal` / `gesture-terminal`, so the
  hyphenated sites were invisible to it, and it read 2934 / 3020's
  shape/path context as "qualifying" the word "terminal" (it does
  not -- the shape qualifies the path, not the value's nature).

## Verified properly-scoped (8 remaining `terminal` hits, NOT defects)

All remaining `drag-terminal` / `drag's terminal` hits are in the
**gesture-release path** (`#armSettleEaseFromGesture` and the
`#dragMorphAnchor` field docstring "at release"), where a live drag
genuinely reaches its terminal at release: 735, 2783, 3290, 3522, 3532,
3573, 4348, 4350. The constant-0 `isDeepToDeep` edge (3596: "the
terminal morph is 0") is also accurate -- for a constant morph the
terminal equals the instant value, so no overclaim.

## Verify

`bun run check` 0/0; `prettier --check` clean; no U+2014 em-dash;
`bun test src/lib/stores src/lib/utils` 398 pass / 0 fail. Comment-only;
runtime unchanged.

## Disposition

Counter after R119: 0/5. The "drag-terminal / drag's-terminal overclaim
in the discrete-nav / takeover path" class is now genuinely exhausted
(9 sites fixed this round; 8 remaining hits verified gesture-release or
constant-edge). The recurring failure mode across R100-R119 is
auditor/sweep grep patterns that match some lexical forms and not
others -- the hyphenated `drag-terminal` form survived five rounds of
apostrophe-form sweeps. Future rounds must grep the CONCEPT broadly
(any `terminal` token near a drag/settle/takeover capture) and read
every hit, not grep three literal phrasings.

**No git mutation.** No commits, no branches, no pushes.
