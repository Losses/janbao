# RV04-C01-Audit-02: DV04 Cycle 1 - Round 2 Audit

**Date:** 2026-06-16
**Cycle:** C01 - Authentication & Entry
**Method:** 5 independent sub-agents re-audited the C01 scope after Round 1 fixes, each performing the full un-roled audit. Reports consolidated below.

**Round 2 Verdicts:** **1× PASS** (Agent 2, unconditional), **4× PASS_WITH_NOTES** (Agents 1, 3, 4, 5). All 13 Round-1 fixes CONFIRMED-FIXED by every agent; **no regressions**.
**Consolidated consensus: not yet unanimous PASS** - the four notes name actionable items (one is the verification gate itself); they were fixed and the Cycle re-audited in Round 3.

---

## 1. Round-1 fix verification (all 5 agents)

All 13 fixes CONFIRMED-FIXED (5/5), with several agents adding empirical evidence (libsql-tx rollback, throttle increment/block/prune, JWT alg-confusion rejection, `RETURNING count` post-increment). No fix was regressed or implemented incorrectly.

## 2. Findings raised in Round 2

### Actionable (fixed before Round 3)

| #    | Sev          | Issue                                                                                                                                                                                                                                                                           | Found by   | Fix applied                                                                                                   |
| :--- | :----------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------- | :------------------------------------------------------------------------------------------------------------ | --- | ----------------------- |
| R2-1 | MINOR (gate) | `docs/DV04-C01-Journal.md` failed Prettier → `bun run lint` red at the first stage, failing the §2.3 verification gate. (C01 **code** was clean.)                                                                                                                               | 1, 3, 4, 5 | `prettier --write` on the journal; lint now exit 0.                                                           |
| R2-2 | MINOR        | `usernameOrEmail` / `email` not length-capped before being used as the throttle identifier (and a `lower()` SQL arg) → unbounded DB-write surface on an unauthenticated endpoint.                                                                                               | 4          | Capped at 320 (login) / 254 (forgot) before the throttle call.                                                |
| R2-3 | MINOR        | Throttle prune ran on **every** call and was scoped to the current `bucket` only → avoidable hot-path write cost + stale rows for churned identifiers persist.                                                                                                                  | 3, 4       | Prune now runs on ~10% of calls (`Math.random() < 0.1`) and across **all** buckets (`windowEpoch < epoch-1`). |
| R2-4 | LOW          | `admin-generate-reset` `targetUserId` guard used `Number.isNaN(Number(targetUserId))`; `Number("")===0` so an empty/boolean/array body bypassed the numeric check and targeted id 0 (not exploitable - admin-gated + sentinel guards - but the guard did not match its intent). | 5          | Tightened to `typeof targetUserId !== 'number'                                                                |     | !Number.isFinite(...)`. |

### Accepted as carry-overs / conscious choices (not re-fixed; rationale recorded)

| #      | Item                                                                                                                                                                                                                      | Rationale                                                                                                                                                      | Found by |
| :----- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------- |
| R2-co1 | Throttle fails **closed**: a `auth_throttle` table error (e.g. table missing in a prod D1 that hasn't had migration `0008`) propagates → auth handler returns 500 → auth surface unavailable.                             | Conscious security choice (fail-closed on a rate-limit control beats fail-open, which an attacker could trigger to then brute-force).                          | 5        |
| R2-co2 | Production D1 has no in-repo migration runner (`drizzle/migrations/` empty; `drizzle.config.ts` uses d1-http, applied as a manual deploy step). Migration `0008` reaches prod via the next `bun run db:generate` + apply. | Existing deploy workflow; the `schema.ts` change drives prod migration generation. Documented as a deploy requirement, not a C01 code defect.                  | 5        |
| R2-co3 | `getClientAddressSafe` falls back to `'unknown'` when `getClientAddress()` throws/empty → all such clients share one throttle bucket.                                                                                     | On Cloudflare `CF-Connecting-IP` is always set (platform-injected, not spoofable); the `'unknown'` collapse is local/misconfigured-proxy only.                 | 4, 5     |
| R2-co4 | `forgot-password` is body-enumeration-safe but **not** timing-equalized (found user → `randomUUID` + insert + SMTP round-trip; not-found returns immediately).                                                            | Round-1 M1 was scoped to `login`; this is the pre-existing `forgot` posture and SMTP-latency variance makes a practical timing attack implausible. Carry-over. | 1        |
| R2-co5 | Throttle `count` grows within a window even after the limit is crossed.                                                                                                                                                   | Bounded - one row per `(bucket, identifier)`, naturally GC'd at each epoch boundary; row-size amplification only.                                              | 1, 2     |

---

## 3. Round 2 Conclusion

Every Round-1 fix is intact with no regressions. The four actionable Round-2 notes were all minor/hygiene; R2-1 (the lint gate) was the only one that independently blocked advancement. All four are fixed (Round 3 fixes), and the remaining items are documented carry-overs. **Proceeding to Round 3 re-audit** to seek 5/5 unconditional PASS.
