# RV04-C02-Audit-01: DV04 Cycle 2 — Round 1 Audit

**Date:** 2026-06-16
**Cycle:** C02 — Discussion Core (read & write)
**Method:** 5 independent sub-agents, each performing the full un-roled audit of the C02 scope. No roles assigned. Reports consolidated below.

**Round 1 Verdicts:** **0× PASS**, **5× PASS_WITH_NOTES**. All five withhold unconditional PASS.
**Consolidated consensus: FAIL** — one unanimous MAJOR plus a consistent set of MINORs.

---

## 1. Findings (deduplicated, with finders)

### MAJOR

- **C2-1 (unanimous 5/5):** The bare-path redirect `src/routes/discussion/[discussionId]/+page.server.ts:13-24` resolves a discussion by id filtering only `isNull(discussions.deletedAt)` — it does **not** JOIN `categories` or filter `isNull(categories.disabledAt)`, and does **not** call `resolvePermissions`. It then issues a `302 Location: /discussion/<id>/<slug>` carrying the stored slug (= `generateSlug(title)`). A discussion in a **disabled** category (or one the caller cannot read) still resolves here, so its title-derived slug is leaked via the redirect — the one read path in C02 that bypasses the centralized permission resolver and the disabled-category filter. The detail `load` at `[slug]/[[page=page]]` does 404 on disabled categories, so no body leaks — but the slug is disabled-category metadata that should not be reachable. This is the pre-known item flagged outside DV03; **confirmed still leaking.** Fix: JOIN `categories` + `isNull(categories.disabledAt)` and gate on `resolvePermissions(...).canRead`, returning 404/403 before the redirect. (Agent 2 also notes the same missing-JOIN shape in the `post/editDiscussion` load/update fetches — those are functionally blocked by `resolvePermissions` returning all-false for disabled → 403, so no leak, but adding the filter is consistent defense-in-depth.)

### MINOR (fixed this round)

- **C2-3 (Agents 2, 3):** `deleteReply` decrements `commentCount` with raw SQL `commentCount - 1` and no floor; drift/race can drive it negative. Fix: `MAX(commentCount - 1, 0)`.
- **C2-5 (Agents 2, 3):** `reply` action runs `dispatchReplyNotifications` **outside** the transaction with no try/catch; a notification-insert blip turns a successfully-committed reply into a user-facing 500 (and risks a duplicate on resubmit). Fix: wrap dispatch in try/catch + log; the reply is already committed.
- **C2-9 (Agent 5):** the detail `+page.svelte` casts an action result with an inline object type (`as { success?: boolean; error?: string; ... }`) — violates the no-inline-typing / interface-first rule. Fix: extract a named interface.

### MINOR (carry-overs — documented, not fixed; rationale recorded)

- **C2-2 (1, 2, 4):** `viewCount` increments on every GET with no idempotency (refresh/bot inflation). Cosmetic metric; a robust fix needs a product decision on what "a view" means (guests have no read-row to dedup against). Accepted.
- **C2-4 (4):** `editReply` author-bypass overrides a category matrix later tightened to `canUpdate=false` (the author can keep editing their own reply). Intentional author-bypass policy; not an exploit. Accepted.
- **C2-6 (1):** "latest reply author" self-join ties on `MAX(createdAt)` only; same-second inserts make the displayed last-replier non-deterministic. Cosmetic. Accepted.
- **C2-7 (1):** unread-count path loads all non-deleted replies of read threads into memory (bounded by page size × replies-per-thread, but unbounded per-thread). Perf; deferred to a perf pass.
- **C2-8 (1, 4):** detail `load` page parsing duplicates `parsePagePathParam` instead of calling it. Consistency nit; functionally correct. Accepted.
- **C2-10 (3):** `<img>` render lacks `referrerPolicy="no-referrer"` (cross-origin tracking nit; not exploitable — Svelte binds `src` as an attribute, no script injection). Defense-in-depth. Accepted.
- **C2-11 (5):** falsy-on-zero guards on `replyId`/`discussionId` (latent foot-gun; not exploitable since ids are ≥ 1). Accepted.
- **C2-12 (3, 4):** `reply` action computes the destination page from a count query outside the tx; a concurrent reply can land the redirect one page off. Cosmetic. Accepted.

---

## 2. DV03 / pre-known verification (all 5 agents)

- **DV03 C2 (editReply/deleteReply disabled-category JOIN): CONFIRMED INTACT (5/5).** Both actions JOIN `discussions` + `categories` and filter `isNull(replies.deletedAt)`, `isNull(discussions.deletedAt)`, `isNull(categories.disabledAt)`; a disabled-category reply 404s before the author-bypass. No regression.
- **FTS reindex correctness: CONFIRMED (5/5).** OLD+NEW text captured in-transaction before the UPDATE; contentless `'delete'` command used (never `DELETE FROM`); `rebuildFtsTable` DROPs+CREATEs. editDiscussion reindexes old vs new correctly.
- **XSS render path: CONFIRMED SAFE (5/5).** `LexicalRenderer` uses Svelte auto-escaping (no `{@html}`); `safeUrl` allowlists `http(s)://`, same-origin `/`, `./`, `../`, `#` — rejects `javascript:`, `data:`, protocol-relative. Mention chips resolved from a server map, not raw stored usernames.
- **Per-action authorization: CONFIRMED (5/5).** Every action re-resolves `resolvePermissions` against the discussion's current `categorySlug` and checks the right flag; `discussionId`/`replyId` re-fetched from DB (no IDOR); author-bypass scoped to own reply; `togglePin`/`deleteDiscussion` `canDelete`-gated; editDiscussion category-move checks `canCreate` on the new category.
- **Pagination, draft scoping, soft-delete filtering: CONFIRMED clean.**

---

## 3. Round 1 Action Plan

Fix **C2-1** (bare-path redirect leak + editDiscussion fetch consistency) → **C2-3** (commentCount floor) → **C2-5** (notification dispatch try/catch) → **C2-9** (named interface). Carry over C2-2/4/6/7/8/10/11/12 with rationale. Run `bun run check` + `bun run lint`. Then re-audit (Round 2).
