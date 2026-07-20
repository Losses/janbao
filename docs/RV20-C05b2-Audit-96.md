# DV20 Cycle 5b2 - Audit 96 (R96)

**Date:** 2026-07-20. **Round:** R96, the fifth open-scoped round. **Counter after this round:** 0/5 (R96 produced concerns; it is not a PASS round). **Gate:** green, zero flakies.

Two independent open-scoped auditors ran the whole codebase. Auditor A returned 7 findings; Auditor B returned 8 (B-L1 duplicates A4). The orchestrator triaged every finding, confirmed the real ones, adjudicated one lead as a false positive, and applied ten fixes (seven from the audited findings plus three from horizontal sweeps the fixers ran). Each fix came with a binding class-wide horizontal sweep and a preventive test. The full gate is green with zero flakies.

R96 launch hit the account 5-hour quota cap on first attempt; both auditors re-ran cleanly once capacity returned. The audit prompt did NOT yet carry the explicit PASS criterion; that is added to the prompt file for R97 per the user's instruction.

## Findings and fixes

### CONCERN

**C1 (A1). Upload route left orphan files and DB/file drift on DB-write failure.** `src/routes/upload/+server.ts`. The handler ran `pcloudMove(/tmp/<tmpName> -> /avatars/<userId> | /attachments/<sha>)` and then the DB write; the catch deleted only `/tmp/<tmpName>`, which the MOVE had already consumed. On a DB failure after a successful move the avatar file drifted from the DB-recorded sha, and attachment bytes were leaked with no row. Fix: extracted `commitUploadedFile` in `src/lib/server/utils/upload-commit.ts` using DB-write-first / MOVE-second ordering with a compensating rollback of OUR DB row on MOVE failure. DB-first is required because a content-addressed attachment file may already be referenced by a pre-existing row for the same sha, so a file-side delete on failure would orphan that reference; undoing our own row is always safe. The avatar path captures prior `avatarFileId` / `avatarContentType` to restore; the attachment path uses `.onConflictDoNothing().returning()` to delete the row only when this request actually inserted it. Horizontal: the move-then-db pattern is unique to this route (`backup.ts` does not tie a DB write to the upload). Four unit tests pin the compensation contract. Return shapes preserved.

**C2 (A2 + A3). Post-login destination dropped.** `src/routes/entry/signin/+page.svelte:42` always did `goto('/')`, ignoring the `?redirectTo=` query, and nine loaders emitted a bare `redirect(302, '/entry/signin')` with no destination. Fix: added `src/lib/utils/redirect.ts` with `isSafeInternalRedirect` (five-layer open-redirect defense: non-empty leading `/`; reject `//` and `/\`; no backslashes; no `://`; final same-origin URL parse), `resolveInternalRedirect`, and `buildSignInRedirectUrl(pathname)`. The signin page now consumes a validated redirectTo. The nine bare loaders (bookmarks, drafts, notifications, messages/inbox, activity, messages/add, messages/new, profile/invitations, profile fallback) and the bookmarks client-side goto now build `?redirectTo=<encoded pathname>`; sixteen already-correct loaders were refactored to the shared helper for consistency. Legitimate-bare cases left as-is with reasoning (profile null-header fallback, register, reset-password, signout, auth cross-links). Horizontal: the only remaining destination-dropping guest surfaces are three anchor tags (see X3). Ten redirect tests cover each attack vector and the round-trip.

**C3 (B-C1). reindexUser ran outside its transaction.** `src/routes/api/profile/edit/+server.ts:148`. The `UPDATE users` committed, then `reindexUser` ran as a separate commit; a failure between left `users_fts` stale (user searchable by old identity, or unsearchable). Fix: wrapped the UPDATE and `reindexUser` in `locals.db.transaction(async (tx) => ...)`, passing `tx` to both (reindexUser accepts `DbLike` natively). Same class as R95's three fixes; this site was missed by R95's sweep. Horizontal: seventeen production call sites classified, all now inside their row transaction or are documented-harmless soft-delete unindexes. Three FTS atomicity tests.

### LOW

**L1 (A4 / B-L1). /api/users sentinel filter excluded only -1.** `src/routes/api/users/online/+server.ts` and `/search/+server.ts`. Broadened `not(eq(users.id, SYSTEM_USER_ID))` to also exclude `GHOST_USER_ID` (the `isStealth` clause stays for its separate presence purpose). Also broadened the sibling `searchUsers` DAO. Horizontal: all sentinel-id filters classified; no `id > 0` or `id !== -1/-2` antipatterns remain.

**L2 (A5). Mention dispatch notified sentinels.** `src/lib/server/db/notifications.ts:76-86`. A literal `@system` or `@<ghost-username>` resolved to a real notification row for -1 or -2. Fix: mention-id resolution filters each candidate through `isRealUserId`. The chip resolver `src/lib/server/utils/mentions.ts` also skips sentinel rows so they never render as profile-linking chips. Stealth determination: stealth governs presence surfacing only (Active Users Wall, last-active), NOT mention notifications; stealth users are still notified when explicitly @mentioned (the author's intent). Locked by a regression test. Evidence: i18n `stealthDescription`, the ProfileHeader comment scope, and `/api/profile/stealth` writing only the isStealth column.

**L3 (A6). Non-atomic preference upserts.** `ui-preferences.ts`, `editor-preferences.ts`, `POST /api/profile/preferences`. Select-then-insert/update raced to an ungraceful 500 on the PK. Fix: each is now a single `insert(...).onConflictDoUpdate(...)`. Same fix applied to the sibling `POST /api/push/subscribe` (keyed on endpoint). Two inspected-but-different-class cases reported (see X1, X2). Four unit tests assert insert-then-update-in-place and fold-onto-existing.

**L4 (A7). Offline reader skipped read recording when online.** `src/routes/offline/[discussionId]/+page.svelte`. The `if (navigator.onLine) return` guard skipped the outbox delta; `/offline/<id>` is reachable while online (direct URL, the offline list links to it with no online gate), so the read was never recorded. Fix: removed the guard; `lastReadPage` is now derived from the cached-range manifest via a new `highestCachedPage` helper in `src/lib/offline/manifest.ts`. Contract determination with evidence: the online read mutation lives in `/discussion/.../+page.server.ts`, never invoked from `/offline/...`; the inverted guard was unique. Three manifest tests.

**L5 (B-L2). deleteDiscussion stats decrement outside transaction.** `src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.server.ts`. The soft-delete UPDATE committed, then `unindexDiscussion` and `decrementContributionStats` ran outside a transaction; a stats-decrement failure left the deleted discussion counted forever. Fix: wrapped the UPDATE and both side-effects in `db.transaction`, mirroring the sibling `deleteReply`. Three FTS atomicity tests (shared with C3).

### VERY LOW

**V1 (B-V1). Duplicate SYSTEM/GHOST_USER_ID source.** `src/lib/server/constants.ts` and `src/lib/utils/user.ts` both defined the sentinels. Consolidated to a single canonical source in `utils/user.ts` (client-safe); `constants.ts` re-exports. Drift-guard test added. `getSiteUrl` untouched.

**V2 (B-V2). drafts DELETE missed the shared helper.** `src/routes/api/drafts/+server.ts`. Now uses `normalizeDraftContextId(Number(...))`; the `Number()` wrap preserves query-string parsing, without which every contextId would collapse to 0. Test pins the pattern.

**V3 (B-V3). Stale isMobile SSR comment.** `src/routes/(tabs)/+layout.svelte:13-15` claimed SSR renders desktop by default; the code seeds from the UA-derived `data.isMobile`. Rewritten to match the actual mechanism. Horizontal found a sibling at `src/routes/search/+page.svelte:19-22`; both fixed.

**V4 (B-V4). Redundant isNaN clause.** `src/routes/api/auth/admin-generate-reset/+server.ts:22-23`. `Number.isNaN(x)` is subsumed by `!Number.isFinite(x)`; collapsed to the single check.

### Horizontal-sweep extras (found by the fixers, fixed this round)

**X1. admin/user-groups and admin/categories CREATE races (from the A6 sweep).** `src/routes/api/admin/user-groups/+server.ts` and `/categories/+server.ts`. Select-then-insert CREATE raced to a 500 on the slug PK instead of the intended 409. Fix: `createUserGroup` and `createCategory` return `Promise<boolean>` via `onConflictDoNothing({ target: slug }).returning()`; the routes map false to the existing 409 message. The redundant existence pre-checks were dropped (the PK is the single source of truth). Six unit tests including a parallel-duplicate-create regression.

**X2. joined-activity get-or-create race (from the A6 sweep).** `src/lib/server/db/joined-activity.ts`. Two concurrent same-day signups both observed "no row" and both inserted, producing duplicate daily-activity rows. Fix: added a `joined_day` column and a `UNIQUE(is_joined, joined_day)` index (migration `drizzle/local-migrations/0019_outstanding_prism.sql`, which backfills `joined_day` then dedups any existing duplicates before creating the index); the insert is now `insert(...).onConflictDoUpdate({ target: [isJoined, joinedDay], set: { updatedAt } })`. Migration coverage: `src/lib/server/db/index.ts:52` auto-applies `drizzle/local-migrations` on startup for the libsql DB used by local dev, prod (adapter-node), and the e2e webServer; the D1 config is not the active prod path. Three unit tests including a parallel-collapse regression.

**X3. Guest sign-in anchor tags dropped destination (from the A2 sweep).** `src/lib/components/templates/DualColumnLayout.svelte:191,273` and `src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.svelte:839`. Three guest-facing `<a href="/entry/signin">` buttons landed the user on `/` after sign-in. Fix: each now targets `buildSignInRedirectUrl(page.url.pathname)`. Auth-flow cross-links (forgot, register, reset-password) left as legitimate bare.

### False positive (adjudicated, NOT a defect)

**Host-header / getSiteUrl fallback.** A partial auditor run flagged `src/lib/server/constants.ts:36-40` (`getSiteUrl` falls back to `${url.protocol}//${url.host}` when SITE_URL is unset) as a potential host-header injection. The orchestrator's independent verification found this is the deliberate, audited resolution from cycle DV04-C03 (see `docs/RV04-C03-Audit-02.md` and `docs/DV04-C03-Journal.md`): `getSiteUrl` was introduced precisely to close RSS host-header poisoning by preferring a configured `SITE_URL`, with the request-origin fallback for dev. The function has a single caller, the RSS route (`src/routes/category/[categorySlug]/rss/+server.ts:73`), whose comment documents the SITE_URL preference. Neither full auditor (A or B) flagged it. No change; the fallback is accepted, documented design.

## Open-question adjudications

- **A5 stealth semantic.** Stealth governs presence surfacing only (Active Users Wall, last-active); it is not a mention-notification opt-out. Evidence: i18n `stealthDescription`, the ProfileHeader comment scope, and `/api/profile/stealth` writing only the isStealth column. Stealth users are still notified when @mentioned.
- **A7 offline contract.** `/offline/<id>` is reachable while online (no server gate; the offline list links to it; direct URL, bookmark, history). The `navigator.onLine` guard was a real defect, not by-design.

## Gate (orchestrator-run, 2026-07-20)

```
$ bun run check                       0 errors / 0 warnings (1466 files)
$ bun run lint                        EXIT=0 (similarity informational; no new type duplicates)
$ bun test src/lib                    521 pass / 0 fail (2194 expect)
$ bunx tsc -p scripts/tsconfig.json   EXIT=0
$ bun run test:e2e                    210 passed / 0 flaky (exit 0, 9.3m)
```

## Counter

0/5 (R96 had concerns; not a PASS round). R97 runs with the PASS criterion added to the audit prompt.
