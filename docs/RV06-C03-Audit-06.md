# RV06 · Round 6 Audit - Offline-Aware UX Disable Sweep (C03)

Re-audit of DV06 Cycle 3 after the Round 5 fixes. Method: 5 parallel independent
full-audit agents (no roles), per [[dv04-audit-loop]].

## Round 6 verdicts (5 independent full-audit agents)

- Agent A: UNCONDITIONAL_PASS
- Agent B: PASS (profile/invitations requestCode - MEDIUM)
- Agent C: UNCONDITIONAL_PASS (2 LOW defense-in-depth observations)
- Agent D: PASS (2 LOW defense-in-depth, consistent with pattern)
- Agent E: PASS (carry-over note only)

2/5 unconditional; the only non-LOW finding was the invitations request-code write.

## MAJOR - fixed this round (round 6 -> round 7)

- **`/profile/invitations` `requestCode`** (`POST /api/invitations/request`) fired offline with
  no guard. Fixed: `getOnlineStore` wired in; function early-returns offline; the request
  button `disabled` offline. (Agent B.)

## Carry-overs (accepted with rationale - not re-fixed)

- `use:enhance` cancel callbacks check only `isSubmitting`, not `online.online` (Agents C,
  D LOW): the submit button is the canonical submit path and is disabled offline; the
  editor Ctrl+Enter path is fn-guarded. Consistent single-layer-on-the-form + button-disabled
  pattern across all form-enhance surfaces; no alt submit path bypasses it. Defense-in-depth
  hardening only, non-blocking.
- DiscussionListPage (read-only, SW-covered); admin / entry / profile-EDIT forms;
  discussion-page moderator delete/pin; RichTextToolbar upload; ActivityComments
  (nav-reached); sidebar/mobile nav; BookmarkTooltip; ActivityRow delete; list-page
  reconnect auto-refresh (data in memory); inbox new-message link (nav → disabled page);
  the profile main page's ActivityList/ActivityRow (rendered but their delete/comment are
  accepted carry-overs).

## Gate (end of round 6, after fixes)

- `bun run check`: exit 0 (1232 files 0/0 + SW gate).
- `bun run lint`: exit 0.
- `bun run build`: exit 0.

## Next

Round 7: re-audit. All primary authoring/messaging/list + invitations write surfaces are
now gated; remaining items are LOW defense-in-depth (enhance cancel) or accepted
carry-overs.
