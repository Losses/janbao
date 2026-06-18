# DV06 C03 Journal - Offline-Aware UX (Disable Sweep) Audit Loop

Method: 5 parallel independent full-audit agents (no roles), loop until 5/5
unconditional PASS. See [[dv04-audit-loop]]. Plan: DV06-Plan.md.

## Pre-audit dev notes

Per the user's decisions (mid-C02): bookmark = disabled (not queued); grey out every
server-dependent affordance when offline; forced-URL access to server-only pages is
caught by the SW's `offline.html` (network-first navigation) + the offline banner;
list pages show an "unavailable offline" empty state. Expose a reactive `isOnline`
flag app-wide.

Built:

- `src/lib/stores/online.svelte.ts` - module-level reactive `online` flag (mirrors the
  badges store pattern), seeded/updated by the root layout.
- `src/routes/+layout.svelte` - layout now drives the shared store (replacing its local
  `isOnline`); banner + sync trigger unchanged.
- `src/lib/i18n/{en,zh-CN}.json` - `offline.disabled.{title,hint,button}`.
- `src/lib/components/organisms/Header.svelte` - desktop nav links to activity /
  messages / search grey out (`opacity-40 pointer-events-none cursor-not-allowed`) +
  `aria-disabled` when offline.
- `src/lib/components/organisms/DiscussionRow.svelte` - bookmark star disabled offline
  (button `disabled` + `toggleBookmark` early-return).
- Write submits disabled offline: `post/discussion` publish button; the discussion
  page's inline reply submit.
- List pages collapse to the offline empty-state when offline (merged into each page's
  existing `length === 0` branch): bookmarks, notifications, messages/inbox, activity,
  search.

## Scope boundary (carry-overs, documented with rationale)

The disable sweep covers the primary in-flow surfaces. These remain enabled but are
covered by the SW's network-first navigation fallback (`offline.html`) for offline
NAVIGATION, plus the offline banner - a user cannot reach them via normal clicks while
offline (the nav request fails → `offline.html`):

- `post/editDiscussion`, `messages/new`, `ActivityComments`, `PrivateMessageWindow`
  submit buttons (secondary write surfaces reached by navigation).
- Admin / entry / profile-edit forms (forced-URL only; SW catches the navigation).
- Sidebar / mobile-drawer nav greying and `BookmarkTooltip` (the desktop Header nav is
  the primary surface and is greyed).

If round-1 agents judge any of these as a real dead-end (e.g. an in-flow edit-reply
button on a page the user is already viewing when they go offline), they'll be fixed in
round 2.

## Round 1

- 5 agents. Verdict: 2/5 UNCONDITIONAL_PASS (A, B), 3/5 FAIL (C, D, E).
- MAJOR consensus (C/D/E): a `disabled` submit button is bypassed by the editor's
  Ctrl+Enter → `form.requestSubmit()` path (requestSubmit ignores button disabled).
  Fixed: the `post/discussion` publish + discussion reply `onSubmit` callbacks now also
  gate on `online.online`.
- MAJOR (C/D): the activity page's own composer was left enabled offline while its list
  collapsed to the empty-state. Fixed: composer submit disabled + `submitActivity`
  early-return offline.
- MAJOR (C/D): the discussion page's inline edit-reply (Edit button + Save) was
  unguarded offline. Fixed: Save `disabled` + Edit `onclick` early-return offline.
- MAJOR (C): notifications "Mark all read" unguarded. Fixed: button disabled offline.
- MINOR: removed unused `offline.disabled.{hint,button}` i18n keys; added
  `tabindex=-1` to offline Header nav links for keyboard a11y.
- Carry-overs: navigation-reached secondary write surfaces (editDiscussion, messages/new,
  ActivityComments, PrivateMessageWindow) + admin/entry/profile-edit forms (SW
  offline.html + banner); discussion-page moderator actions (delete/pin) - agents split,
  carried; sidebar/mobile nav greying.
- Gate: check 0/0, lint exit 0, build exit 0. See RV06-C03-Audit-01.md.
- Advancing to round 2 targeting 5/5 UNCONDITIONAL_PASS.

## Round 2

- 5 agents. Verdict: 2/5 PASS/PASS_WITH_NOTES (A, B, C), 3/5 with findings (D, E).
- MAJOR consensus (D/E, C info): the **shared LexicalEditor 30s autosave** fired
  `/api/drafts/save` on every compose surface offline (silently). Fixed: the interval
  early-returns when offline (one shared fix).
- MAJOR (E): NotificationTooltip `markAllRead` (separate from the /notifications page
  one) fired offline incl. the auto-fire `$effect`. Fixed: early-return guard.
- markAllRead function-level guard added on the /notifications page (A/B/C/D).
- Publish-page Save-Draft button disabled offline (D/E).
- MINOR: search submit button disabled offline; discussion Edit button gained a visual
  `disabled` (already had the onclick guard).
- Carry-overs: ActivityRow delete (rows not rendered offline - non-issue); list-page
  reconnect auto-refresh (data in memory); RichTextToolbar image upload; moderator
  delete/pin; nav-reached secondary surfaces + admin/entry forms; public discussion lists.
- Gate: check 0/0, lint exit 0, build exit 0. See RV06-C03-Audit-02.md.
- Advancing to round 3 targeting 5/5 UNCONDITIONAL_PASS.

## Round 3

- 5 agents. Verdict: 3/5 PASS (A, B, C), 2/5 with findings (D, E).
- MAJOR (D/E): the **editDiscussion** page (twin of post/discussion) had zero offline
  gating. Fixed: onSubmit + Save-Draft + Update + saveDraftManual all gated.
- MAJOR (E, D): **PrivateMessageWindow** in-thread compose + inline edit-message (twins
  of discussion reply + edit-reply) + **messages/new** send were unguarded. Fixed:
  onSubmit + submit buttons + startEdit/send guards.
- MINOR (A/B/E): notifications-page markAllRead gained the function-level self-guard.
- Carry-overs unchanged: admin/entry/profile forms, moderator delete/pin, RichTextToolbar
  upload, ActivityComments (nav-reached), sidebar/mobile nav, public discussion lists;
  ActivityRow delete (not rendered offline); list reconnect (data in memory).
- Gate: check 0/0, lint exit 0, build exit 0. See RV06-C03-Audit-03.md.
- Advancing to round 4 targeting 5/5 UNCONDITIONAL_PASS. All primary
  authoring/messaging/list surfaces are now gated.
