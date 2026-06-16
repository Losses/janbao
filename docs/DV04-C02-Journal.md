# DV04-C02-Journal: Cycle 2 Audit Journal - Discussion Core

## Cycle 2: Discussion Core (read & write)

**Date:** 2026-06-16
**Status:** ✅ CLOSED - 5/5 unconditional PASS (Round 2)

---

## 1. Scope

Discussion list, detail, reply/edit/delete actions, post & editDiscussion, and the FTS reindex + content-render surface:

- List: `src/routes/discussions/+page.server.ts`, `src/routes/discussions/[[page=page]]/+page.server.ts`
- Detail + write actions: `src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.{server,svelte}` (`load` + actions `reply`, `togglePin`, `editReply`, `deleteReply`, `deleteDiscussion`); bare-path redirect `src/routes/discussion/[discussionId]/+page.server.ts`
- Post/edit: `src/routes/post/discussion/+page.{server,svelte}`, `src/routes/post/editDiscussion/[discussionId]/+page.{server,svelte}`
- DAO: `src/lib/server/db/dao/discussions.ts`, `src/lib/server/db/dao/comments.ts`
- FTS: `src/lib/server/search/**` (reindex on create/update/delete), `src/lib/server/db/dao/search.ts`
- Render/XSS: `src/lib/components/molecules/LexicalRenderer.svelte`; permissions in `src/lib/server/constants.ts`

---

## 2. Method

Per DV04-Plan §2: each round, **5 independent sub-agents run the same full un-roled audit**; consolidate into `RV04-C02-Audit-[round].md`; advance only on 5/5 unconditional PASS. Gate each round: `bun run check` 0/0 + `bun run lint` exit 0.

---

## 3. Audit Round 1 - 2026-06-16

Consolidated → [RV04-C02-Audit-01.md](./RV04-C02-Audit-01.md).
**Verdicts:** 0× PASS, 5× PASS_WITH_NOTES. **Consensus: FAIL.**

**Issues found and fixed (Round 2 fixes):**

- **MAJOR (5/5)** - Bare-path redirect `/discussion/[id]` leaked the slug (title-derived) of a disabled/forbidden-category discussion via the 302 `Location` header - the one read path that skipped `resolvePermissions` + the `isNull(categories.disabledAt)` filter. Fix: JOIN `categories` + disabledAt filter + `resolvePermissions(...).canRead` gate before redirect; also added the disabledAt JOIN to the `editDiscussion` load/update fetches for uniform "disabled-category discussion is unreachable" semantics.
- **MINOR** - `deleteReply` decremented `commentCount` with no floor (`commentCount - 1`); drift/race could drive it negative. Fix: `MAX(commentCount - 1, 0)`.
- **MINOR** - `reply` action ran `dispatchReplyNotifications` outside the tx with no try/catch; a notification blip turned a committed reply into a user-facing 500 (and risked a duplicate on resubmit). Fix: wrapped dispatch in try/catch + log.
- **MINOR** - Detail `+page.svelte` cast a reply action result with an inline object type, violating no-inline-typing. Fix: extracted a named `ReplyActionResult` interface.

**Carry-overs (documented, accepted):** view-count has no idempotency (cosmetic metric, needs a product decision); `editReply` author-bypass overrides a tightened category matrix (intentional policy); latest-replier self-join tie-break non-determinism (cosmetic); unread-count in-memory scan (perf); detail page duplicates `parsePagePathParam` (consistency); `<img>` lacks `referrerPolicy` (defense-in-depth); falsy-on-zero id guards (latent, ids ≥ 1); reply page-redirect count race (cosmetic).

**DV03/pre-known verified intact (5/5):** DV03 C2 editReply/deleteReply disabled-category JOIN; FTS reindex uses OLD+NEW text with no `DELETE FROM`; XSS render path safe (`safeUrl` allowlist, no `{@html}`); per-action authorization uniform and IDOR-free; editDiscussion category-move checks `canCreate` on the new category.

**Verification after Round 2 fixes:** `bun run check` 0/0; `bun run lint` exit 0.

**Status:** Round 2 fixes applied and verified. Proceeding to Round 2 re-audit to seek 5/5 unconditional PASS.

---

## 4. Audit Round 2 - 2026-06-16 (FINAL)

Consolidated → [RV04-C02-Audit-02.md](./RV04-C02-Audit-02.md).
**Verdicts:** 5× PASS (Agents 1, 2, 3, 4, 5 - all unconditional). All Round-1 fixes CONFIRMED (C2-1 slug leak closed, C2-3 floor, C2-5 try/catch, C2-9 named interface, editDiscussion JOINs); DV03 C2 intact; no regressions; no new actionable defects. Each agent independently re-ran the gate (`bun run check` 0/0, `bun run lint` exit 0).

Two non-actionable observations (out-of-scope / carry-over): `LexicalRenderer` hardcoded dead-image string (→ C07 i18n); `themeName` not server-allowlisted (defense-in-depth, `data-theme` only, no script execution). Neither blocks C02.

**Status: ✅ UNANIMOUS PASS - C02 audit loop closed.** All five agents consider Cycle 2 (Discussion Core) complete and clean for its scope. C02 converged in 2 rounds (vs C01's 5) - C01 had hardened the cross-cutting infra (throttle, escape, doc-pipe discipline) and DV03 had already done most of the disabled-category work, leaving C02 with one real MAJOR plus minor hardening.

**Cycle 2 complete. Advancing to Cycle 3 (Categories + RSS + Search).**
