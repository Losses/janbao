# RV03-C03-Audit-02: DV03 Cycle 3 — Round 2 Audit

**Date:** 2026-06-16
**Method:** 5 independent sub-agents re-audited the DV03 feature after Round 1 fixes (working-tree state = HEAD `4017ef0` + uncommitted Round-1 fixes). The model gateway was in a sustained 529 outage; after a cooldown a probe confirmed recovery, then the remaining four were launched. Reports consolidated below.

**Round 2 Verdicts:** **3× PASS** (unconditional), **2× PASS_WITH_NOTES**. **Consolidated consensus: PASS_WITH_NOTES** — Round-1 fixes all CONFIRMED-FIXED; one new MAJOR (N1, system-sentinel reset leak) plus a consistency MINOR warranted fixing before declaring unanimous PASS.

---

## 1. Round-1 fix verification (all 5 agents agree)

| Fix                                              | Verdict                                                                                                                                                      |
| :----------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 reset-endpoint escalation                     | **CONFIRMED-FIXED** (5/5) — target groupSlug fetched; admin target blocked unless super-admin; `requireAdmin` used; UI `canResetTarget` mirrors server.      |
| C2 editReply disabled-category bypass            | **CONFIRMED-FIXED** (5/5) — `editReply` + `deleteReply` reply-fetch JOIN `isNull(categories.disabledAt)`; disabled-category reply 404s before author bypass. |
| M1 sub-page admin controls                       | **CONFIRMED-FIXED** (5/5) — both `/profile/discussions` and `/profile/comments` use `getProfileAdminSidebarData` + pass the 3 props.                         |
| M2 `targetUserId===0` falsy guard                | **CONFIRMED-FIXED** (5/5) — explicit `undefined`/`NaN` check.                                                                                                |
| M3 system-group protection (users/group)         | **CONFIRMED-FIXED** (5/5) — `isProtectedTarget` blocks `system` + self for everyone.                                                                         |
| M4 matrix mass-overwrite                         | **CONFIRMED-FIXED** (5/5) — `dirtyCategories` set; save sends only dirty rows; button gated on `hasDirty`.                                                   |
| m1 dead i18n keys                                | **CONFIRMED-FIXED** (4/5; one noted `admin.addCategory` is correctly retained — Round 1's `permissions.addCategory` was the dead one, correctly removed).    |
| m2 `BOOTSTRAP_ADMIN_ID` export                   | **CONFIRMED-FIXED** (5/5).                                                                                                                                   |
| m3 unused `ASSIGNABLE_RESERVED_USER_GROUP_SLUGS` | **CONFIRMED-FIXED** (5/5).                                                                                                                                   |
| m4 delete-group confirm modal                    | **CONFIRMED-FIXED** (5/5).                                                                                                                                   |

**No regressions reported by any agent.**

---

## 2. New findings (Round 2)

### N1 (MAJOR) — system sentinel resettable via the reset endpoint

_(Found by Agent probe; consistent with M3's spirit)_

`src/routes/api/auth/admin-generate-reset/+server.ts` Round-1 fix blocked only `groupSlug === 'admin'`. A peer admin could still POST `targetUserId: -1` (the `system` sentinel) and mint a 48h reset link, then complete the reset flow to set a real password on the system user. While the system user holds no admin group, this is the same privilege-leak family as C1 and inconsistent with the M3 fix that protects `system` in `users/group`.

**Fix applied:** extended the guard to block `system` unconditionally (no one resets the system sentinel) and `admin` unless super-admin.

### N2 (MINOR) — `canManageTargetGroup` client gate didn't exclude `system`

_(Found by Agent B5)_

`ProfileSidebar.svelte` `canManageTargetGroup` excluded only `'admin'`. The server already blocks moving a `system` user, so this was UX-only (a peer admin viewing the system sentinel would see a dropdown that 403s on change).

**Fix applied:** added `targetUserGroupSlug !== 'system'` to `canManageTargetGroup` for client/server parity.

### Carry-over (non-blocking, listed by PASS agents too — not fixed)

- **m5**: permissions-matrix `$effect` rebuilds draft on any `invalidateAll()` → could discard in-progress toggles. Multiple agents deemed acceptable ("matches navigate-away semantics"). Not fixed.
- **m7**: `users/group` read-then-write TOCTOU. Deemed low-risk on low-concurrency SQLite. Not fixed (deliberately kept the diff minimal).
- **m9**: `upsertCategoryPermissions` N sequential inserts. Adequate. Not fixed.
- **m10**: similarity-ts type overlap (informational). Not fixed.

---

## 3. Round 2 Action & Verification

**Fixes applied:** N1 (system-sentinel reset protection) + N2 (client-side `system` exclusion). m5/m7/m9/m10 deliberately left (non-blocking, judged acceptable by multiple PASS agents).

**Verification after fixes:**

- `bun run check` — 0 errors, 0 warnings
- `bun run lint` — exit code 0 (full chain, incl. docs)
- All Round-1 fixes remain CONFIRMED-FIXED; no regressions.

**Status:** Round 2 fixes applied and verified. Proceeding to Round 3 re-audit to seek unanimous unconditional PASS.
