# RV06 · Round 2 Audit - Web Push (C05)

Re-audit of DV06 Cycle 5 after the Round 1 fixes. Method: 5 parallel independent
full-audit agents (no roles), per [[dv04-audit-loop]].

## Round 2 verdicts

- Agent A: UNCONDITIONAL_PASS
- Agent B: UNCONDITIONAL_PASS (journal doc prettier nit, not source)
- Agent C: CONDITIONAL_PASS (LOW: SW notificationclick defense-in-depth)
- Agent D: UNCONDITIONAL_PASS
- Agent E: FAIL (CRITICAL: waitUntil; HIGH: pushDiscussionComment dead; HIGH: conversation-reply push missing)

3/5 unconditional. Agent E surfaced three real issues missed by others.

## CRITICAL/HIGH - fixed this round (round 2 -> round 3)

- **Fire-and-forget push not wrapped in `waitUntil`** (Agent E CRITICAL). On Cloudflare
  Workers the runtime tears down after the Response; promises not registered via
  `platform.context.waitUntil(promise)` are not guaranteed to run. Fixed: both dispatch
  hooks (reply action + messages POST + conversation-reply POST) now wrap the push promise
  in `waitUntil` when available, falling back to bare `void .catch()` on Bun/Node.
- **`pushDiscussionComment` toggle dead** (Agent E HIGH). `pushPrefColumnForCategory('owner')`
  returned only `pushDiscussionReply`, not `pushDiscussionReply || pushDiscussionComment`
  (mirroring `isEligible`). Fixed: `pushPrefColumnsForCategory` now returns an array; the
  owner category ORs both columns; the delivery loop checks `.some(col => pref[col])`.
- **Conversation-reply push missing** (Agent E HIGH). `deliverPushForMessage` was only
  called from `POST /api/messages` (new conversation), not from the conversation-reply
  `post` action. Fixed: the reply action now also fires `deliverPushForMessage` (wrapped
  in `waitUntil`).

## Carry-overs (accepted)

- async `getVapidKeys`; subscribe upserts by endpoint; `pushProfileComment` not dispatched
  yet; multi-record push unsupported; `notConfigured` dead i18n key; scripts not type-checked;
- SW `notificationclick` same-origin defense-in-depth (Agent C LOW - browser already
  blocks cross-origin `openWindow`; payload URL is server-composed).

## Gate

- `bun run check`: exit 0 (1242 files 0/0 + SW gate).
- `bun run lint`: exit 0.
- `bun run build`: exit 0.

## Next

Round 3: re-audit. All three round-2 findings fixed; target 5/5 UNCONDITIONAL_PASS.
