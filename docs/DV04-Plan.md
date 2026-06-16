# DV04-Plan: Full-System Audit (Route-Aligned, Multi-Cycle)

## 1. Executive Summary

DV00–DV03 delivered and self-audited the forum **feature by feature**. DV04 is different: it is a **system-wide audit of the entire program as it stands today**, partitioned by the route structure into seven sequential **Audit Cycles**. Each Cycle covers one system function (a coherent cluster of routes + its `+page.server.ts` form actions + its `/api` endpoints + its DAO + its i18n + its components + the cross-cutting concerns it touches).

The audit is performed by an **adversarial 5-agent loop** per Cycle:

- **5 independent sub-agents run in parallel**, each one performing the **complete audit of the Cycle's scope**.
- **No roles are assigned.** Every agent receives the _same_ full-audit task (security, correctness, authorization, input validation, pagination, i18n, type/lint discipline, performance, accessibility). There is no "the security agent" or "the perf agent" - that division of labour is explicitly forbidden. Five full audits, then consensus.
- The five reports are consolidated into `RV04-C[NN]-Audit-[round].md`. If any agent withholds an **unconditional PASS**, the reported issues are **fixed**, the verification gate (`bun run check` + `bun run lint`) is run, and **five fresh agents re-audit** in the next round (`Audit-02`, `Audit-03`, …).
- A Cycle only **advances** when all five agents return **unconditional PASS**. `PASS_WITH_NOTES` is **not** unconditional pass - a note that names a real defect keeps the Cycle open.

This mirrors the mechanism DV03 used inside its C03 (RV03-C03-Audit-01→02→03, FAIL → 5/5 unconditional PASS), but applied to the whole codebase as a standing review rather than to one feature diff.

---

## 2. Audit Methodology

### 2.1 Per-Cycle loop

```
for each Cycle C[NN]:
    write DV04-C[NN]-Journal.md            (Cycle log: scope, method, each round's outcome)
    round = 1
    do:
        launch 5 agents in parallel         (same full-audit prompt, independent contexts)
        consolidate → RV04-C[NN]-Audit-{round}.md
        if all 5 == unconditional PASS:
            break (Cycle closed → next Cycle)
        else:
            fix every actionable finding (CRITICAL/MAJOR + accepted MINORs)
            run  bun run check  +  bun run lint   (must be 0/0 and exit 0)
            round += 1
    while not unanimous-pass
```

### 2.2 Verdict semantics (consolidation rules)

| Verdict             | Meaning                                              | Advances Cycle?        |
| :------------------ | :--------------------------------------------------- | :--------------------- |
| **PASS**            | Unconditional. No actionable defects in scope.       | counts toward 5/5      |
| **PASS_WITH_NOTES** | Notes name real, actionable defects (even if minor). | **No** - fix, re-audit |
| **FAIL**            | CRITICAL/MAJOR defects present.                      | No - fix, re-audit     |

Consolidation deduplicates findings across agents, cross-references _who found what_ (independent corroboration raises severity confidence), and explicitly lists **carry-overs** deliberately not fixed (judged acceptable, with rationale) so they are not re-reported every round.

### 2.3 Verification gate (applied after every fix round)

- `bun run check` → **0 errors, 0 warnings**
- `bun run lint` (prettier → eslint → similarity-ts) → **exit 0**
- Any throwaway data created while verifying a fix is cleaned via libsql; local DB restored to baseline.

### 2.4 What every agent audits (full, un-roled checklist)

Each agent independently applies **all** of the following to the Cycle's scope:

1. **Authorization / access control** - every `load`, form action, and `/api` method checks the caller's identity and group permissions; no IDOR; ownership checks before read/write; admin guards present and correct; super-admin / system-sentinel rules intact.
2. **Input validation & injection** - request bodies / params validated (type, length, regex, enum); SQL via Drizzle (no string concatenation); path-traversal on `[fileId]`/`[userId]`; XSS through `contentJson` render path; SSRF / open redirect.
3. **Auth & session** - JWT signed/verified correctly; expiry honoured; reset-token entropy, expiry, single-use; cookie flags (`httpOnly`/`secure`/`sameSite`); logout semantics for stateless JWT; enumeration timing on login/forgot.
4. **Soft-delete / disabled-category propagation** - disabled categories and soft-deleted rows are unreachable on every read path (list, count, detail, RSS, search, bookmarks, write actions, notifications) _outside_ the admin UI.
5. **Pagination** - uses `parseDiscussionPagination`; cursor/keyset correctness; negative-id cursor handling (FTS); off-by-one; total-pages.
6. **i18n** - key parity between `en.json` and `zh-CN.json`; no dead keys; `{email}`/`{link}` interpolation safe; user-facing strings never hard-coded in component/api.
7. **Types & lint** - no inline typing, `interface` first, named callback types from `$lib/types/handlers`; `as any`/`as unknown as` absent; similarity-ts type-pairs not regressed.
8. **Correctness** - race conditions / TOCTOU; `$effect` fetch loops (store load+refresh split); transaction boundaries; Drizzle date-aggregate gotchas; timestamp units (seconds).
9. **Performance** - N+1 queries; per-request seeding cost; missing indexes implied by WHERE/JOIN; unbounded result sets.
10. **Accessibility & UX** - confirm modals on destructive actions (no bare `alert`/`confirm`); empty states; keyboard/aria where relevant.

---

## 3. Audit Cycles

### Cycle 1 (C01) - Authentication & Entry

- **Scope:** `/entry/{signin,signout,register,forgot,reset-password}/*`; `/api/auth/{login,logout,register,forgot-password,reset-password,admin-generate-reset}/+server.ts`; invitation generation `/api/invitations/{request,+server.ts}` and redemption in `register`; the auth primitives `src/lib/server/auth.ts` (JWT sign/verify, PBKDF2), `src/hooks.server.ts` (session cookie → `event.locals.user`, `lastActiveTime`, per-request `seedCore`), `src/lib/server/db/dao/invitations.ts`, and the `passwordRecoveries` / `invitations` tables.
- **Audit focus:** JWT secret source & algorithm, token TTL/expiry enforcement, reset-token entropy + expiry + single-use, invitation monthly limits & expiry, password strength rules, login/forgot enumeration timing, cookie flags, logout semantics for stateless JWT (cannot revoke?), and the **admin-generate-reset target-group guard** (DV03 C1 - must reject admin/system targets unless caller is super-admin).
- **Exit:** 5/5 unconditional PASS.

### Cycle 2 (C02) - Discussion Core (read & write)

- **Scope:** `/discussions/[[page=page]]` + `/discussions` redirect; `/discussion/[discussionId]/[slug]/[[page=page]]/+page.server.ts` (`load` + actions `reply`, `togglePin`, `editReply`, `deleteReply`, `deleteDiscussion`); `/post/discussion/*`, `/post/editDiscussion/[discussionId]/*`; DAO `discussions.ts`, `comments.ts`, and the FTS reindex surface in `search.ts`.
- **Audit focus:** per-action permission checks (`canCreate`/`canUpdate`/`canDelete` + author bypass + disabled-category), `editReply`/`deleteReply` disabled-category JOIN (DV03 C2), pin = admin-only, view-count increment idempotency, `contentJson` XSS render, draft clear-after-submit, **FTS reindex old+new text** and no-`DELETE FROM` gotchas, `editDiscussion` category-change permission.
- **Exit:** 5/5 unconditional PASS.

### Cycle 3 (C03) - Discovery: Categories + RSS + Search

- **Scope:** `/category/[categorySlug]/[[page=page]]/+page.server.ts`, `/category/[categorySlug]/rss/+server.ts`, `/categories/+page.server.ts`, `/api/categories/+server.ts`, `/search/*` + search DAO (`search.ts`, contentless FTS5 trigram); category-readable-slug resolution in `src/lib/server/constants.ts`.
- **Audit focus:** disabled-category filtering on list / single (404) / RSS / `/api/categories`, permission-based read filtering, RSS `rssToken` auth & per-user scoping, **FTS negative-id cursor + contentless trigram** gotchas, search-scope authorization (no leaking from disabled categories or private conversations), pagination bounds.
- **Exit:** 5/5 unconditional PASS.

### Cycle 4 (C04) - User Profile

- **Scope:** `/profile/[userId]/[userSlug]/*`; `/profile/{edit,password,preferences,picture}/+page.server.ts` + `/api/profile/{edit,password,preferences,stealth}/+server.ts`; `/profile/{comments,discussions}/[userId]/[userSlug]/+page.server.ts`; `/profile/{invitations,onlineNow}/*`; DAO `comments.ts`, `admin-permissions.ts` (`getProfileAdminSidebarData`), `invitations.ts`.
- **Audit focus:** IDOR on edit/password/preferences (must be self), password-change requires current password, stealth toggle, slug-change redirect correctness, view-count, **target-email leak prevention** (admin-only fetch, never in public payload), profile-comment → notification creation, sub-page admin-sidebar props parity (DV03 M1).
- **Exit:** 5/5 unconditional PASS.

### Cycle 5 (C05) - User Dashboards (PM / Notifications / Bookmarks / Activity)

- **Scope:** `/messages/{inbox,new,[id]/[[page=page]]}/+page.server.ts` + `/api/messages/{,+server.ts,recent}` + conversation actions (`addParticipant`, `post`, `editMessage`); `/notifications` + `/api/notifications/+server.ts` (GET/PUT); `/bookmarks` + `/api/bookmarks/+server.ts` (GET/POST/DELETE); `/activity` + `/api/activities/comments/+server.ts`; DAO `messages.ts`, `notifications.ts`, `bookmarks.ts`.
- **Audit focus:** PM participant authorization (cannot read others' conversations), conversation soft-delete, notification read-marking own-only, bookmark own-only + readable-category filter (DV03 carry-over), activity-comment permission, **mention → notification** creation, pagination.
- **Exit:** 5/5 unconditional PASS.

### Cycle 6 (C06) - Admin & Permissions (fresh full re-audit)

- **Scope:** `/admin/{+layout,+page,user-groups,categories,permissions}/*` (layout-level admin guard); `/api/admin/{user-groups,categories,category-permissions,users/group,users}/+server.ts`; DAO `admin-permissions.ts`; guard `src/lib/server/admin.ts`.
- **Note:** This is the DV03 feature surface. The Cycle audits it **fresh and in full**, but the report cross-references DV03's already-closed items (`RV03-C03-Audit-03`: C1/C2, M1–M4, m1–m10) to avoid re-reporting settled issues; only regressions, new boundaries, or genuinely missed defects are actioned.
- **Audit focus:** `requireAdmin` on every endpoint, super-admin (id 0) rule, system-sentinel (`SYSTEM_USER_ID`) protection, reserved-slug guards, group-with-members delete block, matrix dirty-save (M4), client/server parity, `targetUserId === 0` falsy guard (M2).
- **Exit:** 5/5 unconditional PASS.

### Cycle 7 (C07) - Media Serving/Upload + Cross-cutting

- **Scope:** `/avatar/[userId]/+server.ts`, `/attachment/[fileId]/+server.ts`, `/upload/+server.ts`; `/api/users/{online,search}/+server.ts`; and the **cross-cutting** layer: `src/hooks.server.ts`, `src/lib/server/{constants,errors,i18n,pcloud,image}.ts`, `src/lib/i18n/{en,zh-CN}.json` parity, `src/lib/types/{api,handlers}.ts`, `src/routes/+layout.{svelte,server.ts}`, `src/routes/admin/+layout.*`, `src/lib/stores/*.svelte.ts`, and the Lexical render/XSS path (`LexicalEditor`/`LexicalRenderer`/`utils/mentions.ts`).
- **Audit focus:** upload size/type validation & content sniffing + `nosniff`, avatar/attachment authorization (no fetching others' private media), path traversal / SSRF via pCloud, **i18n key parity & interpolation safety**, **`$effect` fetch-loop safety** in runes stores, `seedCore` per-request cost, type/lint discipline repo-wide.
- **Exit:** 5/5 unconditional PASS.

---

## 4. Cycle Sequencing & Dependencies

Cycles are **strictly sequential**: C01 → C02 → … → C07. A Cycle begins only after the previous Cycle reaches 5/5 unconditional PASS. This ordering is deliberate - C01 (auth) and the cross-cutting primitives underpin every later Cycle, so confirming them first raises the value of later audits.

---

## 5. Known Architecture Constraints (to verify, not assume)

Audit agents treat these as **hypotheses to confirm by reading the code**, not as given facts:

- **Auth:** stateless JWT (`session_token` cookie, HMAC-SHA256, 24h/30d by `rememberMe`); PBKDF2-SHA256 100k iterations; no sessions table → logout is cookie-clear only.
- **Identity sentinels:** `BOOTSTRAP_ADMIN_ID = 0` (super-admin), `SYSTEM_USER_ID = -1`, `GHOST_USER_ID = -2`.
- **Timestamps:** all schema timestamps are **seconds** (`mode: 'timestamp'`); a `*1000` default corrupts rows; `sql<Date>MAX(...)` bypasses conversion → use the typed column.
- **FTS:** contentless FTS5 + trigram, app-layer sync (no triggers); never `DELETE FROM`; negative-id cursor; reindex needs old + new text.
- **Local DB:** `@libsql/client` (not `bun:sqlite`); WAL mode; migrations run without stopping the dev server.
- **Media:** pCloud **WebDAV** (not REST), base `/Janbao`; `contentType` stored in DB + streamed serve; import-time `cwebp`.
- **Stores:** Svelte 5 runes; widget stores use load(effect)+refresh(afterNavigate) to avoid the `$effect` fetch loop.
- **Permissions:** `resolvePermissions()` returns all-false for disabled/missing categories; `getReadableCategorySlugs()` returns enabled slugs only.

---

## 6. Documents Produced

| Document                      | When                               |
| :---------------------------- | :--------------------------------- |
| `DV04-Plan.md`                | This file (once, up front).        |
| `DV04-C[NN]-Journal.md`       | One per Cycle; updated each round. |
| `RV04-C[NN]-Audit-[round].md` | One per audit round per Cycle.     |

A Cycle's Journal records scope, the 5-agent method, each round's verdicts and consolidated findings, the fixes applied, and the verification-gate result - same shape as `DV03-C03-Journal.md` §5–7.

---

## 7. Acceptance Criteria for DV04

All seven Cycles reach **5/5 unconditional PASS**, each closed by an `RV04-C[NN]-Audit-[final].md` whose consolidated verdict is unanimous PASS. The working tree passes `bun run check` (0/0) and `bun run lint` (exit 0) at the end of every round. Carry-over items (deliberately not fixed, judged acceptable) are enumerated once per Cycle with rationale and not re-litigated.
