# DV01-C05-Journal: Cycle 5 Development Journal

## Cycle: Lexical Hyperlinks, Spoilers & Marker Highlights (QA #10, #11)

**Date:** 2026-06-12
**Target Issues:** QA-10 (Hyperlink Auto-linking), QA-11 (Spoiler Inline Text Style)

---

## 1. Implementation Summary

### 1.1 AutoLink Plugin Integration

**File:** `src/lib/components/organisms/LexicalEditor.svelte`

- Imported `AutoLinkPlugin` from `svelte-lexical` and added it inside the `<Composer>` alongside existing plugins.
- `AutoLinkNode` was already registered in the editor's `nodes` array (from a prior cycle), so no additional node registration was needed.
- The plugin works out-of-the-box, automatically detecting typed URLs (starting with `http://` or `https://`) and converting them into clickable `autolink` nodes.
- The `LexicalRenderer` already handled `node.type === 'autolink'` rendering (added in Cycle 4), so no renderer changes were needed for auto-linking.

### 1.2 InsertLink Toolbar Button Fix

**File:** `src/lib/components/molecules/RichTextToolbar.svelte`

**Problem:** The previous `handleToggleLink` function dispatched `TOGGLE_LINK_COMMAND` with a hardcoded `sanitizeUrl('https://')` placeholder URL. This immediately created a link node with URL `https://` on the selected text, then relied on the floating `RichTextLinkEditor` to detect the placeholder and enter edit mode. This was fragile and created temporary invalid links.

**Solution:** Replaced with a proper modal-based approach:

- Clicking "Insert Link" now opens a modal dialog with a URL input field.
- The user enters the full URL and clicks "Confirm" (or presses Enter).
- Only then is `TOGGLE_LINK_COMMAND` dispatched with the sanitized user-provided URL.
- If the selection is already a link (button shows active state), clicking it removes the link via `TOGGLE_LINK_COMMAND` with `null`.
- The existing floating `RichTextLinkEditor` component continues to function for editing existing links inline.

### 1.3 Marker Highlight Formatting

**Files:**

- `src/lib/components/organisms/LexicalEditor.svelte` (theme config)
- `src/lib/components/molecules/RichTextToolbar.svelte` (toolbar button)
- `src/lib/components/molecules/LexicalRenderer.svelte` (rendering)

**Implementation:**

- Added `highlight` key to the editor theme's `text` configuration: `highlight: 'bg-yellow-200/60 dark:bg-yellow-400/30 rounded px-0.5'`. This maps Lexical's built-in IS_HIGHLIGHT format bit (128) to the appropriate CSS class.
- Added a "Marker Highlight" toolbar button using `mdiMarker` icon that dispatches `FORMAT_TEXT_COMMAND` with `'highlight'`.
- State tracking: Since `svelte-lexical`'s `StateStoreRichTextUpdator` does not provide an `isHighlight` context store, a custom `onMount` listener was registered that checks `selection.hasFormat('highlight')` on each editor update to track the active/inactive button state.
- Renderer: Added bit 128 (`f & 128`) handling in the `formatTextClasses` helper function, applying the same yellow highlight CSS class.

### 1.4 Spoiler Text Formatting

**Files:**

- `src/lib/types/editor-commands.ts` (new: shared command constant)
- `src/lib/components/organisms/LexicalEditor.svelte` (command registration + theme)
- `src/lib/components/molecules/RichTextToolbar.svelte` (toolbar button)
- `src/lib/components/molecules/LexicalRenderer.svelte` (rendering)
- `src/app.css` (global spoiler CSS)

**Implementation approach:**

- Since Lexical's built-in `TextFormatType` does not include a `'spoiler'` format, a custom command approach was used.
- Created `TOGGLE_SPOILER_COMMAND` as a shared `LexicalCommand<void>` in `$lib/types/editor-commands.ts` (separate `.ts` file needed because Svelte components cannot export named constants for import by other components).
- Registered a command handler on the editor instance via `$effect` that:
  - Gets the current selection
  - Iterates over selected text nodes
  - Toggles a sentinel style marker `janbao-spoiler;` in the node's `style` property
  - The sentinel is not a valid CSS property (browsers ignore it), but it serves as a reliable detection marker in the Lexical JSON output
- Added a "Spoiler" toolbar button using `mdiEyeOff` icon that dispatches `TOGGLE_SPOILER_COMMAND`.
- State tracking: The `onMount` listener checks each node's `getStyle()` for the `janbao-spoiler` marker to update button active state.
- Editor CSS: Added attribute selector rules targeting `[style*='janbao-spoiler']` within `.ContentEditable__root` that apply `background-color: currentColor; color: currentColor;` (hiding text) with hover-to-reveal using `!important` overrides.
- Renderer: Checks `node.style` for the spoiler sentinel and applies the `.spoiler-text` class, which provides the same hide/reveal behavior in read-only rendered content.

### 1.5 Global CSS Additions

**File:** `src/app.css`

Added two rule sets:

1. `.spoiler-text` / `.spoiler-text:hover` - for rendered content (LexicalRenderer)
2. `.ContentEditable__root span[style*='janbao-spoiler']` - for editor content (LexicalEditor)

Both use `!important` to override any inline styles, with `currentColor` matching for text/background concealment and transparent background + DaisyUI `--bc` variable for reveal on hover.

### 1.6 i18n Keys

Added translation keys to both `en.json` and `zh-CN.json`:

- `editor.highlight`: "Marker Highlight" / "荧光标记"
- `editor.spoiler`: "Spoiler" / "剧透"

### 1.7 Type Discipline

- Created `src/lib/types/editor-commands.ts` for the shared `TOGGLE_SPOILER_COMMAND` constant.
- All function types in `LexicalEditor.svelte` were extracted to named `type` aliases (`GetStyleFn`, `SetStyleFn`, `GetNodesFn`, `UpdateFn`, `CommandHandlerFn`, `RegisterCommandFn`) to comply with the `no-restricted-syntax` ESLint rule.
- `VoidHandler` from `$lib/types/handlers` was reused for the `UpdateFn` parameter type.

---

## 2. Files Changed

| File                                                  | Change Type | Description                                                                |
| ----------------------------------------------------- | ----------- | -------------------------------------------------------------------------- |
| `src/lib/components/organisms/LexicalEditor.svelte`   | Modified    | Added AutoLinkPlugin, highlight theme, spoiler command, named type aliases |
| `src/lib/components/molecules/RichTextToolbar.svelte` | Modified    | Added Highlight/Spoiler buttons, Link modal, format state tracking         |
| `src/lib/components/molecules/LexicalRenderer.svelte` | Modified    | Added highlight (bit 128) and spoiler rendering support                    |
| `src/lib/types/editor-commands.ts`                    | Created     | Shared `TOGGLE_SPOILER_COMMAND` constant                                   |
| `src/app.css`                                         | Modified    | Added global spoiler CSS rules                                             |
| `src/lib/i18n/en.json`                                | Modified    | Added `highlight`, `spoiler` keys                                          |
| `src/lib/i18n/zh-CN.json`                             | Modified    | Added `highlight`, `spoiler` keys                                          |

---

## 3. Verification

- `bun run check`: 0 errors, 0 warnings ✅
- `bun run lint`: prettier ✅, eslint ✅, similarity-ts ✅ (only pre-existing similar types)
- All format bits tested in renderer: bold(1), italic(2), strikethrough(4), underline(8), code(16), highlight(128), spoiler(style marker)

---

## 4. Audit Log

### Round 1 (2026-06-12)

**Method:** 5 independent auditors reviewed all C05 code changes against requirements.

**Results:**

| #   | Check Item         | Consensus |
| --- | ------------------ | --------- |
| 1   | AutoLink Plugin    | PASS      |
| 2   | InsertLink Toolbar | PASS      |
| 3   | Marker Highlight   | PASS      |
| 4   | Spoiler Text       | PASS      |
| 5   | Type Discipline    | PASS      |
| 6   | ESLint Compliance  | PASS      |
| 7   | i18n               | PASS      |
| 8   | Security           | PASS      |
| 9   | Edge Cases         | PASS      |
| 10  | Code Quality       | PASS\*    |

**Blocking issue found:** `docs/DV01-C05-Journal.md` failed Prettier formatting, blocking `bun run lint`.

**Fix applied:** Ran `bunx prettier --write docs/DV01-C05-Journal.md`. Verified `bun run lint` passes cleanly after fix.

**Non-blocking observations (future cycles):**

- Hardcoded English toolbar strings (pre-existing, not C05 regression)
- `RichTextLinkEditor` has dead code checking `payload === 'https://'` (harmless)
- Plan deviation: AutoLink uses default matchers instead of custom regex (functionally correct)

**Verdict: ALL 5 AUDITORS AGREE - C05 PASS after fix. Cycle complete.**

See [RV01-C05-Audit-01](./RV01-C05-Audit-01.md) for full audit report.
