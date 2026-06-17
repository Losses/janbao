# DV06 Plan - PWA + Offline Reading + Web Push + Lexical Lazy-Load

## Goal

Move the forum from "cached but online-only" to a real installable, offline-capable,
proactively-notified PWA, plus one targeted bundle optimization. Earlier analysis
(see context below) showed the app's load-speed ceiling is mostly already reached
(hashed immutable assets + CF CDN give browser-cache speed for free; SvelteKit's
`data-sveltekit-preload-data="hover"` is already in `app.html`). So this is a
**capability** delivery, not a headline speed number, with one exception:

- **Offline reading.** Fine-grained per-post/per-reply cache with **delta sync**,
  **offline read-state tracked locally and synced back**, **no false-read on
  offline fetch**, and **frontpage + TTL eviction** (`OFFLINE_RETENTION_DAYS`).
- **Web Push**, per-category independent toggles, working on both Cloudflare
  (adapter-auto) and Bun/Node (adapter-node) via pure WebCrypto (no `web-push` dep).
- **Installable PWA** (manifest + icons + SW app-shell).
- **Lexical editor lazy-load** with a 1:1 zero-CLS skeleton, scoped to write routes.

### Two reframings the plan honors

- The discussion **reading** route already avoids the `lexical` runtime:
  `LexicalRenderer.svelte` is pure recursive JSON→HTML (no `lexical`/`svelte-lexical`
  import). So Lexical lazy-load only affects the **write** routes.
- Reusable infra already exists: `notificationPreferences` (per-category booleans),
  `discussionReads` (read-state), `dispatchReplyNotifications` (computes exact
  recipients + category), the `getJwtSecret` env pattern, `crypto.subtle` everywhere,
  and the fire-and-forget `void fn().catch()` pattern.

### Invariants

- **INV-4 (no false read):** offline content fetches never touch `discussionReads`,
  `notifications`, or `discussions.viewCount`. Enforced structurally - the offline
  reading route has **no `+page.server.ts`**, so it cannot run server read-mutation.
  The online `/discussion/[id]` route stays untouched.
- **Delta-only:** composite `(updatedAt, id)` high-water-mark cursor; reconnect only
  ships new/edited/deleted rows.
- **Read-state last-write-wins** by `lastReadAt` server-side, strict `>` skip plus
  `ON CONFLICT … WHERE` to close races.
- **Env-var config** per [[prefers-defense-in-depth]]: every knob reads
  `platformEnv?.X || process.env.X` with a dev fallback.

## Scope (four cycles)

- **C01 - Installable shell.** `static/manifest.webmanifest`, `static/offline.html`,
  `src/service-worker.ts` (SvelteKit `$service-worker` convention), PWA icon set
  (`scripts/generate-pwa-icons.ts` via `sharp`), `app.html` meta, SW registration +
  online/offline banner in `+layout.svelte`, i18n `offline.*` keys.
- **C02 - Offline reading.** `GET /api/sync/content` (delta + tombstones +
  frontpage/bookmark id sets, pure read) and `PUT /api/sync/read-state`
  (idempotent last-write-wins upsert, no notification flip); `src/lib/server/sync/*`
  business logic + DAO; `getOfflineRetentionDays`; `src/lib/offline/*` (dexie IDB,
  sync orchestrator, read-state outbox, eviction); client-only `/offline` routes;
  online-route `goto` guard; supporting index migration.
- **C03 - Lexical lazy-load + skeleton.** `LexicalEditorLazy.svelte` wrapper
  (same `LexicalEditorProps`, 1:1 zero-CLS skeleton); import swap in 3 write routes
  - 2 organism composers.
- **C04 - Web Push.** `pushSubscriptions` table + push prefs columns on
  `notificationPreferences`; `src/lib/server/push/*` (VAPID JWT, RFC8291
  `aes128gcm`, key helpers, delivery); dispatch hooks in
  `dispatchReplyNotifications` and `api/messages`; `POST /api/push/{subscribe,unsubscribe}`;
  VAPID public key via `+layout.server.ts`; SW `push`/`notificationclick`; client
  `push.svelte.ts`; preferences UI; i18n `push.*` keys.

Edit / non-write surfaces are out of scope (see carry-overs in round reports).

## Method

Per [[dv04-audit-loop]]: for each cycle, write `DV06-C[NN]-Journal.md`; each round
launch **5 parallel independent full-audit agents (no role assignment)**; consolidate
into `RV06-C[NN]-Audit-[round].md`; if not 5/5 **UNCONDITIONAL_PASS**
(PASS_WITH_NOTES does not count), fix and re-audit; advance only on 5/5. Gate each
round with `bun run check` (0 errors) and `bun run lint` (exit 0). Run
`prettier --write` on every touched doc as the last step before each re-audit
([[markdown-table-pipe-gotcha]]).

## Artifacts

- `DV06-Plan.md` - this file.
- `DV06-C01-Journal.md` … `DV06-C04-Journal.md` - per-cycle round logs.
- `RV06-C01-Audit-0<N>.md` … `RV06-C04-Audit-0<N>.md` - consolidated round reports.

## Deployment notes (ops checklist, not code defects)

- **Schema migrations:** C02 adds supporting indexes (no columns); C04 adds the
  `push_subscriptions` table and push-pref columns. Each `bun run db:generate:local`
  produces the next numbered file under `drizzle/local-migrations/` (auto-applies on
  local libsql connect). Production D1 must be applied manually via
  `wrangler d1 execute` per [[prod-d1-migration-manual]] before deploy, or the push
  surfaces throw "no such table" / the new prefs are absent.
- **VAPID keys:** production needs a real keypair in `VAPID_PUBLIC_KEY` /
  `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (mint via `scripts/generate-vapid-keys.ts`).
  Dev falls back to baked `DEV_VAPID_*` constants.
- **New deps:** `dexie` (runtime), `sharp` (devDep, icon script only). No `web-push`.
