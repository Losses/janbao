# RV01-C04-Audit-02: Cycle 4 Second Audit Round

**Date:** 2026-06-12
**Method:** 5 independent agents reviewed all Cycle 4 changes simultaneously
**Scope:** Full audit of all C04 files after Audit Round 1 fixes applied

---

## 1. Executive Summary

Five independent auditors reviewed the Cycle 4 codebase after the first audit round. The verdict was 4 PASS / 1 FAIL. The sole FAIL (Auditor 1) was driven by a bookmarks pagination count mismatch that was also flagged by all other auditors at medium severity. Seven issues were identified and fixed in this round.

---

## 2. Issues Found & Fixed

### ✅ F1. Bookmarks pagination count mismatch after permission filtering (Critical - all 5 auditors)

- **Who found it:** Auditors 1 (Critical), 2 (Medium), 3 (Medium), 4 (Medium), 5 (Medium)
- `src/routes/bookmarks/+page.server.ts` computed `totalPages` from unfiltered `totalCount`, while `bookmarks` were filtered by category read access
- **Fix:** Refactored bookmarks DAO (`getBookmarks`, `getBookmarksCount`) to accept `readableCategorySlugs` filter, applied via SQL `inArray` clause. Page handler now uses `getReadableCategorySlugs` for both admin shortcut and filtered queries, ensuring `totalCount` and `totalPages` are always consistent with displayed results.

### ✅ F2. Dead ternary expression in categories page (Medium - all 5 auditors)

- **Who found it:** Auditors 1, 2, 3, 4, 5
- `src/routes/categories/+page.server.ts:34` had `groupSlug === 'guest' ? true : true` - both branches identical
- **Fix:** Simplified to `const defaultCanRead = true;` with a comment explaining both roles default to read

### ✅ F3. Duplicate `RecipientInfo` interface across two loaders (Medium - all 5 auditors)

- **Who found it:** Auditors 1, 2, 3, 4, 5
- `src/routes/activity/+page.server.ts` and `src/routes/profile/[userId]/[userSlug]/+page.server.ts` both defined identical `RecipientInfo` interfaces
- **Fix:** Extracted to `src/lib/types/api.ts` as a shared export, imported in both loaders

### ✅ F4. Bookmarks page missing admin/moderator shortcut (Medium - Auditors 2, 4, 5)

- **Who found it:** Auditors 2, 4, 5
- Bookmarks page queried `categoryPermissions` even for admin/moderator users, unlike all other routes
- **Fix:** Now uses `getReadableCategorySlugs` which returns `null` for privileged groups, skipping the query entirely

### ✅ F5. ActivityRow defined local `TranslationDict` instead of importing canonical type (Medium - Auditor 4)

- **Who found it:** Auditor 4
- `ActivityRow.svelte` had `{ [key: string]: string | Record<string, string> }` instead of importing from `$lib/types/translation`
- **Fix:** Replaced with `import type { TranslationDict } from '$lib/types/translation'` and adjusted `gtc()` helper to use `Record<string, string>` cast for dynamic key access

### ✅ F6. RSS endpoint over-fetched user columns including `passwordHash` (Low - Auditor 4)

- **Who found it:** Auditor 4
- `src/routes/category/[categorySlug]/rss/+server.ts` selected all user columns when only `groupSlug` was needed
- **Fix:** Changed to `db.select({ groupSlug: users.groupSlug })` - minimal field selection

### ✅ F7. `resolvePermissions` used inline fallback instead of `resolveGroupSlug` (Low - Auditor 2)

- **Who found it:** Auditor 2
- `src/lib/server/constants.ts:120` had `user?.groupSlug || 'guest'` duplicating `resolveGroupSlug` logic
- **Fix:** Replaced with `resolveGroupSlug(user)` call for single source of truth

---

## 3. Acknowledged Gaps (Not Fixed - Feature Completeness)

Carried forward from Audit Round 1:

| #   | Issue                                                                             | Impact                                              |
| --- | --------------------------------------------------------------------------------- | --------------------------------------------------- |
| A1  | Activity comments loaded via API have no mention resolution                       | @mentions in activity comments render as plain text |
| A2  | Drafts page and creation previews don't resolve mentions                          | Draft previews show plain text @mentions            |
| A3  | Mention regex can false-positive on email addresses                               | Wasted DB query, low probability                    |
| A4  | Post-query permission filtering may return fewer rows than `limit`                | Pages may appear partially empty                    |
| A5  | `MentionedUserEntry` structurally similar to `UserInfoSummary`/`UserSearchResult` | similarity-ts informational                         |

---

## 4. Positive Findings (Confirmed by Multiple Auditors)

- Guest permission model correctly implements spec: guest=read-only, member=read+create, admin/mod=all
- `resolvePermissions` and `resolveGroupSlug` correctly handle null/undefined users
- Discussion lists and user comments properly filtered by category read access
- All 5 content-serving load handlers correctly call `resolveMentions`
- `mentionedUsers` properly threaded from loaders → pages → components → LexicalRenderer
- LexicalRenderer gracefully handles missing `mentionedUsers` (fallback to plain text)
- Seed migration is idempotent (check-before-insert pattern)
- Zero lint errors, zero type check errors, zero type duplicates
- SQL injection fully mitigated via Drizzle ORM parameterized queries
- i18n compliance thorough - all error messages use `locals.t.*`
- Mention batch-query approach avoids N+1 problems
- Mention chip links correctly use `generateSlug()` for profile URLs

---

## 5. Verification

- `bun run check` - 0 errors, 0 warnings ✅
- `bun run lint` - prettier ✅, eslint ✅, similarity-ts ✅ (0 type duplicates, 3 informational similarities)

---

## 6. Auditor Verdicts

| Auditor | Verdict                 | Notes                                                                 |
| ------- | ----------------------- | --------------------------------------------------------------------- |
| 1       | FAIL → PASS after fixes | Bookmarks pagination was the sole blocker                             |
| 2       | PASS                    | Recommended M1 (bookmarks) and M2 (ternary) for follow-up - now fixed |
| 3       | PASS                    | Flagged M1 (ternary) and M2 (bookmarks) as quality items - now fixed  |
| 4       | PASS                    | Flagged M1-M4, all addressed in this round                            |
| 5       | PASS                    | Flagged M1-M4, all addressed in this round                            |

---

## 7. Conclusion

All 7 actionable findings from Round 2 have been fixed. The bookmarks page now uses query-level category filtering via the centralized `getReadableCategorySlugs` helper, correctly handles admin/moderator shortcuts, and produces accurate pagination counts. The acknowledged gaps (A1-A5) remain feature completeness items for a follow-up cycle.
