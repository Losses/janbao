# RV04-C07-Audit-01: DV04 Cycle 7 - Round 1 Audit

**Date:** 2026-06-16
**Cycle:** C07 - Media Serving/Upload + Cross-cutting
**Method:** 5 independent sub-agents, each performing the full un-roled audit of the C07 scope. No roles assigned. Reports consolidated below.

**Round 1 Verdicts:** **0× PASS**, **5× PASS_WITH_NOTES**.
**Consolidated consensus: FAIL** - two MAJORs (dead-image i18n, advertised-but-rejected AVIF) plus MINORs.

---

## 1. Findings (deduplicated, with finders)

### MAJOR (fixed this round)

- **C7-1 (Agents 1, 2, 3, 4, 5 - unanimous):** hardcoded Chinese dead-image string `图片已失效` in `LexicalRenderer.svelte` (the view path) and `DeadImageNode.ts` (the editor node) - English-locale users saw Chinese for imported dead images. Fix: added `img.deadImage` i18n key (en/zh); `LexicalRenderer` gained a `deadImageLabel` prop (English default) threaded from all 9 call sites; `DeadImageNode` reads a module-level label set by `LexicalEditor` via `setDeadImageLabel(t.img.deadImage)`.
- **C7-AVIF (Agent 1):** AVIF was advertised in the i18n (`avatarRequirements`), the `<input accept>` attributes, and the RichTextToolbar label, but `detectImageFormat` had no AVIF branch → AVIF uploads were rejected as `invalidType`. Fix: added AVIF magic-byte detection (ISOBMFF `ftyp` box + `avif`/`avis`/`mif1` brand) + `image/avif` MIME, so advertised AVIF support now works.

### MINOR (fixed this round)

- **C7-2 (Agents 1, 2, 3, 4 - unanimous):** dead i18n key `search.tooShortHint` (unreferenced). Removed from en + zh.
- **C7-5 (Agents 4, 5):** upload type-sniff only ran on the first chunk; a sub-12-byte first chunk mis-detected WebP/AVIF as `other`. Fix: accumulate up to 12 bytes into a fixed sniff buffer before calling `detectImageFormat`.
- **C7-6 (Agent 5):** `pcloudMkcol('/tmp')` ran on every upload (a WebDAV round-trip). Fix: per-isolate `tmpEnsured` flag - ensured once, skipped thereafter.

### Carry-overs (documented, accepted)

- **C7-co1 (Agents 3, 4, 5):** `themeName` not server-allowlisted - defense-in-depth only (applied via `setAttribute('data-theme', …)`, XSS-safe; admin/write-only). Accepted.
- **C7-co2 (Agents 1, 2, 4):** `seedCore` cold-start issues ~8 sequential inserts per isolate - perf, bounded by the `seeded` flag. Accepted.
- **C7-co3 (Agents 1, 2):** attachment route has no auth + no `fileId` shape regex - intended public-by-sha design (DB lookup gates pCloud access; sha256 unguessable; single-segment matcher forbids `/`). Defense-in-depth regex optional. Accepted.
- **C7-co4 (Agent 1):** avatar route leaks user-existence (404 vs 200) - avatars public by design; minor enumeration. Accepted.
- **C7-co5 (Agent 2):** upload `isAvatar` via client `x-upload-type` header (advisory size-cap bypass; both paths auth'd + content-addressed). Accepted.
- **C7-co6 (Agents 2, 5):** entry-route client password literal `8` not the `MIN_PASSWORD_LENGTH` constant (C01 scope; value matches). Accepted.
- **C7-co7 (Agent 4):** user-search LIKE doesn't escape `%`/`_` (functional autocomplete quirk; parameterized, no injection). Accepted.
- **C7-co8 (Agent 4):** `seedCore` swallows seeding errors (self-healing retry; idempotent). Accepted.

---

## 2. Carry-over verification + cross-cutting (all 5 agents)

- **Upload pipeline sound (5/5):** size limit enforced twice (Content-Length gate + byte-counting TransformStream abort); content-type sniffed from magic bytes (client header never trusted); SHA-256 content-addressing; atomic `/tmp`→`MOVE` (rejected upload never clobbers); auth required; `nosniff` + immutable cache on served media.
- **Avatar/attachment serving sound (5/5):** `nosniff`; Content-Type from DB; path traversal blocked (avatar `Number.isFinite` gate; attachment DB-lookup gate; single-segment matcher).
- **pCloud client injection-free (5/5):** basePath always prepended; no host rewrite; no SSRF.
- **i18n parity exact (5/5):** 0 missing keys either direction; `{email}`/`{link}`/`{count}` interpolation auto-escaped.
- **Svelte 5 runes stores loop-safe (5/5):** load(effect)+refresh(afterNavigate) split; no `$effect` fetch loop.
- **Lexical XSS render path sound (5/5):** `safeUrl` allowlist (http(s)/same-origin-relative/`./`/`../`/`#`), no `{@html}`; editor `validateUrl` + node-transform parity.
- **Admin/auth layout gating correct (5/5); JWT secret fail-closed in prod; no `as any`; gate green.**

---

## 3. Round 1 Action Plan

Fixed **C7-1** (dead-image i18n, 9-site thread) → **C7-AVIF** (AVIF detection) → **C7-2** (dead key) → **C7-5** (sniff buffer) → **C7-6** (mkcol cache). Carry over C7-co1..co8. Run `bun run check` + `bun run lint`. Then re-audit (Round 2).
