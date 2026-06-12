# RV01-C01-Audit: Cycle 1 Consolidated Code Audit

**Date:** 2026-06-12
**Scope:** Cycle 1 -- Layout, Header System & Sidebar Refactoring (QA #1, #3, #7, #12)
**Auditors:** 5 independent audit agents
**Consensus Verdict: PASS WITH NOTES**

---

## 1. Summary of All Auditors' Verdicts

| Auditor        | Verdict                 |
| -------------- | ----------------------- |
| Audit Agent #1 | PASS WITH NOTES         |
| Audit Agent #2 | PASS WITH NOTES (READY) |
| Audit Agent #3 | PASS WITH NOTES         |
| Audit Agent #4 | PASS WITH NOTES         |
| Audit Agent #5 | PASS WITH NOTES         |

All five auditors agree that Cycle 1 is functionally complete and ready for integration. Every targeted QA item is properly implemented. No critical or major blocking issues were identified by any auditor. The notes below are minor code quality and design observations suitable for a follow-up cleanup pass.

---

## 2. QA Item Verification (All Auditors Agree)

| QA Item | Description                                                                            | Status |
| ------- | -------------------------------------------------------------------------------------- | ------ |
| QA #1   | Header component with logo, desktop navigation, user info/auth links, mobile hamburger | PASS   |
| QA #3   | Mobile hamburger button opens sidebar drawer on < 768px                                | PASS   |
| QA #7   | Redundant home page title removed                                                      | PASS   |
| QA #12  | Profile and Settings sidebars separated with owner/visitor guards                      | PASS   |

---

## 3. Deduplicated Findings

### Finding 1: Loose `Record` typing for `t` prop instead of `TranslationDict`

- **Severity:** Minor
- **Raised by:** Auditors 1, 2, 3, 4, 5 (all)
- **Files:** `Header.svelte` (line 16), `ProfileSidebar.svelte` (line 14), `SettingsSidebar.svelte` (line 12), `DualColumnLayout.svelte` (line 11), `UserInfoBlock.svelte` (line 16, pre-existing)
- **Description:** The `t` prop uses `Record<string, Record<string, string> | string>` instead of the project's named `TranslationDict` type from `app.d.ts`. This forces repeated `as Record<string, Record<string, string>>` casts throughout components and bypasses compile-time key validation.
- **Recommendation:** Import `TranslationDict` from `app.d.ts` and use it as the `t` prop type. This eliminates all `as Record<>` casts and provides type-safe translation key access.

### Finding 2: Hardcoded English fallback strings in route files

- **Severity:** Minor
- **Raised by:** Auditors 1, 3
- **Files:** `+page.svelte` (home), `category/[categorySlug]/+page.svelte`, `discussion/[discussionId]/[slug]/[[page=page]]/+page.svelte`, `UserInfoBlock.svelte`
- **Description:** Multiple pages use the `?? 'English fallback'` pattern on translation keys (e.g., `{t.sidebar.createDiscussion ?? 'Create Discussion'}`). This violates the zero-hardcoded-strings principle and masks missing translation keys during development.
- **Recommendation:** Remove all `?? 'string'` fallbacks. The i18n files already contain all required keys.

### Finding 3: Header hamburger `aria-label` hardcoded in English

- **Severity:** Minor
- **Raised by:** Auditors 3, 4, 5
- **File:** `src/lib/components/organisms/Header.svelte` (line 76)
- **Description:** `aria-label="Open menu"` is a hardcoded English string, not translated via i18n. This is an accessibility concern for non-English users using screen readers.
- **Recommendation:** Add translation keys (e.g., `nav.openMenu` / `nav.closeMenu`) to both `en.json` and `zh-CN.json` and reference them in the `aria-label`.

### Finding 4: Sidebar `sticky top-6` may conflict with sticky header

- **Severity:** Minor
- **Raised by:** Auditors 3, 5
- **File:** `src/lib/components/templates/DualColumnLayout.svelte` (line 48)
- **Description:** The sidebar has `sticky top-6` (24px from top) but the Header is `sticky top-0 z-40` with `h-14` (56px). The sidebar's sticky position could place it partially behind the header on scroll. In practice, the sidebar is within the content container's padding, so it may work correctly, but the relationship is implicit rather than explicit.
- **Recommendation:** Consider changing to `sticky top-[72px]` or equivalent value that explicitly clears the 56px header plus a gap. Verify visually.

### Finding 5: Activity page renders empty sidebar column and drawer

- **Severity:** Minor
- **Raised by:** Auditors 1, 2, 5
- **File:** `src/routes/activity/+page.svelte` (lines 57-59)
- **Description:** The page defines an empty `{#snippet sidebar()}{/snippet}` passed to `DualColumnLayout`, which still renders the desktop `<aside>` column and mobile drawer markup (empty). The mobile hamburger button opens a blank panel.
- **Recommendation:** Omit the `sidebar` prop entirely on the activity page to avoid rendering unused drawer DOM and the confusing UX of an empty drawer opening on mobile tap.

### Finding 6: Bookmarks and Drafts pages lack `activeItem` on ProfileSidebar

- **Severity:** Nit / Minor
- **Raised by:** Auditors 2, 3, 4, 5
- **Files:** `src/routes/bookmarks/+page.svelte`, `src/routes/drafts/+page.svelte`
- **Description:** These pages render `ProfileSidebar` without specifying `activeItem`, so no sidebar navigation link is highlighted. Bookmarks and Drafts are not listed in the ProfileSidebar navigation items per the plan, so there is nothing to highlight. This is consistent with the plan but diverges from RQ00-Frontend Section 3.3.1 which mentions "Quick Links: Shortcuts to 'My Discussions' and 'My Drafts'".
- **Recommendation:** Decide whether Bookmarks and Drafts should be added to the ProfileSidebar navigation. If excluded by design, no action needed.

### Finding 7: Header profile link uses raw `user.username` instead of slugified version

- **Severity:** Minor
- **Raised by:** Auditors 4, 5
- **File:** `src/lib/components/organisms/Header.svelte` (line 54)
- **Description:** The profile link uses `href="/profile/{user.id}/{user.username}"` with the raw username. Other places (e.g., `ProfileSidebar.svelte`, `bookmarks/+page.svelte`) use `generateSlug(user.username)`. While the server treats the slug segment as cosmetic, inconsistent URL generation could produce different paths for usernames with special characters.
- **Recommendation:** Import `generateSlug` and use `generateSlug(user.username)` in the Header for consistency with the rest of the codebase.

### Finding 8: Header desktop nav links lack `aria-current="page"` indication

- **Severity:** Minor
- **Raised by:** Auditor 5
- **File:** `src/lib/components/organisms/Header.svelte` (lines 32-41)
- **Description:** Desktop navigation links do not indicate the current active page. There is no `aria-current="page"` attribute or visual active state for the link matching the current route.
- **Recommendation:** Use SvelteKit's `$page.url.pathname` to compare against each link's href and add `aria-current="page"` and an active style class when matched.

### Finding 9: Header conditionally rendered based on `t` truthiness

- **Severity:** Nit (design observation)
- **Raised by:** Auditor 5
- **File:** `src/lib/components/templates/DualColumnLayout.svelte` (lines 33-35)
- **Description:** Header is rendered inside `{#if t}`, meaning if a page omits the `t` prop, the Header silently disappears. All current page routes pass `t`, so this is not a runtime issue, but it could mask bugs during development.
- **Recommendation:** Consider making `t` a required prop on `DualColumnLayoutProps`, or document that `t` is required for the Header to render.

### Finding 10: Pre-existing `as` type assertions in page files

- **Severity:** Minor (pre-existing, not Cycle 1 regression)
- **Raised by:** Auditor 1
- **Files:** Multiple route pages (`notifications`, `bookmarks`, `drafts`, `messages/inbox`, `messages/new`, `profile/invitations`, `profile/comments`)
- **Description:** Several pages use `as` type assertions to cast `PageData` properties (e.g., `data.notifications as NotificationItem[]`). This indicates the `PageData` types are not being inferred precisely enough from server load functions.
- **Recommendation:** Track for future cleanup. The root fix is ensuring `+page.server.ts` return types are properly inferred.

### Finding 11: Hardcoded English strings outside i18n system

- **Severity:** Nit
- **Raised by:** Auditor 3
- **Files:** `category/[categorySlug]/+page.svelte` (lines 67, 97)
- **Description:** RSS title attribute `title="Subscribe to RSS Feed"` and sidebar label `Total: {data.totalCount}` are hardcoded English strings not going through the i18n system.
- **Recommendation:** Add i18n keys for these strings.

### Finding 12: Header does not show user identity on mobile viewports

- **Severity:** Nit (design observation)
- **Raised by:** Auditor 3
- **File:** `src/lib/components/organisms/Header.svelte` (lines 46-68)
- **Description:** The user avatar and display name are wrapped in `hidden md:flex`, so on mobile the only identifier is the hamburger button. Users must open the drawer to see their login status.
- **Recommendation:** Consider adding a small avatar next to the hamburger button on mobile for login status visibility. Optional, not a blocker.

### Finding 13: ProfileSidebar visitor view does not render UserInfoBlock

- **Severity:** Nit (design observation)
- **Raised by:** Auditors 3, 5
- **File:** `src/lib/components/molecules/ProfileSidebar.svelte` (lines 78-106)
- **Description:** In the visitor view branch (authenticated but different user), `UserInfoBlock` is not rendered. The sidebar shows only navigation links, making it sparse.
- **Recommendation:** UX decision -- consider whether to show the visitor's own info block or the target user's profile summary.

### Finding 14: `post/discussion` still uses SingleColumnLayout

- **Severity:** Not a Cycle 1 issue (tracked in Cycle 3)
- **Raised by:** Auditors 2, 4, 5
- **File:** `src/routes/post/discussion/+page.svelte`
- **Description:** This page still uses `SingleColumnLayout`. Per the plan, replacing it with `DualColumnLayout` is a Cycle 3 task (QA #4).
- **Recommendation:** No action for Cycle 1.

### Finding 15: Drawer infrastructure always in DOM regardless of sidebar content

- **Severity:** Nit
- **Raised by:** Auditor 5
- **File:** `src/lib/components/templates/DualColumnLayout.svelte`
- **Description:** The `drawer-end` wrapper and hidden checkbox are always rendered even when no sidebar content exists. This creates minimal DOM overhead for pages like Activity.
- **Recommendation:** Low impact. Can be addressed when the Activity page sidebar handling is resolved (see Finding 5).

---

## 4. Consensus Verification Checklist

| Criterion                                                          | Status |
| ------------------------------------------------------------------ | ------ |
| Header component exists with logo, nav links, user info/auth links | PASS   |
| Header NOT rendered on `/entry/*` routes                           | PASS   |
| Mobile hamburger button opens sidebar drawer on < 768px            | PASS   |
| Hamburger button has `aria-label`                                  | PASS   |
| Redundant home page title removed                                  | PASS   |
| Profile and Settings sidebars properly separated                   | PASS   |
| Owner/visitor/guest view guards hide private nav items             | PASS   |
| Sidebar placement correct across all 17+ route pages               | PASS   |
| All components follow Atomic Component Design                      | PASS   |
| No ESLint errors on any Cycle 1 file                               | PASS   |
| `svelte-check` passes with 0 errors, 0 warnings                    | PASS   |
| Translation keys exist in both `en.json` and `zh-CN.json`          | PASS   |
| No `any` types used                                                | PASS   |
| Interface-first rule followed                                      | PASS   |
| DaisyUI v5 + Tailwind v4 class consistency                         | PASS   |
| Snippet props used correctly (Svelte 5 runes)                      | PASS   |
| Sticky header uses glassmorphism as specified                      | PASS   |
| `dynamics` -> `activities` key migration complete                  | PASS   |
| `UserInfoSummary` structurally compatible with `UserData`          | PASS   |
| No leftover imports or unused variables                            | PASS   |
| Z-index layering correct (Header z-40, Drawer overlay z-50)        | PASS   |

---

## 5. Prioritized Recommendations

### High Priority (address in next cleanup pass)

1. **Use `TranslationDict` type for `t` props** -- Eliminates all `as Record<>` casts, provides compile-time key validation, and satisfies the project's named-type rule. (Findings 1)
2. **Remove `?? 'fallback'` i18n patterns** -- Remove all hardcoded English fallback strings in page files. (Finding 2)
3. **Add i18n key for hamburger `aria-label`** -- Add `nav.openMenu` / `nav.closeMenu` keys. (Finding 3)

### Medium Priority (address in follow-up cycle)

4. **Fix sidebar sticky positioning** -- Change `top-6` to a value that explicitly clears the header height. (Finding 4)
5. **Omit sidebar snippet on Activity page** -- Avoid rendering empty drawer DOM. (Finding 5)
6. **Use `generateSlug()` in Header profile link** -- Ensure consistent URL generation across all profile links. (Finding 7)
7. **Add `aria-current="page"` to active nav link** -- Improve Header accessibility. (Finding 8)

### Low Priority (defer or accept as-is)

8. **Bookmarks/Drafts `activeItem`** -- By design per plan; no action unless navigation items are expanded. (Finding 6)
9. **Hardcoded RSS/Total strings** -- Minor, add i18n keys when convenient. (Finding 11)
10. **Make `t` required on DualColumnLayout** -- Design decision, not blocking. (Finding 9)
11. **Visitor view UserInfoBlock** -- UX decision for future consideration. (Finding 13)
12. **Pre-existing `as` assertions in pages** -- Track for long-term cleanup. (Finding 10)

---

## 6. Consensus Verdict

**PASS WITH NOTES**

Cycle 1 is functionally complete and ready for merge. All four targeted QA issues (#1, #3, #7, #12) are fully implemented and verified by all five auditors. The Header component, ProfileSidebar, and SettingsSidebar are well-structured and follow project conventions. The sidebar placement across all 17+ route pages is correct. The owner/visitor/guest view guards work properly. No critical or major issues were found.

The findings above are minor and nit-level observations that can be addressed in a follow-up cleanup pass without blocking the current cycle or subsequent cycles.
