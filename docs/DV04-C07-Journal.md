# DV04-C07-Journal: Cycle 7 Audit Journal - Media + Cross-cutting

## Cycle 7: Media Serving/Upload + Cross-cutting

**Date:** 2026-06-16
**Status:** ✅ CLOSED - 5/5 unconditional PASS (Round 2)

---

## 1. Scope

Media serving/upload, the users API, and the cross-cutting layer:

- Media: `src/routes/avatar/[userId]/+server.ts`, `src/routes/attachment/[fileId]/+server.ts`, `src/routes/upload/+server.ts`; `src/lib/server/{pcloud,image}.ts`
- Users API: `src/routes/api/users/{online,search}/+server.ts`
- Cross-cutting: `src/hooks.server.ts`; `src/lib/server/{constants,errors,i18n}.ts`; `src/lib/i18n/{en,zh-CN}.json`; `src/lib/types/{api,handlers}.ts`; `src/routes/+layout.{svelte,server.ts}`; `src/routes/admin/+layout.*`; `src/lib/stores/*.svelte.ts`; Lexical render/XSS: `src/lib/components/{molecules/LexicalRenderer,organisms/LexicalEditor}.svelte`, `src/lib/components/atoms/DeadImageNode.ts`, `src/lib/utils/{mentions,lexical}.ts`

---

## 2. Method

Per DV04-Plan §2: 5 independent sub-agents run the same full un-roled audit; advance only on 5/5 unconditional PASS. Gate each round: `bun run check` 0/0 + `bun run lint` exit 0.

---

## 3. Audit Round 1 - 2026-06-16

Consolidated → [RV04-C07-Audit-01.md](./RV04-C07-Audit-01.md).
**Verdicts:** 0× PASS, 5× PASS_WITH_NOTES. **Consensus: FAIL.**

**Issues found and fixed (Round 2 fixes):**

- **MAJOR (5/5)** - Hardcoded Chinese dead-image string `图片已失效` in `LexicalRenderer.svelte` + `DeadImageNode.ts` (English users saw Chinese for imported dead images). Fix: `img.deadImage` i18n key (en/zh); `LexicalRenderer` `deadImageLabel` prop (English default) threaded from all 9 call sites; `DeadImageNode` reads a module label set by `LexicalEditor` via `setDeadImageLabel`.
- **MAJOR (Agent 1)** - AVIF advertised (i18n/`<input accept>`/toolbar) but `detectImageFormat` had no AVIF branch → AVIF uploads rejected. Fix: AVIF magic-byte detection (`ftyp` box + `avif`/`avis`/`mif1` brand) + `image/avif` MIME.
- **MINOR (4)** - dead i18n key `search.tooShortHint`. Removed (en + zh).
- **MINOR (2)** - upload type-sniff only on first chunk; sub-12-byte chunk mis-detected WebP/AVIF. Fix: accumulate up to 12 bytes into a sniff buffer before detecting.
- **MINOR (1)** - `pcloudMkcol('/tmp')` ran every upload. Fix: per-isolate `tmpEnsured` flag.

**Carry-overs (documented, accepted):** `themeName` not server-allowlisted (defense-in-depth, `setAttribute` XSS-safe); `seedCore` cold-start sequential inserts (perf, `seeded`-bounded); attachment route public-by-sha (DB-gated, intended); avatar existence enumeration (public by design); upload `isAvatar` via client header (advisory); entry-route password literal `8` (C01 scope, value matches); user-search LIKE `%`/`_` not escaped (functional quirk); `seedCore` error swallow (self-healing retry).

**Cross-cutting verified intact (5/5):** upload pipeline (size/sniff/sha/nosniff/atomic-move); avatar/attachment serving (nosniff, DB content-type, no traversal); pCloud injection-free; i18n parity exact; Svelte 5 runes stores loop-safe; Lexical XSS `safeUrl` allowlist; admin/auth layout gating; JWT secret fail-closed; no `as any`.

**Verification after Round 2 fixes:** `bun run check` 0/0; `bun run lint` exit 0.

**Status:** Round 2 fixes applied and verified. Proceeding to Round 2 re-audit to seek 5/5 unconditional PASS (final cycle).

---

## 4. Audit Round 2 - 2026-06-16 (FINAL)

Consolidated → [RV04-C07-Audit-02.md](./RV04-C07-Audit-02.md).
**Verdicts:** 5× PASS (Agents 1, 2, 3, 4, 5 - all unconditional). All five Round-1 fixes CONFIRMED; the Round-2 AVIF `mif1` tightening (excluding the HEIC-colliding brand) resolved Agent 1's lone PASS_WITH_NOTES note; no regressions; gate green (each agent re-ran `bun run check` 0/0, `bun run lint` exit 0). (Agents 2 + 4 were initially rate-limited and re-launched after the limit lifted.)

Non-actionable observations: stale comment in hooks (bun:sqlite → libsql); `pcloudMkcol` non-401 error swallow + `tmpEnsured` (self-healing). Both accepted.

**Status: ✅ UNANIMOUS PASS - C07 audit loop closed. DV04 COMPLETE.** All five agents consider Cycle 7 (Media + Cross-cutting) complete and clean.

**DV04 full-system audit complete - all 7 cycles reached 5/5 unanimous unconditional PASS.**
