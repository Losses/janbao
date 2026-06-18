# DV06 C05 Journal - Web Push (Per-Category) Audit Loop

Method: 5 parallel independent full-audit agents (no roles), loop until 5/5
unconditional PASS. See [[dv04-audit-loop]]. Plan: DV06-Plan.md.

## Pre-audit dev notes

Goal: per-category Web Push notifications that run on both Cloudflare Workers
and Bun, using only WebCrypto (no `web-push` npm dep, no `node:crypto`).
Push preferences are a parallel set of toggles to the existing in-app
notification prefs and are honored independently at delivery time.

### What was built

**Push server modules** (`src/lib/server/push/`, all new):

- `keys.ts` - `getVapidKeys(platformEnv)` resolves VAPID keypair from env
  (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`, base64url of
  raw bytes: 65-byte uncompressed public, 32-byte raw private `d`). In dev
  with no env vars, generates an ephemeral P-256 keypair cached for the
  process lifetime (subscriptions don't survive restart - acceptable for
  dev). Production builds throw on missing keys (fail-closed). Also
  `getVapidPublicKeyBase64Url(platformEnv)` for the client-side gate.
- `vapid.ts` - `signVapidJwt(privateKey, publicKey, audience, subject)`.
  ES256 (ECDSA P-256 SHA-256) JWT. Imports the private scalar via JWK
  reconstruction (needs the public X/Y from the 65-byte uncompressed key).
  Detects signature encoding at runtime: WebCrypto spec is ASN.1 DER, but
  Bun's WebCrypto returns raw r||s (64 bytes) directly - both are handled
  (`ecdsaSignatureToRaw`). Output is verified to be 3 base64url parts with
  a 64-byte signature.
- `encryption.ts` - RFC8291 / RFC8188 `aes128gcm` content encryption.
  `encryptPayload(payload, p256dh, authSecret)`: ephemeral P-256 keypair,
  ECDH to derive Z, two-stage HKDF (PRK from auth secret, then CEK/nonce
  from salt+IKM with `Content-Encoding: auth\0` / `aes128gcm\0` / `nonce\0`
  info strings), AES-128-GCM with a single-record `0x02` delimiter pad,
  then assembles salt(16) + rs(uint32 BE=4096) + idlen(1=65) +
  keyid(ephemeral pub 65) + ciphertext.
- `deliver.ts` - `sendWebPush(subscription, payload, platformEnv)` does
  encrypt + sign + POST, bucketing responses into ok / gone (404/410) /
  retryable (429/5xx) / failed. Two fan-out entry points:
  `deliverPushForNotifications(db, rows, env)` (reply-triggered) and
  `deliverPushForMessage(db, conversationId, authorId, env)` (new PM).
  Both batch-fetch subscriptions + prefs + source user, skip per-category
  disabled prefs, and prune subscriptions that return 404/410. All
  fire-and-forget-safe.

**Dispatch hooks** (modified):

- `src/lib/server/db/notifications.ts` - `dispatchReplyNotifications` now
  returns `NewNotificationRow[]` (was `void`). `NewNotificationRow` is now
  exported. No push logic here - kept focused on in-app.
- `src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.server.ts`
  - reply action captures the returned rows and fires-and-forgets
    `deliverPushForNotifications(db, rows, platform?.env)` after the in-app
    dispatch.
- `src/routes/api/messages/+server.ts` - after the conversation is
  committed, fires-and-forgets
  `deliverPushForMessage(db, conversationId, user.id, platform?.env)`.

**Endpoints** (new):

- `POST /api/push/subscribe` - upserts a subscription keyed on the
  (globally unique) endpoint, refreshing user + keys + UA. Endpoint is
  unique across users so the same browser can switch accounts cleanly.
- `DELETE /api/push/subscribe` and `POST /api/push/unsubscribe` - both
  remove the active user's subscription for an endpoint, scoped to the
  active user (`and(endpoint, userId)` filter so a user cannot revoke
  another user's subscription by guessing endpoints). The POST form
  mirrors the rest of the push API shape.

**Layout + service worker + client**:

- `+layout.server.ts` exposes `vapidPublicKey` (base64url) - safe to ship
  to the client (it's the public half, also embedded in every
  subscription). Null when push is not configured and not dev.
- `service-worker.ts` - `push` listener parses the JSON payload
  (`{title, body, url, tag?}`) and `showNotification` with icon, badge,
  data.url, tag. `notificationclick` focuses an existing same-pathname
  client or opens a new one.
- `src/lib/push.svelte.ts` - `subscribeToPush(vapidPublicKey)`,
  `unsubscribeFromPush()`, `isPushSubscribed()`, `urlBase64ToUint8Array()`.
  All network calls go to the authed `/api/push/*` endpoints.

**Preferences UI** (`src/routes/profile/preferences/`):

- `+page.server.ts` - load now returns push pref columns + `vapidPublicKey`.
- `+page.svelte` - new "Push notifications" section (only when
  `vapidPublicKey` is set and the browser supports PushManager). Enable
  button (requests Notification.permission, subscribes via SW
  `pushManager.subscribe({userVisibleOnly:true, applicationServerKey})`,
  POSTs to `/api/push/subscribe`); disable button (unsubscribes + POSTs
  to `/api/push/unsubscribe`); per-category toggles (7: mention, reply,
  discussionComment, participatedComment, bookmarkedDiscussionComment,
  profileComment, message) bound to the new push prefs, persisted via
  the existing `/api/profile/preferences` POST.
- `/api/profile/preferences` POST now accepts the 7 push pref keys
  (added to `VALID_PREF_KEYS`).
- `ProfilePreferencesBody` (`src/lib/types/api.ts`) extended with the
  push fields; new `PushSubscribeBody`, `PushUnsubscribeBody`,
  `PushSubscriptionKeys` types.

**Schema + migration** - already in place from prior work:
`pushSubscriptions` table + the 7 push columns on `notificationPreferences`

- `drizzle/local-migrations/0013_true_human_robot.sql`.

**i18n** - new top-level `push.*` namespace (22 keys each) in
`src/lib/i18n/{en,zh-CN}.json`: sectionTitle, sectionDescription, enable,
disable, permissionDenied, notConfigured, unsupported, subscribed, and
per-category label + desc.

**Env docs + tooling**:

- `.env.example` and `.env.docker.example` document
  `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`.
- `scripts/generate-vapid-keys.ts` generates a P-256 keypair via
  WebCrypto and prints base64url public (65-byte uncompressed) + private
  (32-byte raw `d`, recovered from the JWK export - slicing PKCS8 by a
  fixed offset is fragile and was wrong on first pass).

### Crypto verification

End-to-end crypto roundtrip was verified with a throwaway script (deleted
after verification):

1. VAPID JWT produced by `signVapidJwt` has exactly 3 base64url parts and
   the signature is 64 bytes raw r||s. The signature verifies against the
   public key via `crypto.subtle.verify` (ES256).
2. `encryptPayload` produces a record whose header is byte-correct:
   `salt(16) || rs(uint32 BE = 4096) || idlen(1 = 65) || keyid(65)`.
3. The record decrypts back to the original plaintext under a manual
   RFC8188 receiver-side decryption (ECDH + two-stage HKDF + AES-128-GCM),
   confirming `info` strings, nonce derivation, and padding are all
   correct.

### Spec deviations / notes for auditors

- **`getVapidKeys` is async**, not sync as the spec sketched. Reason: in
  dev with no env keys we generate an ephemeral P-256 keypair via
  WebCrypto (must be async). The configured-env path is still synchronous
  internally. `getVapidPublicKeyBase64Url` stays sync (returns the env
  string or the cached dev public key if already generated, else null).
  In dev the UI may briefly show null until the first push subscription
  attempt triggers `getVapidKeys` to populate the cache - acceptable,
  since the page-level check is the only sync caller.
- **Subscribe endpoint upserts across users**. The push endpoint is
  globally unique per browser; on subscribe we look up by endpoint alone
  and overwrite the userId. This handles account-switching on a shared
  device (otherwise the prior user keeps getting the new user's pushes).
  Unsubscribe is scoped to the active user so one user can't revoke
  another's subscription. The spec said "onConflictDoNothing or update"
  - we do update (refreshed keys + UA) since browser key rotation is
    legitimate.
- **Push prefs use no DB default-false fallback** - schema defaults are
  `true` and `deliverPushFor*` treats a missing preference row as
  default-true for every push category, mirroring the in-app pref
  semantics in `isEligible`.
- **`pushProfileComment` toggle exists in the UI but is not currently
  wired to a dispatch path** - profile-comment notifications go through
  a different code path (activity comments) that wasn't in scope for
  this cycle. The toggle is persisted and ready for a future cycle to
  consume; no incorrect push is sent today.
- **Multi-record push is not supported** - payloads larger than
  `rs - 16 - 1 = 4079 bytes` throw. Push payloads are tiny JSON
  (`{title, body, url, tag}`), so this is not a practical limit.
- **Dev-mode key generation warning** uses `console.warn`, matching the
  `getJwtSecret` precedent.
- **Differences from in-app notification semantics**: the discussion
  dispatcher's category enum is `'mention'|'owner'|'participant'|'bookmarker'`
  and the inserted `notification.type` collapses these to
  `'mention'|'reply'|'discussion_comment'`. The push fan-out keys off
  the inserted `type`, so `pushDiscussionComment` covers both "owner" and
  "participant" notification types (the in-app side similarly folds
  owner into `discussionReply || discussionComment`). This matches the
  existing in-app behavior; no separate "participant" push category
  exists on the wire.

### Invariants honored

- Per-category independent push toggles (7 categories).
- Pure WebCrypto - verified to run on Bun (builds, signs, encrypts,
  roundtrips); same code path is runtime-portable to Cloudflare Workers
  (the only runtime-detecting branch is signature encoding, which both
  paths handle).
- Fire-and-forget dispatch - both call sites use
  `void x().catch(console.error)` and the dispatcher catches internally.
- Authed endpoints - all `/api/push/*` and `/api/profile/preferences`
  require `locals.user`.
- Project type rules - all object shapes are named interfaces; type
  literals only for unions/function types; no `as unknown` / `as any`
  (only `as BufferSource` / `as BodyInit` which the eslint rule allows,
  matching existing pcloud.ts usage).

### Gates

- `bun run check`: 0 errors, 0 warnings, 1242 files.
- `bun run lint`: prettier ✓, eslint ✓, similarity-ts ✓ (0 type literals;
  function-level similarities are informational per project convention).
- `bun run build`: ✓ built (push `deliver.js` chunk = 19.17kB / 6.31kB gzip).

## Round 1

- 5 agents. Verdict: 0/5 unconditional (A FAIL, B PASS, C CONDITIONAL, D/E PASS_WITH_NOTES).
- CRITICAL/MAJOR consensus (A/B/E): `pushParticipatedComment` / `pushBookmarkedDiscussionComment`
  toggles unreachable - the notification type collapse lost the category before the push pref check.
  Fixed: threaded `ReplyNotifCategory` through `NewNotificationRow.category`; `pushPrefColumnForCategory`
  maps all four categories.
- MEDIUM (C): SSRF via stored push endpoint (no scheme/host validation). Fixed: `isAllowedPushEndpoint`
  validates https + host allowlist (FCM/Mozilla/Apple).
- LOW (D): UI didn't show permission denied state. Fixed: reactive `pushPermission` tracking.
- Carry-overs: async getVapidKeys; subscribe upserts by endpoint; pushProfileComment not dispatched;
  multi-record unsupported; notConfigured dead key; scripts not type-checked.
- Gate: check 0/0, lint exit 0, build exit 0. See RV06-C05-Audit-01.md.
- Advancing to round 2 targeting 5/5 UNCONDITIONAL_PASS.
