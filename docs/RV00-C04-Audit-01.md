# RV00-C04-Audit-01: Cycle 4 Audit Round 1 Report

**Date:** 2026-06-12
**Method:** 5 independent full-scope audit agents dispatched in parallel. Each agent read all specification documents (RQ00-Backend, RQ00-Frontend, RQ00-Plan) and all 27+ C04 code files, producing independent PASS/FAIL/WARN assessments across 13 audit categories.

**Agent Verdicts:**
| Agent | Verdict | FAIL | WARN |
|-------|---------|------|------|
| Agent 1 | FAIL | 4 | 6 |
| Agent 2 | PASS-WITH-WARNINGS | 0 | 3 |
| Agent 3 | PASS-WITH-WARNINGS | 0 | 4 |
| Agent 4 | FAIL | 2 | 3 |
| Agent 5 | FAIL | 4 | 5 |

---

## Consensus FAIL Items Found: 4

| ID | Description | Resolution |
|----|-------------|------------|
| F-01 | All 6 C04 API endpoints use raw `json({ error: t.* })` instead of `jsonError(t, 'key.path', status)` — violates RQ00-Backend §2.8 error handling convention | Fixed: replaced all `json({ error: ... })` error calls with `jsonError(t, 'key.path', status)` in all 6 API files |
| F-02 | Activity Square sidebar renders UserInfoBlock + navigation links, contradicting RQ00-Frontend §3.3.5 ("sidebar is left completely empty") | Fixed: emptied sidebar content, added comment referencing spec section |
| F-03 | Profile page server load missing batch recipient display names and comment counts for ActivityRow — directed indicator (User A → User B) never renders on profile pages | Fixed: added batch recipient name fetch and comment count query mirroring activity square pattern; replaced raw `sql` OR clause with Drizzle `or(eq(), eq())` |
| F-04 | DELETE handler parent activity lookup missing `isNull(deletedAt)` filter and parent `recipientId` authorization check — soft-deleted parent authors could authorize comment deletion; profile owners (parent recipients) could not | Fixed: added `isNull(activities.deletedAt)` to parent lookup; added `recipientId` check alongside `authorId` check |

## Majority WARN Items Fixed: 5

| ID | Description | Resolution |
|----|-------------|------------|
| W-01 | ConfirmationModal backdrop has hardcoded `aria-label="Close modal"` — violates zero-hardcoded-strings i18n policy | Fixed: replaced with `{cancelLabel}` prop reference |
| W-02 | ActivityRow delete button visibility only checks author/admin — backend also authorizes recipient and parent author; authorized users cannot discover delete capability via UI | Fixed: added `recipientId` check for root activities; added `resolvedAuthorId` and `recipientId` checks for comment delete buttons |
| W-03 | Profile edit language selector has hardcoded "English" / "简体中文" labels | Fixed: replaced with `t.profile.languageEnglish` / `t.profile.languageChinese` i18n keys; added keys to both en.json and zh-CN.json |
| W-04 | 5 Svelte settings pages use inline type literal `$state<{ type: 'success' \| 'error'; text: string } \| null>` — violates zero-inline-typing rule | Fixed: extracted `FeedbackMessage` interface to `src/lib/types/api.ts`; updated all 5 files to import and use named type |
| W-05 | `ProfileEditUpdates` and `PreferenceUpdates` interfaces duplicate `ProfileEditBody` and `ProfilePreferencesBody` — similarity-ts detects structural duplicates | Fixed: removed local interfaces, replaced with `Partial<ProfileEditBody>` and `Partial<ProfilePreferencesBody>` |

## Observations (Not Fixed — By Design)

1. **Profile activity stream no pagination:** The profile page fetches 20 activities without pagination controls. The spec does not mandate pagination for the profile activity stream (only for activity square and discussion lists). This is an acceptable design choice.
2. **Activity comment composer uses plain `<input>`:** Inline comments use a plain text input rather than a rich text editor. This is a pragmatic simplification for single-line inline comments.
3. **`gtc()` helper limited to `common.*` keys:** The ActivityRow `gtc()` helper only resolves keys under `t.common`. All current usages target `common.*` keys. If future features need `activity.*` or `profile.*` keys in ActivityRow, the helper should be generalized.

---

## Verification

- **Type Check:** `bun run check` — 983 files, 0 errors, 0 warnings.
- **Lint Check:** `bun run lint` — 0 errors, 0 warnings. similarity-ts type duplicates = 0.
- **Strict Typing:** Zero occurrences of `any`, `as any`, `as unknown` across all C04 files.
- **i18n Compliance:** All API error responses use `jsonError(t, 'key.path', status)`. All UI text uses dictionary keys. Zero hardcoded strings in C04 code.
- **Soft Deletion Safety:** All activity queries apply `isNull(activities.deletedAt)`. DELETE parent lookup also applies filter.
