# RV06 · Round 3 Audit - Web Push (C05)

Re-audit of DV06 Cycle 5 after the Round 2 fixes. Method: 5 parallel independent
full-audit agents (no roles), per [[dv04-audit-loop]].

## Round 3 verdicts

- Agent A: UNCONDITIONAL_PASS
- Agent B: UNCONDITIONAL_PASS
- Agent C: UNCONDITIONAL_PASS
- Agent D: UNCONDITIONAL_PASS
- Agent E: CONDITIONAL_PASS (MEDIUM: per-subscription send failures abort sibling fan-out)

4/5 unconditional. Agent E found one robustness gap missed by others.

## MEDIUM - fixed this round (round 3 -> round 4)

- **Per-subscription send failures abort the batch** (`deliver.ts:277-284`). `sendToSubscriptions`
  had no per-iteration try/catch; a single corrupted subscription row (malformed keys →
  `sendWebPush` throw) would abort the remaining subscriptions in the batch. Fixed: the
  per-subscription call is now wrapped in try/catch (treat thrown errors as failed, continue
  the loop) - symmetric with the already-wrapped gone-endpoint prune.

## Carry-overs - unchanged

async getVapidKeys; subscribe upserts by endpoint; pushProfileComment not dispatched;
multi-record unsupported; notConfigured dead key; scripts not type-checked; SW
notificationclick same-origin (browser-enforced).

## Gate

- `bun run check`: exit 0 (1242 files 0/0 + SW gate).
- `bun run lint`: exit 0.
- `bun run build`: exit 0.

## Next

Round 4: re-audit; target 5/5 UNCONDITIONAL_PASS - the final round of DV06.
