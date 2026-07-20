import { count, eq, inArray } from 'drizzle-orm';
import { categories, categoryPermissions, userGroups, users } from '../schema';
import type { D1Db } from '../index';
import { BOOTSTRAP_ADMIN_ID } from '$lib/server/constants';
import type {
	AdminCategoryItem,
	AdminCategoryPermissionItem,
	AdminManageableGroupItem,
	AdminUserGroupItem
} from '$lib/types/api';

export const RESERVED_USER_GROUP_SLUGS = [
	'system',
	'admin',
	'moderator',
	'member',
	'guest'
] as const;

export function isReservedUserGroupSlug(slug: string): boolean {
	return RESERVED_USER_GROUP_SLUGS.includes(slug as ReservedUserGroupSlug);
}

export function isAssignableGroupSlug(slug: string): boolean {
	return !['system', 'admin', 'guest'].includes(slug);
}

/**
 * Groups whose per-category permissions can be edited in the admin panel.
 * Unlike {@link isAssignableGroupSlug} (which gates *assigning a group to a
 * user*), this is about *editing what a group may do in each category*.
 * `guest` is included so admins can configure what anonymous visitors may
 * read/create - its permissions are read from `categoryPermissions` at request
 * time (`resolvePermissions`), so they must be editable here. `system` and
 * `admin` stay excluded: `system` is never assigned, and `admin` always has
 * full access regardless of rows.
 */
const PERMISSION_EDITABLE_BLOCKLIST = ['system', 'admin'];

export function isPermissionEditableGroupSlug(slug: string): boolean {
	return !PERMISSION_EDITABLE_BLOCKLIST.includes(slug);
}

export type ReservedUserGroupSlug = (typeof RESERVED_USER_GROUP_SLUGS)[number];

export async function listUserGroupsWithCounts(db: D1Db): Promise<AdminUserGroupItem[]> {
	const [groups, counts] = await Promise.all([
		db.select().from(userGroups).orderBy(userGroups.slug),
		db.select({ groupSlug: users.groupSlug, value: count() }).from(users).groupBy(users.groupSlug)
	]);
	const countMap = new Map(counts.map((row) => [row.groupSlug, row.value]));
	return groups.map((group) => ({
		slug: group.slug,
		title: group.title,
		description: group.description,
		userCount: countMap.get(group.slug) ?? 0,
		reserved: isReservedUserGroupSlug(group.slug)
	}));
}

export interface ManageableUserGroupsOptions {
	/**
	 * When true (caller is the bootstrap super-admin), the reserved `admin` group
	 * is included in the list so promotion is exposed as a dropdown option rather
	 * than a separate button. Peer admins never see `admin`.
	 */
	includeAdmin?: boolean;
	/**
	 * When true, the reserved `guest` group is included so per-category guest
	 * permissions (what anonymous visitors may read/create) become editable in
	 * the category-permissions panel.
	 */
	includeGuest?: boolean;
}

export async function listManageableUserGroups(
	db: D1Db,
	options: ManageableUserGroupsOptions = {}
): Promise<AdminManageableGroupItem[]> {
	const groups = await db.select().from(userGroups).orderBy(userGroups.slug);
	return groups
		.filter(
			(group) =>
				isAssignableGroupSlug(group.slug) ||
				(options.includeAdmin && group.slug === 'admin') ||
				(options.includeGuest && group.slug === 'guest')
		)
		.map((group) => ({ slug: group.slug, title: group.title }));
}

export interface ProfileAdminSidebarData {
	groupSlug: string | null;
	email: string | null;
	manageableGroups: AdminManageableGroupItem[];
}

/**
 * Fetch the data `ProfileSidebar` needs to render admin controls for a target
 * user (group dropdown, reset-link copy email). Returns empty/null values when
 * the caller is not an admin, so this can be called from any profile sub-page
 * load without leaking data to non-admins.
 */
export async function getProfileAdminSidebarData(
	db: D1Db,
	callerGroupSlug: string | null | undefined,
	callerUserId: number | null | undefined,
	targetUserId: number
): Promise<ProfileAdminSidebarData> {
	const empty: ProfileAdminSidebarData = { groupSlug: null, email: null, manageableGroups: [] };
	if (callerGroupSlug !== 'admin') return empty;

	const [target, groups] = await Promise.all([
		db
			.select({ groupSlug: users.groupSlug, email: users.email })
			.from(users)
			.where(eq(users.id, targetUserId))
			.limit(1),
		listManageableUserGroups(db, { includeAdmin: callerUserId === BOOTSTRAP_ADMIN_ID })
	]);
	return {
		groupSlug: target[0]?.groupSlug ?? null,
		email: target[0]?.email ?? null,
		manageableGroups: groups
	};
}

export async function getUserGroupCount(db: D1Db, groupSlug: string): Promise<number> {
	const rows = await db
		.select({ value: count() })
		.from(users)
		.where(eq(users.groupSlug, groupSlug));
	return rows[0]?.value ?? 0;
}

export async function userGroupExists(db: D1Db, slug: string): Promise<boolean> {
	const rows = await db
		.select({ slug: userGroups.slug })
		.from(userGroups)
		.where(eq(userGroups.slug, slug));
	return rows.length > 0;
}

/**
 * Insert a new user group. The slug PK is the single source of truth for
 * uniqueness: a concurrent insert that lands the same slug first makes this
 * caller's insert a no-op, and the function returns `false` so the handler
 * can respond with a 409.
 *
 * Returns `true` when a row was inserted, `false` when the slug already
 * existed (ON CONFLICT DO NOTHING matched).
 */
export async function createUserGroup(
	db: D1Db,
	slug: string,
	title: string,
	description: string
): Promise<boolean> {
	const inserted = await db
		.insert(userGroups)
		.values({ slug, title, description, permissionsJson: '{}' })
		.onConflictDoNothing({ target: userGroups.slug })
		.returning({ slug: userGroups.slug });
	return inserted.length > 0;
}

export async function deleteUserGroup(db: D1Db, slug: string): Promise<void> {
	await db.delete(userGroups).where(eq(userGroups.slug, slug));
}

export async function updateUserGroupMeta(
	db: D1Db,
	slug: string,
	title: string,
	description: string
): Promise<void> {
	await db.update(userGroups).set({ title, description }).where(eq(userGroups.slug, slug));
}

export async function listAdminCategories(db: D1Db): Promise<AdminCategoryItem[]> {
	const rows = await db.select().from(categories).orderBy(categories.displayOrder);
	return rows.map((category) => ({
		slug: category.slug,
		title: category.title,
		description: category.description,
		priority: category.priority,
		displayOrder: category.displayOrder,
		themeName: category.themeName,
		disabledAt: category.disabledAt
	}));
}

export async function categoryExists(db: D1Db, slug: string): Promise<boolean> {
	const rows = await db
		.select({ slug: categories.slug })
		.from(categories)
		.where(eq(categories.slug, slug));
	return rows.length > 0;
}

/**
 * Insert a new category. The slug PK is the single source of truth for
 * uniqueness: a concurrent insert that lands the same slug first makes this
 * caller's insert a no-op, and the function returns `false` so the handler
 * can respond with a 409.
 *
 * Returns `true` when a row was inserted, `false` when the slug already
 * existed (ON CONFLICT DO NOTHING matched).
 */
export async function createCategory(db: D1Db, category: AdminCategoryItem): Promise<boolean> {
	const inserted = await db
		.insert(categories)
		.values({
			slug: category.slug,
			title: category.title,
			description: category.description,
			priority: category.priority,
			displayOrder: category.displayOrder,
			themeName: category.themeName,
			disabledAt: category.disabledAt
		})
		.onConflictDoNothing({ target: categories.slug })
		.returning({ slug: categories.slug });
	return inserted.length > 0;
}

export async function updateCategory(db: D1Db, category: AdminCategoryItem): Promise<void> {
	await db
		.update(categories)
		.set({
			title: category.title,
			description: category.description,
			priority: category.priority,
			displayOrder: category.displayOrder,
			themeName: category.themeName,
			disabledAt: category.disabledAt
		})
		.where(eq(categories.slug, category.slug));
}

export async function setCategoryDisabled(
	db: D1Db,
	slug: string,
	disabled: boolean
): Promise<void> {
	await db
		.update(categories)
		.set({ disabledAt: disabled ? new Date() : null })
		.where(eq(categories.slug, slug));
}

export async function listCategoryPermissions(db: D1Db): Promise<AdminCategoryPermissionItem[]> {
	const rows = await db.select().from(categoryPermissions);
	return rows.map((row) => ({
		categorySlug: row.categorySlug,
		groupSlug: row.groupSlug,
		canRead: row.canRead,
		canCreate: row.canCreate,
		canUpdate: row.canUpdate,
		canDelete: row.canDelete
	}));
}

export async function upsertCategoryPermissions(
	db: D1Db,
	permissions: AdminCategoryPermissionItem[]
): Promise<void> {
	if (permissions.length === 0) return;

	await db.transaction(async (tx) => {
		for (const permission of permissions) {
			await tx
				.insert(categoryPermissions)
				.values(permission)
				.onConflictDoUpdate({
					target: [categoryPermissions.categorySlug, categoryPermissions.groupSlug],
					set: {
						canRead: permission.canRead,
						canCreate: permission.canCreate,
						canUpdate: permission.canUpdate,
						canDelete: permission.canDelete
					}
				});
		}
	});
}

export async function validateCategoryPermissionTargets(
	db: D1Db,
	permissions: AdminCategoryPermissionItem[]
): Promise<boolean> {
	const categorySlugs = [...new Set(permissions.map((permission) => permission.categorySlug))];
	const groupSlugs = [...new Set(permissions.map((permission) => permission.groupSlug))];
	if (categorySlugs.length === 0 || groupSlugs.length === 0) return false;
	if (groupSlugs.some((slug) => !isPermissionEditableGroupSlug(slug))) return false;

	const [existingCategories, existingGroups] = await Promise.all([
		db
			.select({ slug: categories.slug })
			.from(categories)
			.where(inArray(categories.slug, categorySlugs)),
		db
			.select({ slug: userGroups.slug })
			.from(userGroups)
			.where(inArray(userGroups.slug, groupSlugs))
	]);

	return (
		existingCategories.length === categorySlugs.length &&
		existingGroups.length === groupSlugs.length
	);
}

export async function getTargetUserGroup(db: D1Db, userId: number): Promise<string | null> {
	const rows = await db
		.select({ groupSlug: users.groupSlug })
		.from(users)
		.where(eq(users.id, userId));
	return rows[0]?.groupSlug ?? null;
}

export async function updateUserGroup(db: D1Db, userId: number, groupSlug: string): Promise<void> {
	await db.update(users).set({ groupSlug }).where(eq(users.id, userId));
}
