# RV01-C04-Audit-01: Cycle 4 First Audit Round

**Date:** 2026-06-12
**Method:** 5 independent agents reviewed all Cycle 4 changes simultaneously
**Scope:** All files modified/created in Cycle 4 (permissions, mentions, translations)

---

## 1. Executive Summary

Five independent auditors reviewed the Cycle 4 codebase changes covering guest permission fallback (QA #13), mention resolution (QA #8), and translation verification (QA #9). The audit identified 6 issues requiring fixes and 5 acknowledged low-priority gaps.

---

## 2. Issues Found & Fixed

### ✅ F1. Duplicated `getReadableCategorySlugs` across two DAOs

- **Who found it:** Auditors 1, 3, 4
- `src/lib/server/db/dao/discussions.ts` and `comments.ts` contained identical copies
- **Fix:** Extracted to `src/lib/server/constants.ts` as shared export

### ✅ F2. API `/api/categories` endpoint defaults to `'member'` instead of `'guest'`

- **Who found it:** Auditor 1
- `src/routes/api/categories/+server.ts` line 12 used `|| 'member'`
- **Fix:** Replaced with `resolveGroupSlug(locals.user)`

### ✅ F3. Bookmarks page does not filter by category read access

- **Who found it:** Auditor 4
- `src/routes/bookmarks/+page.server.ts` returned all bookmarks without permission check
- **Fix:** Added category permission filtering for bookmark results

### ✅ F4. RSS endpoint bypasses centralized `resolvePermissions`

- **Who found it:** Auditor 1
- `src/routes/category/[categorySlug]/rss/+server.ts` had inline permission logic
- **Fix:** Refactored to use `resolvePermissions()`

### ✅ F5. Category page missing `groupSlug` in list/count calls

- **Who found it:** Auditors 1, 4, 5
- `src/routes/category/[categorySlug]/+page.server.ts` didn't pass `groupSlug`
- **Fix:** Added `groupSlug` parameter to both calls

### ✅ F6. Mention chip links to raw username instead of slugified version

- **Who found it:** Auditor 4
- `LexicalRenderer.svelte` rendered `href="/profile/{user.id}/{user.username}"`
- **Fix:** Now uses `generateSlug(user.username)`

---

## 3. Acknowledged Gaps (Not Fixed — Low Priority)

| #   | Issue                                                                                     | Impact                                              |
| --- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- |
| A1  | Activity comments loaded via API have no mention resolution                               | @mentions in activity comments render as plain text |
| A2  | Drafts page and creation previews don't resolve mentions                                  | Draft previews show plain text @mentions            |
| A3  | Mention regex can false-positive on email addresses (`user@domain.com` matches `@domain`) | Wasted DB query, low probability                    |
| A4  | Post-query permission filtering may return fewer rows than `limit`                        | Pages may appear partially empty                    |
| A5  | `MentionedUserEntry` structurally similar to `UserInfoSummary`/`UserSearchResult`         | similarity-ts informational warning                 |

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
- RichTextToolbar `editor` prop removal confirmed safe

---

## 5. Verification

- `bun run check` — 0 errors, 0 warnings ✅
- `bun run lint` — prettier ✅, eslint ✅, similarity-ts ✅

---

## 6. Conclusion

All actionable findings from Round 1 have been fixed. The acknowledged gaps (A1-A5) are feature completeness items that should be tracked for a follow-up cycle. The codebase is ready for Round 2 audit.
