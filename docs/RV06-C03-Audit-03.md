# RV06 · Round 3 Audit - Offline-Aware UX Disable Sweep (C03)

Re-audit of DV06 Cycle 3 after the Round 2 fixes. Method: 5 parallel independent
full-audit agents (no roles), per [[dv04-audit-loop]].

## Round 3 verdicts (5 independent full-audit agents)

- Agent A: UNCONDITIONAL_PASS
- Agent B: PASS (markAllRead fn-guard LOW)
- Agent C: PASS
- Agent D: PASS WITH NOTES (editDiscussion page unguarded - MEDIUM)
- Agent E: CONDITIONAL PASS (editDiscussion, PM compose/edit, markAllRead fn-guard)

3/5 PASS, 2/5 with findings. Consensus: three more primary authoring/messaging surfaces
mirrored already-gated ones but hadn't been swept - editDiscussion (twin of
post/discussion), PrivateMessageWindow (in-thread compose + edit-message, twin of
discussion reply + edit-reply), and messages/new send - plus the notifications-page
markAllRead lacked the function-level self-guard its tooltip sibling has.

## MAJOR - fixed this round (round 3 -> round 4)

- **editDiscussion page** (`post/editDiscussion/[id]`): the twin of `post/discussion`
  had zero offline gating. Fixed: `getOnlineStore` wired in; publish `onSubmit` Ctrl+Enter
  path guards on `online.online`; Save-Draft + Update submit buttons `disabled` offline;
  `saveDraftManual` early-returns offline. (Agents D, E.)
- **PrivateMessageWindow** (in-thread compose + inline edit-message): the twin of the
  discussion reply + edit-reply surfaces. Fixed: compose + edit `onSubmit` Ctrl+Enter
  paths guard on `online.online`; compose + edit submit buttons `disabled` offline;
  `startEdit` early-returns offline. (Agent E; Agent D.)
- **messages/new send**: `send()` early-returns offline; send button + recipient input
  `disabled` offline. (Agents D, E.)

## MINOR - fixed this round

- Notifications-page `markAllRead` gained the function-level `!online.online` self-guard
  (matching its tooltip sibling). (Agents A, B, E.)

## Carry-overs (accepted with rationale - not re-fixed)

- Admin / entry / profile-edit forms; discussion-page moderator actions (delete-reply,
  delete-discussion, toggle-pin); `RichTextToolbar` image upload; `ActivityComments`
  (nav-reached); sidebar / mobile-drawer nav; the public home/category/categories
  discussion lists (read-only, SW-covered). All caught by the SW `offline.html` nav
  fallback + the offline banner.
- ActivityRow delete: the activity list collapses to the offline empty-state, so the row
  (and its delete) isn't rendered offline.
- List-page reconnect auto-refresh: list data is in memory from the online load; the flag
  only hides/shows it.
- `saveDraftManual` function-level guard redundancy where its sole caller button is already
  disabled offline.

## Gate (end of round 3, after fixes)

- `bun run check`: exit 0 (1232 files 0/0 + SW gate).
- `bun run lint`: exit 0.
- `bun run build`: exit 0.

## Next

Round 4: re-audit with the carry-over list; target 5/5 UNCONDITIONAL_PASS. All primary
authoring/messaging/list surfaces are now gated; remaining ungated writes are firmly
carry-over (nav-reached or secondary).
