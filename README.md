# Janbao

A forum application built with SvelteKit, designed to run on Cloudflare Workers
with D1 in production. Janbao was migrated from a legacy Vanilla-forums dataset
 - the discussion corpus, users, comments, avatars, and content images are all
imported from a crawl via the scripts documented below.

## Tech stack

- **SvelteKit** + **Svelte 5 runes** (`$state`, `$derived`, `$props`, `$effect`)
- **Cloudflare Workers** + **D1** in production; **libsql** (via `@libsql/client`) for local dev
- **Drizzle ORM** for all database access
- **Lexical** rich-text editor (`svelte-lexical`), with custom nodes for `@mention`
  chips and `dead-image` placeholders
- **pCloud WebDAV** for image storage (avatars + content attachments), reverse-proxied
  by streaming routes (`/avatar/[userId]`, `/attachment/[fileId]`)
- **TailwindCSS** + **daisyUI**

## Features

- Discussions with the OP body stored as the earliest reply; paginated comment streams
- `@username` mentions rendered as profile-linking chips
- Activity feed, private messages, bookmarks, notifications, invitations
- Categories, user groups, stealth/visibility settings
- Rich-text editor: images, links, lists, quotes, code, spoiler/highlight
- Images stored on pCloud as webp (converted at import time), served straight from pCloud
  in both local and production

## Standard commands

```sh
bun install            # install deps
bun run dev            # local dev server (auto-loads .env; libsql at .local.db)
bun run build          # production build
bun run lint           # prettier → eslint → similarity-ts
bun run check          # svelte-check (type-check)
bun run db:generate:local   # generate a local drizzle migration from schema changes
```

> **Local DB note:** local dev uses **libsql** (not `bun:sqlite`). `getLocalDb()`
> auto-applies migrations from `drizzle/local-migrations/` on first use. The DB
> file is `.local.db`.
>
> **Stop the dev server before running DB-writing scripts** (import / migrations):
> the dev server holds the libsql connection, and concurrent writes fail with
> `SQLITE_IOERR`.

---

## Scripts

Two standalone scripts live in `scripts/`. Run them with `bun scripts/<name>.ts`.

### 1. pCloud setup  - `scripts/setup-pcloud.ts`

One-time setup that configures pCloud image storage. Run it **before** the first
import or any image serving.

pCloud disabled password-based REST login (it now requires the web OAuth flow),
so images are stored over **WebDAV**, which authenticates every request with HTTP
Basic auth (email + password). The account **must not have 2FA enabled** for
WebDAV to work.

```sh
bun scripts/setup-pcloud.ts
```

It interactively prompts for:

- **pCloud email** and **password** (the password is used only for this login and
  is written to `.env`; WebDAV needs it on every request  - there is no token).
- **Region**  - `EU` (default, uses `ewebdav.pcloud.com`) or `US` (`webdav.pcloud.com`).

It then:

1. Creates the project folder `/Janbao` and the image sub-folders
   `/Janbao/avatars` and `/Janbao/attachments` under your pCloud account root.
   (MKCOL also verifies the credentials  - a 401 means wrong email/password or 2FA is on.)
2. Writes `PCLOUD_USERNAME`, `PCLOUD_PASSWORD`, `PCLOUD_WEBDAV_HOST`, and
   `PCLOUD_BASE_PATH` to `.env`.

For **production** (Cloudflare), set the same values as secrets:

```sh
wrangler secret put PCLOUD_USERNAME
wrangler secret put PCLOUD_PASSWORD
wrangler secret put PCLOUD_WEBDAV_HOST     # ewebdav.pcloud.com for EU
wrangler secret put PCLOUD_BASE_PATH        # /Janbao
```

### 2. Data import  - `scripts/import-data.ts`

Imports a crawled Vanilla-forums dataset into the local D1 database and uploads
all images to pCloud. Idempotent  - safe to re-run; already-imported rows and
already-uploaded images are skipped.

#### Prerequisites

- Run `scripts/setup-pcloud.ts` first (pCloud credentials in `.env`, folders created).
- **Stop the dev server** (see the note above  - concurrent libsql writes fail).
- `cwebp` and `gif2webp` on `PATH` (the `libwebp` package)  - used to convert
  images to webp. The script checks at startup and errors clearly if missing
  (e.g. `nix-env -iA nixos.libwebp`, `brew install webp`, or `apt install webp`).

#### Usage

```sh
bun scripts/import-data.ts <path-to-data-directory>
# e.g.
bun scripts/import-data.ts ~/Downloads/data
```

#### Expected data layout (under `<data-directory>`)

```
posts/posts-*.jsonl            discussion metadata (title, author, counts)
profiles/<userId>/             per-user crawl:
  profile.html                 user details + activity feed
  discussions-page-*.json      discussions this user started
  comments-page-*.json         comments this user wrote
discussions/<id>/page-*.html   full discussion pages (OP body + comments)
users.json                     userId → username map (drives @mention resolution)
images.json                    crawled image URL → {sha256, file, contentType}
image-deadlinks.jsonl          image URLs that failed to download (→ dead-image)
profile-avatars.json           userId → crawled avatar {file, contentType}
```

#### What it does

1. Seeds user groups + the default category, and the `GHOST_USER_ID` (-2)
   sentinel for deleted/unknown users.
2. Imports discussions (metadata), users, replies (comments), and OP bodies (the
   OP is stored as the chronologically earliest reply). `@mentions` resolve to
   real users via the `users.json` username map.
3. Converts every referenced content image to **webp** (`cwebp` for static,
   `gif2webp` for animated GIFs  - format detected from magic bytes, not the
   often-wrong crawl label) and uploads it to `/Janbao/attachments/<sha256>`
   (keyed by the pre-conversion sha256, so identical images dedup). Uploads run
   **32-way parallel**. Dead links (failed downloads / non-images) become
   `dead-image` placeholder nodes.
4. Converts + uploads avatars to `/Janbao/avatars/<userId>` (filename = userId,
   overwrite-friendly) and sets `users.avatarFileId` (a truthy flag) +
   `users.avatarContentType`.

The import writes a detailed conflict log to `import-conflicts.json` and prints
a summary. Typical benign conflicts: deleted-user insert collisions, comments
whose parent discussion was never crawled (skipped), title-only OPs with empty
bodies, and crawled "images" that are actually HTML error pages (→ dead-image).

#### Re-runs

Re-running skips work that's already done: existing DB rows (by id) and files
already on pCloud (`listfolder` check, "ls before migration"). So a re-run after
a partial failure, or after a code/schema change, completes only the missing
pieces  - usually just DB metadata rows, fast.
