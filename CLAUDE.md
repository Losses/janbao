# Janbao Forum — Project Instructions

## Linting

Run `bun run lint` — it chains prettier → eslint → similarity-ts.

### Type rules (zero tolerance)

- **No inline typing** — all types must be named. Object shapes → `interface`, function signatures → `type`.
- **`interface` over `type`** — use `interface` for any object shape; `type` only for unions, function types, and other non-object forms.
- Even `() => void` inside an interface property must reference a named type.
- Shared callback types: import from `$lib/types/handlers` (`VoidHandler`, `MouseEventHandler`).
- See `eslint.config.js` `no-restricted-syntax` rules for exact selectors.

### similarity-ts

- Binary auto-downloaded to `bin/` (gitignored) by `scripts/ensure-similarity.ts`.
- Type duplicates must be 0. Function-level similarities are informational — auth guard patterns in API handlers are intentionally duplicated.

## Architecture

- **SvelteKit** with Svelte 5 runes (`$state`, `$derived`, `$props`, `$effect`).
- **Cloudflare Workers** + D1 in production; `bun:sqlite` locally.
- **Drizzle ORM** for database queries.
- Component props always defined as named interfaces in the `<script>` block.
- DAO types (e.g. `DiscussionListItem`, `ReadHistory`) exported from `src/lib/server/db/dao/`.
- Pagination: use `parseDiscussionPagination(url, platformEnv)` from `$lib/server/constants`.
- LexicalEditor uses structural types to avoid cross-package version conflicts with `svelte-lexical`.
