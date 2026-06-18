# RV06 · Round 5 Audit - Offline-Aware UX Disable Sweep (C03)

Re-audit of DV06 Cycle 3 after the Round 4 fixes. Method: 5 parallel independent
full-audit agents (no roles), per [[dv04-audit-loop]].

## Round 5 verdicts (5 independent full-audit agents)

- Agent A: UNCONDITIONAL_PASS
- Agent B: UNCONDITIONAL_PASS
- Agent C: PASS (post/discussion saveDraftManual fn-guard - LOW parity)
- Agent D: PASS (messages/inbox new-message link; PM Edit visual - LOW polish)
- Agent E: CONDITIONAL PASS (profile directed-activity composer - CRITICAL)

2/5 unconditional. One real gap: the profile page's directed-activity composer was a
primary viewing-page write surface not in the carry-over set.

## MAJOR - fixed this round (round 5 -> round 6)

- **Profile directed-activity composer** (`profile/[userId]/[userSlug]`): `submitDirectedActivity`
  - its submit button fired `POST /api/activities` offline with no guard. This is a
    primary viewing page (any logged-in user's profile) with an authoring surface - not the
    profile-EDIT forms that are carry-overs. Fixed: `getOnlineStore` wired in; function
    early-returns offline; submit button `disabled` offline. (Agent E.)

## MINOR - fixed this round

- `post/discussion` `saveDraftManual` gained the function-level offline guard, matching
  its editDiscussion sibling (defense-in-depth parity). (Agent C.)
- `PrivateMessageWindow` Edit button gained a visual `disabled={!online.online}` (its
  `startEdit` already early-returned offline). (Agent D.)

## Carry-overs (accepted with rationale - not re-fixed)

- DiscussionListPage (home `/`, `/discussions`, category): read-only discussion-list
  displays; SW offline.html covers offline nav; compose CTA → /post/discussion (disabled).
- Admin / **entry / profile-EDIT forms** (`profile/edit`, `profile/password`,
  `profile/picture`, `profile/preferences`) - distinct from the profile main page composer
  now fixed.
- Discussion-page moderator actions (delete-reply, delete-discussion, toggle-pin);
  `RichTextToolbar` image upload; `ActivityComments` (nav-reached); sidebar/mobile nav;
  `BookmarkTooltip`; ActivityRow delete (not rendered offline); list-page reconnect
  auto-refresh (data in memory); the `/messages/inbox` "New Message" link (navigates to the
  fully-disabled /messages/new - nav polish, not a write dead-end).

## Gate (end of round 5, after fixes)

- `bun run check`: exit 0 (1232 files 0/0 + SW gate).
- `bun run lint`: exit 0.
- `bun run build`: exit 0.

## Next

Round 6: re-audit. The profile composer was the last primary-surface write gap; remaining
ungated surfaces are firmly carry-over (nav-reached, secondary, or read-only).
