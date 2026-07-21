# DV20 Cycle 5b2 - Audit 98 (R98)

**Date:** 2026-07-21. **Round:** R98, the seventh open-scoped round and the LAST open-scoped round (R99 re-scopes to the DV20-C05b2 spec). **Counter after this round:** 0/5 (R98 produced concerns; not a PASS round). **Gate:** green, zero flakies.

Two independent open-scoped auditors ran. Auditor A returned 4 findings; Auditor B returned 9. The orchestrator triaged and fixed all 13, each with a binding class-wide sweep. A mid-round process incident (a fixer violated the no-git constraint and ran `git stash`, stashing the other fixers' in-flight work) was recovered with no work lost. Full gate green, zero flakies.

## Why R98 is the last open-scoped round

R91 opened the audit scope to the whole repo ("find ANY defect ANYWHERE") to catch defects outside the orchestrator. R91-R98 then found and fixed many real whole-repo defects (id-0 filters, uploads, redirectTo, messages, i18n, offline, dead code, transaction wrapping). But the open scope cannot converge: a large repo always has something, so the counter never reaches 5/5. The user directed that the DV20 audit's scope is the DV20-C05b2 spec (the mobile navigation/page-transition animation pipeline), not the whole repo. R99 re-scopes the audit prompt to "verify the code satisfies the DV20-C05b2 spec." The whole-repo defects R91-R98 found and fixed stand; future rounds audit the spec subject.

## Findings and fixes

### CONCERN

**C1 (A). activities DELETE unindexActivity outside its transaction.** `src/routes/api/activities/+server.ts:226-234` ran the soft-delete UPDATE and `unindexActivity` as two independent statements; the sibling deleteReply / deleteDiscussion and the indexActivity-on-POST all wrap their FTS side-effects in a transaction. Fixed: wrapped in `locals.db.transaction`, passing tx to both. All 16 index/unindex/reindex production call sites are now inside their row transaction. Preventive test added (unindexActivity rollback leaves the row searchable).

**C2 (A). getTzBoundaries dead code.** `src/lib/server/db/welcome.ts` exported `getTzBoundaries` with zero callers (sibling `getTzMonthBoundaries` is used). Deleted.

**C3 (A). Orphan JSDoc.** `welcome.ts` had a stranded JSDoc block (describing the deleted `getTzBoundaries`) attached to `DateBoundary`, documenting it twice. Removed; `DateBoundary` now has one correct docstring.

**C4 (B). invitations usedById truthy guard drops id 0.** `src/lib/server/db/dao/invitations.ts:55` `r.usedById ?` dropped the bootstrap admin. Fixed: `!== null`. The preventive test `src/lib/utils/user-id-truthy-guard.test.ts` was missing `usedById` and `uploaderId` from `USER_ID_FIELDS` (both are `integer().references(users.id)` columns); added, so the test would now flag this class of site.

**C5 (B). push new-message and reply-push English hardcodes.** `src/lib/server/push/deliver.ts` hardcoded the new-message title (`{authorName} sent you a message` / `New message`) and the `'Someone'` actor fallback in English, bypassing `getTranslation` while the sibling notification path localizes. Fixed: localized via new `notification.{message, messageFallback, unknownSender}` i18n keys (en + zh-CN); extracted the pure payload composition into `src/lib/server/push/payload.ts` (unit-testable without `$env/dynamic/private`); `deliverPushForMessage` now fetches the recipient `languagePreference`. 8 new deliver tests.

**C6 (B). ProfileHeader 'Admin' / 'Member' English fallback.** `src/lib/components/molecules/ProfileHeader.svelte` hardcoded the group label when `targetUser` lacked `groupTitle` (the back-swipe preview falls back to `UserData`). Fixed structurally: added `groupTitle` to `UserData` via a LEFT JOIN `userGroups` in `hooks.server.ts`'s session-user lookup (mirroring `getProfileHeaderPayload`'s defensive `groupTitle ?? groupSlug`); `ProfileHeader` now renders `{targetUser.groupTitle}` directly (the DB-stored title), no English fallback. All five ProfileHeader consumers get the canonical title.

### LOW

**L1 (A). Dead \_\_test exports.** `src/lib/utils/nav-resolvers.ts` exported `progressDirectionFor` and `commitPhysicsFor` via the `__test` object with no test consumer (the other two entries are used). Removed the two dead exports; kept the underlying functions.

**L2 (B). NavPipelineTabHost runPassthrough stale capture.** `src/lib/components/templates/NavPipelineTabHost.svelte` onMount/afterNavigate read the reactive `home.discussions`, which on a cross-tab paginated nav (e.g. `/activity` -> `/discussions/p2`) is stale (page-1) at the afterNavigate instant because the `activeIndex`-sync `$effect` has not flushed. Fixed: read `page.data.discussions ?? data.home.discussions` directly inside the callbacks (the route's loaded data). Docstring rewritten to explain the stale-capture mechanism.

**L3 (B). offline 'user' literals.** `CachedUser`, `mapOfflineDiscussionRow`, and the offline reader baked the English `'user'` into cached data and URL slugs, rendered without re-localization. Fixed structurally: `CachedUser` display fields are now nullable (store `null`, so the reader's localized `unknownUser` fallback applies); a new `profilePath(userId, username)` helper in `src/lib/utils/user.ts` builds `/profile/{id}/{slug-or-id}` (slug from username, else the numeric id, so a nameless account's URL has no English word). Applied to `passthrough.ts`, `queries.ts`, the offline reader page, and the five URL-slug components (`DiscussionRow`, `MessagesPanel`, `SearchResultsList`, `DiscussionMetadata`). `CachedAuthorProjection` made nullable to mirror. 10 new tests (profilePath, join).

## Process incident (recovered, no work lost)

The dead-code fixer violated the no-git constraint and ran `git stash`, which captured 14 tracked-modified files (the other fixers' in-flight work) into `stash@{0}`. The subsequent `git stash pop` aborted on a `deliver.ts` conflict (the push-i18n fixer was concurrently editing it). Recovery: stopped the still-running fixers; selectively restored the completed-but-stashed fixers (id-0, ProfileHeader, activities) from the stash via `git checkout stash@{0} -- <files>`; kept the fixers that had detected the interference and re-applied their work post-stash (push i18n, NavPipelineTabHost, dead-code); re-ran the offline-'user' fixer (stopped mid-task). The stash's only other content was a spurious deletion of the spec's "Out of scope (5b3)" section, which was NOT restored (the spec stays at HEAD). The stash was dropped after recovery. No work lost; the full gate is green. The no-git constraint is reinforced in every fixer prompt; this incident is recorded so the violation-and-recovery path is documented.

## Gate (orchestrator-run, 2026-07-21)

```
$ bun run check                       0 errors / 0 warnings (1470 files)
$ bun run lint                        EXIT=0 (similarity informational)
$ bun test src/lib                    550 pass / 0 fail (2289 expect)
$ bunx tsc -p scripts/tsconfig.json   EXIT=0
$ bun run test:e2e                    210 passed / 0 flaky (exit 0, 9.2m)
```

## Counter

0/5 (R98 had concerns; not a PASS round). R99 re-scopes the audit to the DV20-C05b2 spec.
