# RV06 · Round 1 Audit - Lexical Editor Lazy-Load + Skeleton (C04)

Scope: full audit of DV06 Cycle 4 - the `LexicalEditorLazy` wrapper (dynamic import +
skeleton + props-forward + insertMention-forward), the `export interface LexicalEditorProps`
change, and the 8 import swaps. Method: 5 parallel independent full-audit agents (no
roles), per [[dv04-audit-loop]]. Plan: DV06-Plan.md.

## Round 1 verdicts (5 independent full-audit agents)

- Agent A: UNCONDITIONAL_PASS (MINOR-1: skeleton toolbar ~4px + bg mismatch)
- Agent B: PASS (F1: skeleton didn't forward `class`; F2: `{#key}` remount flicker)
- Agent C: UNCONDITIONAL_PASS (carry-overs only)
- Agent D: UNCONDITIONAL_PASS (carry-overs only)
- Agent E: UNCONDITIONAL_PASS (carry-overs only)

4/5 unconditional. B's two LOW findings (skeleton `class` not forwarded → margin lost
during load; `{#key}` remount flicker) + A's MINOR (toolbar approximation) were real but
non-blocking.

## MAJOR/MINOR - fixed this round (round 1 -> round 2)

- **Skeleton now forwards `class`** (Agent B F1): the caller's margin class (`mb-2`/`mb-3`)
  is applied to the skeleton's outer div so the swap is zero-CLS even where the editor has
  spacing. `class` is destructured out and re-applied to both the skeleton and the loaded
  editor.
- **Module-level cache** (Agent B F2): the resolved editor is cached in a `<script module>`
  variable so a `{#key}` remount (after a reply/comment/PM submit) skips the skeleton
  entirely - no flicker on re-render.
- **Skeleton toolbar matches loaded toolbar** (Agent A MINOR-1): `p-1.5 bg-base-200
border-b` + `h-6` bar matches the `RichTextToolbar`'s `p-1.5 bg-base-200` + `btn-xs`
  (~24px) height.

## Carry-overs (accepted with rationale)

- **`insertMention` silent-drop window** (Agents A, B, D): if quickReply is invoked before
  the chunk loads (microscopic window), the mention vanishes silently. Unreachable in
  practice (chunk loads in onMount; quickReply needs a rendered reply list + click). Could
  queue a pending mention for future hardening.
- **Skeleton not pixel-perfect to toolbar button layout** (journal scope boundary): the
  toolbar row is now dimensionally + background matched but doesn't replicate individual
  button positions. The dominant `min-h-[200px]` content area matches exactly.

## Gate (end of round 1, after fixes)

- `bun run check`: exit 0 (1233 files 0/0 + SW gate).
- `bun run lint`: exit 0.
- `bun run build`: exit 0; lexical in a separate client async chunk (`Bz-TWo0p.js`),
  not inlined in route bundles.

## Next

Round 2: re-audit with the carry-over list; target 5/5 UNCONDITIONAL_PASS.
