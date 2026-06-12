# DV00-C01-Journal: Cycle 1 Development & Verification Journal

## 1. Executive Summary

This journal documents the design, implementation, and verification of **Cycle 1: Foundations, Schemas, Core Seed & Authentication** as defined in [RQ00-Plan.md](file:///home/losses/Development/janbao/docs/RQ00-Plan.md).

All code has been developed adhering to the strict architectural paradigms of **Atomic Component Design** on the frontend, **Atomic Backend Design** on the server, and under compile-time and lint-time type safety restrictions (prohibiting all `any`, `as any`, and `as unknown as` assertions).

---

## 2. Implemented Modules

### 2.1 Database & Schema (`src/lib/server/db/`)

- **Schema Definitons ([schema.ts](file:///home/losses/Development/janbao/src/lib/server/db/schema.ts)):** Relational SQLite database structures using Drizzle ORM.
  - Tables implemented: `userGroups`, `users`, `notificationPreferences`, `categories`, `discussions`, `replies`, `discussionReads`, `bookmarks`, `userInvitations`, `invitations`, `privateMessages`, `notifications`, and `systemLogs`.
  - Indexes implemented: Multi-column composite and unique indexes for fast lookups (e.g., `unique_read_idx`, `unread_notifications_idx`, `pm_participants_idx`).
- **Core Seeding ([seed.ts](file:///home/losses/Development/janbao/src/lib/server/db/seed.ts)):** Provisions the core default database state.
  - User groups seeded: `system` (restricted automation), `admin` (super-admin), `moderator`, and `member`.
  - System User seeded: `00000000-0000-0000-0000-000000000000` with disabled password and stealth flags to satisfy database constraints and support system actions.

### 2.2 Security & Cryptography (`src/lib/server/auth.ts`)

- **Password Hashing:** Fully native Web Crypto API cryptographic wrapper.
  - Uses `PBKDF2` with SHA-256 derivation over 100,000 iterations and a random 16-byte salt to store passwords securely. Constant-time string matching for verification protects against timing attacks.
- **Session Tokens:** Native Web Crypto API based JSON Web Tokens.
  - Signed using HMAC SHA-256 (`HS256`) signature authentication. Resolves and verifies payloads containing user identity, group membership, and token expiration. Zero external library dependencies (Node or native C-bindings), guaranteeing compatibility with Cloudflare Workers.

### 2.3 Global SvelteKit Middleware ([src/hooks.server.ts](file:///home/losses/Development/janbao/src/hooks.server.ts))

- **Auth Middleware:**
  - Retrieves the `session_token` cookie on every incoming request.
  - Decodes and verifies the JWT against `platform.env.JWT_SECRET` (falling back to a secure local developer key when platform bindings are not yet populated).
  - Resolves user records dynamically from the database.
  - Redacts the `passwordHash` field explicitly during user object instantiation to prevent accidental leakage in templates.
- **Active Tracking:** Updates the user's `lastActiveTime` asynchronously in the database. Features a throttled cooldown check of 60 seconds to minimize write operations to SQLite/D1.
- **i18n Middleware:** Resolves user language preference dynamically. Reads browser `Accept-Language` headers and merges them with database user profile selections, populating the `event.locals.t` localization schema.

### 2.4 Localization Services ([src/lib/server/i18n.ts](file:///home/losses/Development/janbao/src/lib/server/i18n.ts))

- Static translation files configured:
  - English ([en.json](file:///home/losses/Development/janbao/src/lib/i18n/en.json)) and Simplified Chinese ([zh-CN.json](file:///home/losses/Development/janbao/src/lib/i18n/zh-CN.json)).
  - Strictly typed layout schemas for navigation, authentication views, and common status messages.

### 2.5 Server API Controllers (`src/routes/api/auth/`)

- `/api/auth/register` (POST): Validates active invitation codes, verifies unique usernames/emails, enforces password lengths, and marks invitation codes as used inside an ACID transaction.
- `/api/auth/login` (POST): Performs credential checks, issues JWT session cookie (supporting permanent 30-day cookie retention via `rememberMe`).
- `/api/auth/logout` (POST): Deletes the `session_token` cookie.

### 2.6 Frontend Layout Templates & Views (`src/routes/`)

- **Layout Templates ([src/lib/components/templates/](file:///home/losses/Development/janbao/src/lib/components/templates/)):**
  - `SingleColumnLayout.svelte`: Centered single-column wrapper for gateway forms.
  - `DualColumnLayout.svelte`: Responsive double-column shell featuring right sidebars for desktops and off-canvas drawers for mobile viewports.
- **Gateway Pages ([src/routes/entry/](file:///home/losses/Development/janbao/src/routes/entry/)):**
  - `/entry/signin` & `/entry/register`: Forms featuring validation, inline errors, and loading state hooks.
  - `/entry/signout`: Simple logout page confirming action before execution.
- **Home View ([src/routes/+page.svelte](file:///home/losses/Development/janbao/src/routes/+page.svelte)):**
  - Connects the user session metadata and displays a welcome layout. Shows layout toggle menus, basic profile statistics, and responsive headers.

---

## 3. Verification & Code Safety Compliance

- **Strict Typing Compliance:**
  - Standard ESLint rules and TypeScript compilation checked via `bun run lint` and `bun run build`.
  - Prohibits all occurrences of `any`, `as any`, and `as unknown as` assertions. All values are typed explicitly or resolve dynamically via SvelteKit layout generators.
- **Session Verification:**
  - Checked that JWT signatures parse correctly.
  - Database queries select safely without carrying user password hashes to locals.
- **Database Seeding Verification:**
  - Automated seeding checks for system groups on startup, preventing runtime foreign key violations.

---

## 4. Audit & Quality History

This section lists the consecutive audit logs and resolutions.

### Round 1 Audit (2026-06-12)

- **Status:** In Progress
- **Audit File:** [RV00-C01-Audit-01.md](file:///home/losses/Development/janbao/docs/RV00-C01-Audit-01.md)
- **Defects Identified:** (To be completed during audit run)
- **Resolutions:** (To be completed during audit run)
