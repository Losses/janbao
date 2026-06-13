import type { D1Db } from './db/index';
import { categoryPermissions, categories } from './db/schema';
import { and, eq } from 'drizzle-orm';

const DEV_JWT_SECRET = 'fallback-secret-key-for-local-dev-only';

export function getJwtSecret(platformEnv: App.Platform['env'] | undefined): string {
	const secret = platformEnv?.JWT_SECRET;
	if (!secret) {
		console.warn(
			'[SECURITY WARNING] JWT_SECRET is not set. Using insecure fallback. Never deploy this to production.'
		);
		return DEV_JWT_SECRET;
	}
	return secret;
}

export function getCookieSecure(url: URL): boolean {
	return url.protocol === 'https:';
}

export const SYSTEM_USER_ID = -1;

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
 * Get the list of category slugs the given group can read.
 * Returns null if all categories are readable (admin/moderator default).
 */
export async function getReadableCategorySlugs(
	db: D1Db,
	groupSlug: string
): Promise<string[] | null> {
	if (groupSlug === 'admin' || groupSlug === 'moderator') {
		return null;
	}

	const allCats = await db.select({ slug: categories.slug }).from(categories);
	const allSlugs = allCats.map((c) => c.slug);

	if (allSlugs.length === 0) return [];

	const permRows = await db
		.select({
			categorySlug: categoryPermissions.categorySlug,
			canRead: categoryPermissions.canRead
		})
		.from(categoryPermissions)
		.where(eq(categoryPermissions.groupSlug, groupSlug));

	const permMap = new Map(permRows.map((p) => [p.categorySlug, p.canRead]));

	return allSlugs.filter((slug) => {
		const canRead = permMap.get(slug);
		return canRead === undefined ? true : canRead;
	});
}
