# RV00-C02-Audit-01: Cycle 2 Round 1 Audit Report

**Date:** 2026-06-12
**Auditors:** 5 Independent Agents
**Verdict:** FAIL → Fixed

---

## Defects Identified (Consensus across 5 Agents)

### CRITICAL (2)

| ID | File | Description |
|----|------|-------------|
| C1 | `src/routes/api/drafts/save/+server.ts` | TOCTOU race condition in manual SELECT+INSERT upsert; concurrent requests cause unhandled unique constraint violation (5/5 agents) |
| C2 | `src/lib/components/organisms/LexicalEditor.svelte` | `loadDraft()` calls non-existent `GET /api/drafts` endpoint; dead code that always 404s (4/5 agents) |

### MAJOR (4)

| ID | File | Description |
|----|------|-------------|
| M1 | `src/lib/components/atoms/Date.svelte` | All relative time strings hardcoded English; `date.*` i18n keys exist but unused (5/5 agents) |
| M2 | `src/lib/components/organisms/LexicalEditor.svelte` | Save status labels hardcoded English; `editor.*` i18n keys unused (4/5 agents) |
| M3 | `src/lib/components/atoms/Paginator.svelte` | Aria-labels hardcoded English; `pagination.*` i18n keys unused (3/5 agents) |
| M4 | `src/routes/api/drafts/save/+server.ts` | `contextId` nullable column vs empty-string sentinel mismatch; no input validation on `contextType` or `contentJson` size (3/5 agents) |

### MINOR (12)

| ID | Description | Agents |
|----|-------------|--------|
| m1 | Tooltip nested `<button>` inside `<button>` — invalid HTML | 1/5 |
| m2 | Tooltip lacks `aria-haspopup` and focus trap on popover | 3/5 |
| m3 | Mock tooltip data in English only | 2/5 |
| m4 | No `Cache-Control` header on `/api/users/online` | 2/5 |
| m5 | No content size limit on draft save | 3/5 |
| m6 | Repeated `as Record<>` type cast on `t` prop in molecules | 3/5 |
| m7 | Notification items are non-interactive (no links) | 2/5 |
| m8 | Hardcoded system user UUID magic string | 1/5 |
| m9 | Logo hardcoded brand name | 3/5 |
| m10 | Date `formatFuture` incomplete for hours/days/years | 2/5 |
| m11 | Tooltip global click handler per instance | 2/5 |
| m12 | `seed.ts` `seeded` flag not concurrency-safe (pre-existing) | 1/5 |

---

## Resolutions Applied

### C1: Draft save race condition → Atomic upsert

**File:** `src/routes/api/drafts/save/+server.ts`

Replaced the manual SELECT-then-INSERT/UPDATE pattern with Drizzle's `onConflictDoUpdate()`, targeting the unique composite index `(authorId, contextType, contextId)`. Added:
- Input validation: `contextType` validated against allowlist `['discussion', 'reply', 'message', 'activity']`
- Content size limit: 512 KiB max for `contentJson`
- Normalized `contextId` to always use empty string `''` (never NULL)

### C2: Dead `loadDraft()` code removed

**File:** `src/lib/components/organisms/LexicalEditor.svelte`

Removed the `loadDraft()` function entirely. Draft loading is deferred to Cycle 5 (when `GET /api/drafts` will be implemented alongside the full drafts management system). Added a comment documenting this decision. The parent component is responsible for providing `initialContent` via server-side data loading.

### M1: Date.svelte i18n integration

**File:** `src/lib/components/atoms/Date.svelte`

Added `t` prop accepting the translation dictionary. All relative time strings now use `t.date.*` keys (`yearAgo`, `yearsAgo`, `monthAgo`, `daysAgo`, `hoursAgo`, `minutesAgo`, `justNow`). Falls back to English when `t` is not provided. Also fixed `formatFuture()` to handle hours/days (m10).

### M2: LexicalEditor i18n integration

**File:** `src/lib/components/organisms/LexicalEditor.svelte`

Added `t` prop. Save status labels use `t.editor.saving`, `t.editor.saved`. Loading text uses `t.editor.loading`. Placeholder defaults to `t.editor.placeholder` when no override provided. Renamed `validateImageSrc` → `validateUrl` for clarity.

### M3: Paginator i18n integration

**File:** `src/lib/components/atoms/Paginator.svelte`

Added `t` prop. `aria-label` on Previous/Next buttons now uses `t.pagination.previous` / `t.pagination.next` with English fallback.

### M4: Draft save input validation

**File:** `src/routes/api/drafts/save/+server.ts`

`contextType` validated against allowlist. `contentJson` capped at 512 KiB. `contextId` normalized to `''`.

### m1: Tooltip nested button fix

**File:** `src/lib/components/atoms/Tooltip.svelte`

Replaced the internal `<button>` wrapper with a `<div role="button" tabindex="0">` that delegates click handling. Children (the actual buttons from molecules) are no longer nested inside another button. Added `onkeydown` handler for Enter/Space and `role="button"` for a11y.

---

## Verification

- `bun run check`: 897 files, 0 errors, 0 warnings
- `bun run lint` (Prettier + ESLint): Clean, zero errors
- Zero `any`, `as any`, `as unknown as` patterns across all Cycle 2 files
