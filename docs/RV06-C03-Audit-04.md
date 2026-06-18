# RV06 · Round 4 Audit - Offline-Aware UX Disable Sweep (C03)

Re-audit of DV06 Cycle 3 after the Round 3 fixes. Method: 5 parallel independent
full-audit agents (no roles), per [[dv04-audit-loop]].

## Round 4 verdicts (5 independent full-audit agents)

- Agent A: PASS_WITH_NOTES (addParticipant form; messages/new send-button disabled)
- Agent B: CONDITIONAL PASS (editDiscussion Update button; addParticipant)
- Agent C: CONDITIONAL PASS (editDiscussion Update; addParticipant; nav-link polish)
- Agent D: CONDITIONAL PASS (editDiscussion Update button)
- Agent E: FAIL (editDiscussion Update; addParticipant; DiscussionListPage empty-state/CTA)

0/5 unconditional. Two real consensus gaps, both from imprecise round-3 edits:

## MAJOR - fixed this round (round 4 -> round 5)

- **editDiscussion Update submit button not gated offline** (the round-3 regex
  `isPreview}` landed on a _preview toggle_ button, not the Update button). Fixed:
  reverted the wrongly-disabled preview button and added `!online.online` to the correct
  Update submit button (the one whose `disabled` starts with `!title.trim()`). (Agents
  B, C, D, E.)
- **`/messages/[id]` add-participant form unguarded offline** (a primary messaging-surface
  write on the conversation page, sibling to `PrivateMessageWindow` which was gated).
  Fixed: `getOnlineStore` wired in; the add-participant submit button `disabled` offline.
  (Agents A, B, C, E.)
- **`messages/new` send-button disabled predicate** was missing `!online.online` (the
  `send()` function guard already blocked the write; this adds the visual disable).
  (Agents A, E.)

## Carry-overs (accepted with rationale - not re-fixed)

- **DiscussionListPage (home `/`, `/discussions`, category) offline empty-state + compose
  CTA** (Agent E CRITICAL, single agent): these are read-only discussion-list displays
  (no write dead-end); the SW's network-first `offline.html` fallback covers offline
  navigation to them, and the compose CTA navigates to `/post/discussion` which IS fully
  disabled offline. The five user-owned list pages (bookmarks, notifications, messages-
  inbox, activity, search) have offline empty-states; the public discussion lists are
  read-only and SW-covered. Not a write dead-end.
- Admin / entry / profile-edit forms; discussion-page moderator actions (delete-reply,
  delete-discussion, toggle-pin); `RichTextToolbar` image upload; `ActivityComments`
  (nav-reached); sidebar / mobile-drawer nav; `BookmarkTooltip`; ActivityRow delete (not
  rendered offline); list-page reconnect auto-refresh (data in memory); redundant
  `saveDraftManual` function guards.

## Gate (end of round 4, after fixes)

- `bun run check`: exit 0 (1232 files 0/0 + SW gate).
- `bun run lint`: exit 0.
- `bun run build`: exit 0.

## Next

Round 5: re-audit. All primary authoring/messaging/list write surfaces are now gated; the
editDiscussion Update button + addParticipant form (the two real round-4 gaps) are closed.
