# DV05 Plan - Post-Throttle Anti-Duplicate Submission

## Goal

Stop "duplicate dense posting" seen in production. Root cause: user-content
write surfaces had no server-side protection, and the frontend
`isSubmitting`/`disabled` guard has an async-DOM race that also cannot span
tabs or network retries. Fix = two layers:

- **Server-side rate limiting**: a dedicated `rate_limits` table (physically
  isolated from `authThrottle`) plus `enforceRateLimit` / `enforcePostThrottle`,
  keyed per user (`user:<id>`), with one bucket per surface, tuned by env
  (`POST_THROTTLE_WINDOW_SEC` default 10, `POST_THROTTLE_LIMIT` default 1).
- **Frontend sync lock**: form surfaces cancel the second submit inside
  `use:enhance={({ cancel }) => ...}`; fetch surfaces early-return on the
  in-flight flag.

## Scope (user-content CREATE surfaces)

- `post:discuss` - create discussion (post/discussion publish action)
- `post:reply` - reply (discussion detail reply action)
- `post:message` - PM reply (messages/[id] post action)
- `post:conversation` - create conversation + first message (api/messages POST)
- `post:activity` - activity post (api/activities POST)
- `post:activity_comment` - activity comment (api/activities/comments POST)

Edit / UPDATE surfaces are intentionally excluded (idempotent - no duplicate
record). See carry-overs in the round reports.

## Method

Per [[dv04-audit-loop]]: 5 parallel independent full-audit agents (no roles),
loop until 5/5 UNCONDITIONAL_PASS (PASS_WITH_NOTES does not count). Gate each
round with `bun run check` (0 errors) and `bun run lint` (exit 0); run
`prettier --write` on every touched doc as the last step before each re-audit
(see [[markdown-table-pipe-gotcha]]).

## Artifacts

- `DV05-Plan.md` - this file
- `DV05-C01-Journal.md` - per-round log
- `RV05-C01-Audit-0<N>.md` - consolidated round reports

## Deployment note (ops checklist, not a code defect)

The `rate_limits` migration `0011_cute_absorbing_man.sql` auto-applies on local
libsql connect; production D1 must be applied manually via
`wrangler d1 execute` per [[prod-d1-migration-manual]] before deploy, or all six
surfaces throw "no such table" and return 500.
