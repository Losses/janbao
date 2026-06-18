# RV06 · Round 1 Audit - Offline-Aware UX Disable Sweep (C03)

Scope: full audit of DV06 Cycle 3 - the reactive `online` store, layout wiring,
`offline.disabled.*` i18n, Header nav greying, DiscussionRow bookmark disable,
post/discussion + discussion-reply submit disables, and offline empty-states on the
bookmarks / notifications / messages-inbox / activity / search list pages. Method: 5
parallel independent full-audit agents (no roles), per [[dv04-audit-loop]].

## Round 1 verdicts (5 independent full-audit agents)

- Agent A: UNCONDITIONAL_PASS
- Agent B: UNCONDITIONAL_PASS
- Agent C: CONDITIONAL_FAIL (C1 activity composer, M1 edit-reply, M2 mark-all-read)
- Agent D: FAIL (F1/F2 requestSubmit bypass, F3 edit-reply, M1 activity)
- Agent E: CONDITIONAL_FAIL (F1/F2 requestSubmit bypass, L1 a11y tabindex)

2/5 unconditional - not advancing. Consensus: the `disabled` button attribute alone is
bypassed by the editor's Ctrl+Enter → `form.requestSubmit()` path (which ignores button
disabled state), and three in-flow write surfaces were missed.

## MAJOR - fixed this round (round 1 -> round 2)

- **Ctrl+Enter bypassed the disabled submit buttons** (`post/discussion` publish +
  discussion reply). `HTMLFormElement.requestSubmit()` fires regardless of the submit
  button's `disabled` state, so the editor's `onSubmit` could POST offline. Fixed: both
  `onSubmit` callbacks now also check `online.online` before `requestSubmit()`.
  (Agents C, D, E.)
- **Activity page composer left enabled offline** (`activity/+page.svelte`). The list
  collapsed to the offline empty-state but the composer submit + `submitActivity` were
  unguarded. Fixed: submit button `disabled` includes `!online.online` and
  `submitActivity` early-returns offline. (Agents C, D.)
- **Inline edit-reply not disabled offline** (discussion page). The Edit button + the
  inline Save button were unguarded; a user editing a reply offline could open the
  editor and the Save path was unblocked. Fixed: Save `disabled` includes
  `!online.online`; the Edit button's `onclick` early-returns offline. (Agents C, D.)
- **Notifications "Mark all read" not disabled offline.** Fixed: button `disabled`
  includes `!online.online`. (Agent C.)

## MINOR - fixed this round

- Removed unused `offline.disabled.{hint,button}` i18n keys (only `title` is wired into
  the list empty-states). (Agents C, D.)
- Header nav links gain `tabindex={!online.online ? -1 : undefined}` alongside
  `aria-disabled` so keyboard users can't focus+activate a greyed link. (Agent E.)

## Carry-overs (accepted with rationale - not re-fixed)

- Secondary write surfaces reached only by navigation (`post/editDiscussion`,
  `messages/new`, `ActivityComments`, `PrivateMessageWindow`) + admin / entry /
  profile-edit forms: the SW's network-first navigation fallback (`offline.html`) +
  the offline banner cover offline navigation to them.
- Discussion-page moderator actions (delete-reply, delete-discussion, toggle-pin):
  lower-frequency, moderator-gated; the primary in-flow writes (reply, edit-reply, new
  discussion, activity, bookmark) are disabled. Agents split on these (D accepted, C
  recommended) - carried over; will fix if round 2 judges them blocking.
- Sidebar / mobile-drawer nav greying + `BookmarkTooltip`: desktop Header nav is the
  primary surface (greyed); mobile follows the navigation-fallback path.

## Gate (end of round 1, after fixes)

- `bun run check`: exit 0 (1232 files 0/0 + SW gate).
- `bun run lint`: exit 0.
- `bun run build`: exit 0.

## Next

Round 2: re-audit with the carry-over list; target 5/5 UNCONDITIONAL_PASS. The
`requestSubmit` bypass fix is the highest-risk change to re-verify.
