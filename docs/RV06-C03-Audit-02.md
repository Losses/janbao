# RV06 · Round 2 Audit - Offline-Aware UX Disable Sweep (C03)

Re-audit of DV06 Cycle 3 after the Round 1 fixes. Method: 5 parallel independent
full-audit agents (no roles), per [[dv04-audit-loop]].

## Round 2 verdicts (5 independent full-audit agents)

- Agent A: PASS_WITH_NOTES (markAllRead function guard - LOW)
- Agent B: PASS (markAllRead guard LOW; search form controls LOW)
- Agent C: PASS (markAllRead guard LOW; search LOW)
- Agent D: CONDITIONAL_FAIL (LexicalEditor autosave CRITICAL; Save-Draft; markAllRead; search)
- Agent E: FAIL (NotificationTooltip markAllRead; autosave; Save-Draft; search; Edit visual)

2/5 PASS, 3/5 with findings. Consensus: the **shared LexicalEditor 30s autosave timer**
fires `/api/drafts/save` on every editor surface while offline (silently caught, but a
real offline write that bypassed the per-button disables), plus the `markAllRead`
functions lacked self-guards, the publish-page Save-Draft button was unguarded, the
NotificationTooltip's markAllRead (a separate surface) fired offline, and a few visual
disables were missing.

## MAJOR - fixed this round (round 2 -> round 3)

- **Shared editor autosave fires offline** (`LexicalEditor.svelte`). The 30s
  `startAutosave` interval POSTed `/api/drafts/save` with no online check on every
  compose surface (publish, reply, edit-reply, activity). Fixed: the interval callback
  early-returns when `!getOnlineStore().online`. One shared fix closes it everywhere.
  (Agents D, E; C informational.)
- **NotificationTooltip `markAllRead` fired offline** (`NotificationTooltip.svelte`),
  including the auto-fire `$effect` when the bell opens with unread badges. Fixed:
  `markAllRead` early-returns offline. (Agent E.)
- **`/notifications` page `markAllRead` lacked a function-level guard** (button was
  disabled, but the handler had no defense-in-depth guard). Fixed: early-return offline.
  (Agents A, B, C, D.)
- **Publish-page Save-Draft button unguarded offline** (`post/discussion`). Fixed: button
  `disabled` includes `!online.online`. (Agents D, E.)

## MINOR - fixed this round

- Search submit button disabled offline (`search/+page.svelte`). (Agents B, D, E.)
- Discussion-page Edit button gained a visual `disabled={!online.online}` (it already had
  an onclick early-return guard). (Agent E.)

## Carry-overs (accepted with rationale - not re-fixed)

- **ActivityRow delete offline** (Agent E HIGH-2): non-issue - the activity list
  collapses to the offline empty-state, so `ActivityRow` is not rendered while offline
  (its delete button is unreachable).
- **List pages don't auto-refresh on reconnect** (Agent E HIGH-3): non-issue for the
  common case - the list data is in memory from the online load; the offline flag only
  hides/shows it. Auto-refetch-on-reconnect is a separate enhancement.
- **RichTextToolbar image upload** (Agent E): secondary editor action; primary write
  surfaces are disabled.
- **`saveDraftManual` function-level guard** (Agent D): the button is the only caller and
  is disabled offline; function guard is redundant defense-in-depth.
- Discussion-page moderator actions (delete-reply, delete-discussion, toggle-pin);
  navigation-reached secondary write surfaces (`post/editDiscussion`, `messages/new`,
  `ActivityComments`, `PrivateMessageWindow`); admin/entry/profile-edit forms; sidebar /
  mobile-drawer nav; the public home/category/categories discussion lists (read-only,
  SW-covered). All caught by the SW `offline.html` nav fallback + the offline banner.

## Gate (end of round 2, after fixes)

- `bun run check`: exit 0 (1232 files 0/0 + SW gate).
- `bun run lint`: exit 0.
- `bun run build`: exit 0.

## Next

Round 3: re-audit with the carry-over list; target 5/5 UNCONDITIONAL_PASS. The shared
autosave gate is the highest-impact change to re-verify (it touches every editor surface).
