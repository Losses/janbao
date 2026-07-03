# RV04-C07-Audit-02: DV04 Cycle 7 - Round 2 Audit (FINAL)

**Date:** 2026-06-16
**Cycle:** C07 - Media Serving/Upload + Cross-cutting
**Method:** 5 independent sub-agents re-audited the C07 scope after Round 1 fixes, each performing the full un-roled audit. Reports consolidated below.

**Round 2 Verdicts:** **5× PASS** (unconditional) - Agents 1, 2, 3, 4, 5. All five Round-1 fixes CONFIRMED; the Round-2 AVIF `mif1` tightening (excluding the HEIC-colliding brand) resolved Agent 1's lone note; no regressions; no new actionable defects.
**Consolidated consensus: UNANIMOUS PASS. Audit loop closed. DV04 complete.**

---

## 1. Final fix verification (all 5 agents)

- **C7-1**: `image expired` hardcoded string fully i18n'd - `LexicalRenderer` `deadImageLabel` prop (English default) threaded from all 9 call sites; `DeadImageNode` module `deadImageLabel` + `setDeadImageLabel` set by `LexicalEditor`'s `$effect`; `img.deadImage` key in en + zh. No hardcoded Chinese literal remains (only the legitimate zh-CN translation value).
- **C7-AVIF**: `detectImageFormat` detects AVIF via ISOBMFF `ftyp` box + `avif`/`avis` brand (the `mif1` brand was tightened to exclude HEIC collision in Round 2 per Agent 1's note). `image/avif` MIME; advertised AVIF support now works end-to-end.
- **C7-2**: `search.tooShortHint` dead key removed from en + zh.
- **C7-5**: upload sniff accumulates up to 12 bytes across chunks before `detectImageFormat`.
- **C7-6**: `pcloudMkcol('/tmp')` gated by per-isolate `tmpEnsured` flag.
- **Verification gate GREEN** - every agent re-ran `bun run check` (0/0) and `bun run lint` (exit 0).

## 2. Findings raised in Round 2

**None actionable.** All five agents returned unconditional PASS. Non-actionable observations:

- Agent 2: stale comment in `hooks.server.ts` ("bun:sqlite fallback" - the local DB is libsql per MEMORY). Comment-only.
- Agent 4: `pcloudMkcol` only throws on 401; other non-success codes are swallowed so `tmpEnsured` could be set true on a transient pCloud 5xx. Self-healing (next isolate retries); no data-integrity impact. Below carry-over threshold.

## 3. Carry-overs (final, accepted for C07)

1. `themeName` not server-allowlisted (defense-in-depth; `setAttribute` XSS-safe).
2. `seedCore` cold-start sequential inserts (perf; `seeded`-bounded).
3. attachment route public-by-sha (DB-gated; intended; sha256 unguessable).
4. avatar route user-existence enumeration (public by design).
5. upload `isAvatar` via client header (advisory size cap).
6. entry-route password literal `8` (C01 scope; value matches).
7. user-search LIKE `%`/`_` not escaped (functional quirk; parameterized).
8. `seedCore` error swallow (self-healing idempotent retry).

## 4. Round 2 Conclusion

**DV04 Cycle 7 (Media + Cross-cutting) is unanimously considered complete and clean.** All five agents rendered an unconditional PASS; the gate is green; the two MAJORs + three MINORs from Round 1 are fixed and re-verified (with the Round-2 AVIF `mif1` tightening closing Agent 1's note). The upload pipeline, media serving, pCloud client, i18n parity, Svelte 5 runes stores, Lexical XSS path, and cross-cutting infra all hold. **C07 advances. Audit loop closed.**

---

## Appendix: C07 fix summary (Round 1 + Round 2)

- **C7-1 (MAJOR, R1):** dead-image i18n - `img.deadImage` key + `LexicalRenderer` `deadImageLabel` prop (9-site thread) + `DeadImageNode` module setter + `LexicalEditor` `$effect`.
- **C7-AVIF (MAJOR, R1+R2):** AVIF magic-byte detection (`ftyp` + `avif`/`avis`); `mif1` excluded in R2 to prevent HEIC mislabeling.
- **C7-2 (MINOR, R1):** removed `search.tooShortHint` dead i18n key.
- **C7-5 (MINOR, R1):** upload sniff buffer accumulates 12 bytes across chunks.
- **C7-6 (MINOR, R1):** `pcloudMkcol('/tmp')` per-isolate `tmpEnsured` flag.
