# DV01-C02-Journal: Cycle 2 Development Journal

## Cycle 2: Sidebar Widgets, Tooltip Alignment & Translations (QA #2, #6)

**Date:** 2026-06-12
**Status:** Complete  - All 5 agents PASS (Round 2)

---

## 1. Work Completed

### 1.1 QA #2: Tooltip Center Alignment

**Modified:** `src/lib/components/atoms/Tooltip.svelte`

- Replaced `right-0` with `left-1/2 -translate-x-1/2` on the popover div
- Tooltips are now horizontally center-aligned relative to their triggering icon buttons
- Matches RQ00-Frontend §3.4 specification: "All tooltips must be horizontally center-aligned relative to their triggering icon buttons"

### 1.2 QA #6: Active Users Wall on All Forum Sidebars

**Modified sidebar snippets in 4 pages:**

- `src/routes/+page.svelte` (Home)  - Added `<ActiveUsersWall {t} />` at bottom of sidebar card
- `src/routes/categories/+page.svelte` (Categories)  - Added `<ActiveUsersWall {t} />` at bottom
- `src/routes/category/[categorySlug]/+page.svelte` (Category)  - Added `<ActiveUsersWall {t} />` at bottom
- `src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.svelte` (Discussion)  - Added `<ActiveUsersWall {t} />` at bottom

The ActiveUsersWall component already existed in `src/lib/components/molecules/ActiveUsersWall.svelte` (previously only rendered on `/messages/new`). Now it appears on all forum route sidebars per RQ00-Frontend §3.3.1.

### 1.3 Category List Widget

**Created:** `src/routes/api/categories/+server.ts`

- New API endpoint (`GET /api/categories`) returning categories readable by the current user's group
- Uses the same permission-filtering logic as the Categories page server load
- Returns `{ slug, title }[]` ordered by `displayOrder`

**Created:** `src/lib/components/molecules/CategoryListWidget.svelte`

- Fetches `/api/categories` on mount
- Displays a vertical navigation list of category links
- Supports `activeSlug` prop to highlight the currently active category
- Shows skeleton loading state, gracefully handles empty results
- Added to sidebars of Home, Category, and Discussion pages

### 1.4 Forum Translation Block

**Modified:** `src/lib/i18n/en.json`

- Added `"forum"` block with keys: `views`, `replies`, `lastReplyBy`, `pinned`

**Modified:** `src/lib/i18n/zh-CN.json`

- Added `"forum"` block with Chinese translations: `浏览`, `回复`, `最后回复`, `置顶`

This prevents `DiscussionRow.svelte` from falling back to hardcoded English strings. The component already reads from `t.forum.*` with English defaults  - now it receives proper translations.

---

## 2. Verification Results

| Check                                              | Result                  |
| -------------------------------------------------- | ----------------------- |
| `bun run check` (svelte-check)                     | ✅ 0 errors, 0 warnings |
| `bun run lint` (prettier → eslint → similarity-ts) | ✅ Exit code 0          |

---

## 3. Files Changed

### New Files

- `src/routes/api/categories/+server.ts`  - Categories API endpoint
- `src/lib/components/molecules/CategoryListWidget.svelte`  - Category navigation widget

### Modified Files

- `src/lib/components/atoms/Tooltip.svelte`  - Center-aligned popover positioning
- `src/lib/i18n/en.json`  - Added `forum` block
- `src/lib/i18n/zh-CN.json`  - Added `forum` block
- `src/routes/+page.svelte`  - Added ActiveUsersWall + CategoryListWidget to sidebar
- `src/routes/categories/+page.svelte`  - Added ActiveUsersWall + CategoryListWidget to sidebar
- `src/routes/category/[categorySlug]/+page.svelte`  - Added ActiveUsersWall + CategoryListWidget to sidebar
- `src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.svelte`  - Added ActiveUsersWall + CategoryListWidget to sidebar

---

## 4. Audit Log

### Audit Round 1  - 2026-06-12

**Method:** 5 independent audit agents reviewed all Cycle 2 files, findings consolidated into `docs/RV01-C02-Audit-01.md`.

**Consensus:** PASS WITH FIXES REQUIRED (2/5 PASS, 3/5 FAIL)

**Post-audit fixes applied:**

| Fix                                          | Description                                                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| CategoryListWidget on `/categories`          | Added missing CategoryListWidget to the Categories page sidebar, making all 4 forum route sidebars consistent                          |
| TranslationDict import in CategoryListWidget | Replaced local `TranslationDict` interface with `import type { TranslationDict } from '$lib/types/translation'` for proper type safety |
| TranslationDict import in ActiveUsersWall    | Same fix  - replaced local declaration with shared import, simplified `t.sidebar.activeUsers` access (no cast needed)                   |

**Deferred (not Cycle 2 scope):**

- Guest fallback `'member'` in `/api/categories`  - pre-existing, scheduled for Cycle 4 (QA #13)

**Round 1 verification:**

- `bun run check`  - 0 errors, 0 warnings (1048 files)
- `bun run lint`  - exit code 0

### Audit Round 2  - 2026-06-12

**Method:** 5 independent audit agents re-reviewed all Cycle 2 files after Round 1 fixes.

**Consensus:** ALL 5 AGENTS PASS

**Additional fixes applied (per user request):**

| Fix                         | Description                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tooltip viewport overflow   | Added `max-w-[calc(100vw-1rem)]` to popover div to prevent clipping on narrow viewports                                                                                                                                              |
| DiscussionRow `t` prop type | Replaced inline `Record<string, Record<string, string> \| string> \| null` with `TranslationDict` from `$lib/types/translation`. Simplified 4x `$derived.by` + cast blocks to clean `$derived(t?.forum?.key ?? fallback)` one-liners |

**Modified files added:**

- `src/lib/components/organisms/DiscussionRow.svelte`  - Shared TranslationDict import, simplified i18n derived values

**Final verification:**

- `bun run check`  - 0 errors, 0 warnings (1048 files)
- `bun run lint`  - exit code 0
