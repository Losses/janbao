import type { D1Db } from './db/index';
import { categoryPermissions, categories } from './db/schema';
import { and, eq, isNull } from 'drizzle-orm';

const DEV_JWT_SECRET = 'fallback-secret-key-for-local-dev-only';

export function getJwtSecret(platformEnv: App.Platform['env'] | undefined): string {
	const secret = platformEnv?.JWT_SECRET || process.env.JWT_SECRET;
	if (!secret) {
		// Fail closed in production builds: a missing JWT_SECRET would otherwise
		// silently sign/verify with a publicly-known secret, allowing trivial
		// token forgery. The insecure fallback is only ever used in local dev.
		if (import.meta.env.DEV) {
			console.warn(
				'[SECURITY WARNING] JWT_SECRET is not set. Using insecure fallback. Never deploy this to production.'
			);
			return DEV_JWT_SECRET;
		}
		throw new Error(
			'JWT_SECRET is not configured. Refusing to run with an insecure secret in a production build.'
		);
	}
	return secret;
}

export function getCookieSecure(url: URL): boolean {
	return url.protocol === 'https:';
}

/**
 * Resolve the site's public origin for link construction (RSS feed links/guids,
 * etc.). Prefers a configured SITE_URL so a client-controlled Host /
 * X-Forwarded-Host header can't poison generated URLs (feed cache-poisoning /
 * phishing); falls back to the request's own origin.
 */
export function getSiteUrl(platformEnv: App.Platform['env'] | undefined, url: URL): string {
	const configured = platformEnv?.SITE_URL || process.env.SITE_URL;
	if (configured) return configured.replace(/\/+$/, '');
	return `${url.protocol}//${url.host}`;
}

export const SYSTEM_USER_ID = -1;

/**
 * Offline cache retention in days. Cached discussions scroll out of the offline
 * store once they are no longer on the front page AND older than this window.
 * Read from platform env (Cloudflare) or process.env (local), defaulting to 14.
 */
export function getOfflineRetentionDays(platformEnv: App.Platform['env'] | undefined): number {
	const raw = platformEnv?.OFFLINE_RETENTION_DAYS || process.env.OFFLINE_RETENTION_DAYS;
	if (raw) {
		const n = parseInt(raw, 10);
		if (!isNaN(n) && n > 0) return n;
	}
	return 14;
}

/**
 * The bootstrap admin (id 0), seeded from ADMIN_EMAIL/ADMIN_PASSWORD when no
 * admin-group user exists yet. It is the only account that may promote another
 * user into the `admin` group or generate reset links for other admins - i.e.
 * the super-admin. See src/lib/server/db/seed.ts.
 */
export const BOOTSTRAP_ADMIN_ID = 0;

/**
 * Sentinel for "original author no longer exists". Vanilla reserves UserID 0 for
 * this (rendered as "Unknown"); we remap it onto -2 so the positive id space  -
 * including id 0 (the seeded admin)  - stays clear for real accounts.
 */
export const GHOST_USER_ID = -2;

/** Allowlist of valid draft context types, shared by the save/clear/delete endpoints. */
export const DRAFT_CONTEXT_TYPES = ['discussion', 'reply', 'message', 'activity'] as const;

/**
 * Pagination limit helpers. Read from platform env (Cloudflare) or process.env (local),
 * falling back to spec defaults.
 */
export function getDiscussionsLimit(platformEnv: App.Platform['env'] | undefined): number {
	const raw = platformEnv?.DISCUSSIONS_LIMIT || process.env.DISCUSSIONS_LIMIT;
	if (raw) {
		const parsed = parseInt(raw, 10);
		if (!isNaN(parsed) && parsed > 0) return parsed;
	}
	return 20;
}

interface PaginationParams {
	page: number;
	limit: number;
	offset: number;
}

/**
 * Parse a `pN` path segment (the optional [[page=page]] matcher yields e.g. "p3").
 * Returns 1 when the param is absent or malformed, so callers can pass
 * `event.params.page` directly - undefined collapses to page 1.
 */
export function parsePagePathParam(raw: string | undefined): number {
	if (!raw) return 1;
	const parsed = parseInt(raw.substring(1), 10);
	return !isNaN(parsed) && parsed >= 1 ? parsed : 1;
}

/**
 * Resolve discussion-list pagination from a `pN` path param rather than a
 * `?page=` query string. Home (`/`) passes undefined → always page 1;
 * `/discussions/pN` and `/category/[slug]/pN` pass `event.params.page`.
 */
export function parseDiscussionPageFromPath(
	rawPage: string | undefined,
	platformEnv: App.Platform['env'] | undefined
): PaginationParams {
	const page = parsePagePathParam(rawPage);
	const limit = getDiscussionsLimit(platformEnv);
	const offset = (page - 1) * limit;
	return { page, limit, offset };
}

/**
 * Resolve discussion-list pagination from a `?page=` query string. Used by
 * listings that still paginate via query params (e.g. profile/discussions);
 * home and category use {@link parseDiscussionPageFromPath} instead.
 */
export function parseDiscussionPagination(
	url: URL,
	platformEnv: App.Platform['env'] | undefined
): PaginationParams {
	const pageParam = url.searchParams.get('page');
	let page = pageParam ? parseInt(pageParam, 10) : 1;
	if (isNaN(page) || page < 1) {
		page = 1;
	}
	const limit = getDiscussionsLimit(platformEnv);
	const offset = (page - 1) * limit;
	return { page, limit, offset };
}

export function getPaginationLimit(platformEnv: App.Platform['env'] | undefined): number {
	const raw = platformEnv?.PAGINATION_LIMIT || process.env.PAGINATION_LIMIT;
	if (raw) {
		const parsed = parseInt(raw, 10);
		if (!isNaN(parsed) && parsed > 0) return parsed;
	}
	return 50;
}

export function getActivitiesLimit(platformEnv: App.Platform['env'] | undefined): number {
	const raw = platformEnv?.ACTIVITIES_LIMIT || process.env.ACTIVITIES_LIMIT;
	if (raw) {
		const parsed = parseInt(raw, 10);
		if (!isNaN(parsed) && parsed > 0) return parsed;
	}
	return 15;
}

export function getMonthlyInvitationLimit(platformEnv: App.Platform['env'] | undefined): number {
	const raw = platformEnv?.MONTHLY_INVITATION_LIMIT || process.env.MONTHLY_INVITATION_LIMIT;
	if (raw) {
		const parsed = parseInt(raw, 10);
		if (!isNaN(parsed) && parsed >= 0) return parsed;
	}
	return 5;
}

export function getForumTimezone(platformEnv: App.Platform['env'] | undefined): string {
	return platformEnv?.FORUM_TIMEZONE || process.env.FORUM_TIMEZONE || 'UTC';
}

export function getAllowSlugChange(platformEnv: App.Platform['env'] | undefined): boolean {
	const raw = platformEnv?.ALLOW_SLUG_CHANGE || process.env.ALLOW_SLUG_CHANGE;
	return raw === 'true';
}

export function getAllowGuestActivity(platformEnv: App.Platform['env'] | undefined): boolean {
	const raw = platformEnv?.ALLOW_GUEST_ACTIVITY || process.env.ALLOW_GUEST_ACTIVITY;
	return raw === 'true';
}

/**
 * Whether logged-out visitors may use the "Users" search scope. Defaults false:
 * user discovery is members-only. Logged-in users can always search users.
 */
export function getAllowGuestUserSearch(platformEnv: App.Platform['env'] | undefined): boolean {
	const raw = platformEnv?.ALLOW_GUEST_USER_SEARCH || process.env.ALLOW_GUEST_USER_SEARCH;
	return raw === 'true';
}

/**
 * Whether logged-out visitors may view profile pages. Defaults false. NOTE: this
 * is stricter than the prior behavior (profiles used to be fully public with SEO
 * slugs); set ALLOW_GUEST_PROFILE_VIEW=true to restore public profile access.
 */
export function getAllowGuestProfileView(platformEnv: App.Platform['env'] | undefined): boolean {
	const raw = platformEnv?.ALLOW_GUEST_PROFILE_VIEW || process.env.ALLOW_GUEST_PROFILE_VIEW;
	return raw === 'true';
}

/**
 * Resolved category-level CRUD permission flags.
 * When no explicit categoryPermissions row exists, defaults are applied
 * based on the resolved groupSlug:
 *   guest  → canRead=true (public), rest false
 *   member → canRead=true, canCreate=true, rest false
 *   admin / moderator → all true
 */
export interface ResolvedPermissions {
	canRead: boolean;
	canCreate: boolean;
	canUpdate: boolean;
	canDelete: boolean;
}

interface UserData {
	groupSlug: string;
}

/**
 * Centralised permission resolver. Queries categoryPermissions for the
 * given (categorySlug, groupSlug) pair and fills in default flags when no
 * database record is found.
 */
export async function resolvePermissions(
	db: D1Db,
	categorySlug: string,
	user: UserData | null | undefined
): Promise<ResolvedPermissions> {
	const groupSlug = resolveGroupSlug(user);

	const categoryRows = await db
		.select({ slug: categories.slug })
		.from(categories)
		.where(and(eq(categories.slug, categorySlug), isNull(categories.disabledAt)))
		.limit(1);

	if (categoryRows.length === 0) {
		return { canRead: false, canCreate: false, canUpdate: false, canDelete: false };
	}

	const rows = await db
		.select()
		.from(categoryPermissions)
		.where(
			and(
				eq(categoryPermissions.categorySlug, categorySlug),
				eq(categoryPermissions.groupSlug, groupSlug)
			)
		)
		.limit(1);

	if (rows.length > 0) {
		const row = rows[0];
		return {
			canRead: row.canRead,
			canCreate: row.canCreate,
			canUpdate: row.canUpdate,
			canDelete: row.canDelete
		};
	}

	// No explicit permission row → apply role-based defaults
	switch (groupSlug) {
		case 'admin':
		case 'moderator':
			return { canRead: true, canCreate: true, canUpdate: true, canDelete: true };
		case 'member':
			return { canRead: true, canCreate: true, canUpdate: false, canDelete: false };
		default:
			// guest or unknown
			return { canRead: true, canCreate: false, canUpdate: false, canDelete: false };
	}
}

/**
 * Resolve the effective groupSlug for the current request context.
 * Returns 'guest' when no user is authenticated.
 */
export function resolveGroupSlug(user: UserData | null | undefined): string {
	return user?.groupSlug || 'guest';
}

/**
 * Get the enabled category slugs the given group can read.
 *
 * The category list and the per-group permission rows are independent reads, so
 * they are fired together and awaited once. This halves the wall-clock latency
 * of the previous sequential form (two awaited queries back-to-back), which
 * matters because every discussion-list page load resolves this set before the
 * main list/count queries can start.
 */
export async function getReadableCategorySlugs(db: D1Db, groupSlug: string): Promise<string[]> {
	const isFullAccess = groupSlug === 'admin' || groupSlug === 'moderator';
	const [allCats, permRows] = await Promise.all([
		db.select({ slug: categories.slug }).from(categories).where(isNull(categories.disabledAt)),
		isFullAccess
			? Promise.resolve([])
			: db
					.select({
						categorySlug: categoryPermissions.categorySlug,
						canRead: categoryPermissions.canRead
					})
					.from(categoryPermissions)
					.where(eq(categoryPermissions.groupSlug, groupSlug))
	]);
	const allSlugs = allCats.map((c) => c.slug);

	if (allSlugs.length === 0) return [];
	if (isFullAccess) return allSlugs;

	const permMap = new Map(permRows.map((p) => [p.categorySlug, p.canRead]));

	return allSlugs.filter((slug) => {
		const canRead = permMap.get(slug);
		return canRead === undefined ? true : canRead;
	});
}
