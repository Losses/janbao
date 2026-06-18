# RV06 · Round 1 Audit - Web Push (C05)

Scope: full audit of DV06 Cycle 5 - WebCrypto VAPID/aes128gcm push modules, delivery +
dispatch hooks, subscribe/unsubscribe endpoints, SW push/notificationclick, client push
store, preferences UI, i18n, schema/migration. Method: 5 parallel independent full-audit
agents (no roles), per [[dv04-audit-loop]].

## Round 1 verdicts

- Agent A: FAIL (C-1 CRITICAL: pushParticipatedComment / pushBookmarkedDiscussionComment
  toggles unreachable — notification type collapse loses the category)
- Agent B: PASS (M-1 MAJOR: same category-collapse issue)
- Agent C: CONDITIONAL_PASS (S-1 MEDIUM: SSRF — no endpoint scheme/host validation)
- Agent D: PASS_WITH_NOTES (LOW-1: UI permission state; LOW-2: notConfigured dead key)
- Agent E: PASS_WITH_NOTES (M-1 MAJOR: same category-collapse issue)

0/5 unconditional. Strong consensus on the category-collapse issue (A/B/E) + the SSRF (C).

## CRITICAL/MAJOR - fixed this round

- **pushParticipatedComment / pushBookmarkedDiscussionComment toggles unreachable**
  (Agents A, B, E). The notification `type` collapse (participant/bookmarker →
  `'discussion_comment'`) lost the category before the push pref check, so both were gated
  by `pushDiscussionComment` and the dedicated toggles had no effect. Fixed: threaded the
  original `ReplyNotifCategory` through `NewNotificationRow.category`; replaced
  `pushPrefColumnForType(type)` with `pushPrefColumnForCategory(category)` mapping all four
  categories to their correct push pref columns.
- **SSRF via stored push endpoint** (Agent C). The subscribe endpoint accepted any URL.
  Fixed: `isAllowedPushEndpoint` validates `https:` + host allowlist (FCM, Mozilla, Apple)
  before the DB upsert.

## MINOR - fixed this round

- **UI didn't show Notification.permission state** (Agent D LOW-1). Fixed: the preferences
  page now tracks `pushPermission` reactively; the "denied" state shows the
  `permissionDenied` text instead of a clickable Enable button.

## Carry-overs (accepted)

- `getVapidKeys` async (dev ephemeral fallback).
- Subscribe upserts by endpoint (globally unique; handles account-switching).
- `pushProfileComment` not dispatched yet (forward-ready).
- Multi-record push unsupported (payloads tiny JSON).
- `notConfigured` i18n key defined but section hidden when `!vapidPublicKey` (cosmetic).
- `scripts/generate-vapid-keys.ts` not type-checked by `bun run check`.

## Gate

- `bun run check`: exit 0 (1242 files 0/0 + SW gate).
- `bun run lint`: exit 0.
- `bun run build`: exit 0.

## Next

Round 2: re-audit with the carry-over list; target 5/5 UNCONDITIONAL_PASS.
