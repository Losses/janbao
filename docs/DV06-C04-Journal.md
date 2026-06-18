# DV06 C04 Journal - Lexical Editor Lazy-Load + Skeleton Audit Loop

Method: 5 parallel independent full-audit agents (no roles), loop until 5/5 unconditional
PASS. See [[dv04-audit-loop]]. Plan: DV06-Plan.md.

## Pre-audit dev notes

Goal: split the heavy editor (lexical + svelte-lexical + toolbar) into an async chunk
loaded after first paint, with a dimension-matched skeleton so the swap is zero-CLS.
Scoped to write routes (reading already uses the lex-free `LexicalRenderer`).

Built:

- `src/lib/components/organisms/LexicalEditorLazy.svelte` - drop-in wrapper. Dynamic
  `import('./LexicalEditor.svelte')` on mount; renders a skeleton (bordered container +
  toolbar bar + `min-h-[200px]` content, matching the loaded editor's box model) until
  the chunk resolves, then swaps in. Forwards all props 1:1 (`let { ...props } = $props()`
  → `<Editor {...props} />`). Forwards the `insertMention` instance method via a bound
  inner ref so the discussion page's quickReply (`bind:this` + `editor.insertMention`)
  keeps working.
- `src/lib/components/organisms/LexicalEditor.svelte` - `interface LexicalEditorProps` →
  `export interface` so the wrapper can import the type (type-only export; no runtime
  change).
- 8 import sites swapped from `LexicalEditor.svelte` to `LexicalEditorLazy.svelte`
  (default-export name `LexicalEditor` unchanged, so all `<LexicalEditor .../>` usage is
  untouched): `post/discussion`, `post/editDiscussion`, `messages/new`, `discussion`
  reply composer, `activity` composer, `profile/[userId]/[userSlug]` directed-activity
  composer, `PrivateMessageWindow`, `ActivityComments`.

Verified at build time: lexical + svelte-lexical now live in a single separate client
async chunk (`Bz-TWo0p.js`), no longer inlined into route bundles.

## Scope boundary (carry-overs)

- The skeleton is dimensionally matched (bordered container + toolbar-row height +
  `min-h-[200px]`) for zero CLS, but is not pixel-perfect to the loaded toolbar's button
  layout. Acceptable - the editor loads within ~tens of ms and the overall box is stable.

## Round 1

- 5 agents. Verdict: 4/5 UNCONDITIONAL_PASS (A, C, D, E); B PASS (2 LOW non-blocking).
- B F1: skeleton didn't forward `class` prop → margin lost during load (3 call sites
  with `mb-2`/`mb-3`). Fixed: destructured `class` and applied to both skeleton + editor.
- B F2: `{#key}` remount re-flashed skeleton on every submit. Fixed: module-level cache
  (`<script module>`) skips the skeleton on subsequent mounts.
- A MINOR-1: skeleton toolbar ~4px shorter + missing `bg-base-200`. Fixed: matched
  toolbar dimensions (`p-1.5 bg-base-200` + `h-6`).
- Carry-overs: `insertMention` silent-drop window (unreachable in practice); skeleton not
  pixel-perfect to toolbar button layout (dominant `min-h-[200px]` matches).
- Gate: check 0/0, lint exit 0, build exit 0. See RV06-C04-Audit-01.md.
- Advancing to round 2 targeting 5/5 UNCONDITIONAL_PASS.
