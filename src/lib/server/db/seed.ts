import { userGroups, users, categories, categoryPermissions } from './schema';
import { eq, ne, and } from 'drizzle-orm';
import type { D1Db } from './index';
import { SYSTEM_USER_ID } from '../constants';
import { env as svelteEnv } from '$env/dynamic/private';

let seeded = false;

export async function seedCore(db: D1Db, env?: App.Platform['env']) {
	if (seeded) return;

	try {
		// 1. Seed user groups if they don't exist
		const groupsToSeed = [
			{
				slug: 'system',
				title: 'System',
				description: 'Automation and system processes',
				permissionsJson: '{}'
			},
			{
				slug: 'admin',
				title: 'Administrator',
				description: 'Full administrative permissions',
				permissionsJson: JSON.stringify({
					discussions: 'crud',
					categories: 'crud',
					messages: 'crud'
				})
			},
			{
				slug: 'moderator',
				title: 'Moderator',
				description: 'Forum moderation permissions',
				permissionsJson: JSON.stringify({ discussions: 'crud', categories: 'ru', messages: 'ru' })
			},
			{
				slug: 'member',
				title: 'Member',
				description: 'Standard forum member',
				permissionsJson: JSON.stringify({ discussions: 'cr', categories: 'r', messages: 'cr' })
			},
			{
				slug: 'guest',
				title: 'Guest',
				description: 'Unauthenticated visitors with limited read access',
				permissionsJson: '{}'
			}
		];

		for (const g of groupsToSeed) {
			const existing = await db
				.select()
				.from(userGroups)
				.where(eq(userGroups.slug, g.slug))
				.limit(1);
			if (existing.length === 0) {
				await db.insert(userGroups).values(g);
			}
		}

		// 2. Seed System User
		const systemUserId = SYSTEM_USER_ID;
		const existingSystemUser = await db
			.select()
			.from(users)
			.where(eq(users.id, systemUserId))
			.limit(1);
		if (existingSystemUser.length === 0) {
			await db.insert(users).values({
				id: systemUserId,
				username: 'system',
				email: 'system@janbao.local',
				passwordHash: 'SYSTEM_NO_PASSWORD',
				displayName: 'System',
				groupSlug: 'system',
				isStealth: true,
				rssToken: crypto.randomUUID()
			});
		}

		// 3. Seed default categories
		const categoriesToSeed = [
			{
				slug: 'general',
				title: 'General',
				description: 'A place for everything and anything',
				priority: 1,
				displayOrder: 1
			}
		];

		for (const cat of categoriesToSeed) {
			const existing = await db
				.select()
				.from(categories)
				.where(eq(categories.slug, cat.slug))
				.limit(1);
			if (existing.length === 0) {
				await db.insert(categories).values(cat);
			}
		}

		// Seed category permissions: guests cannot read "general"
		const guestGeneralPerm = await db
			.select()
			.from(categoryPermissions)
			.where(
				and(
					eq(categoryPermissions.categorySlug, 'general'),
					eq(categoryPermissions.groupSlug, 'guest')
				)
			)
			.limit(1);
		if (guestGeneralPerm.length === 0) {
			await db.insert(categoryPermissions).values({
				categorySlug: 'general',
				groupSlug: 'guest',
				canRead: false,
				canCreate: false,
				canUpdate: false,
				canDelete: false
			});
		}

		// 4. Bootstrap admin user from environment variables if no real users exist
		const adminEmail = env?.ADMIN_EMAIL || svelteEnv.ADMIN_EMAIL;
		const adminPassword = env?.ADMIN_PASSWORD || svelteEnv.ADMIN_PASSWORD;
		if (adminEmail && adminPassword) {
			// Check for non-system users only (system user is always present)
			const realUsers = await db
				.select({ id: users.id })
				.from(users)
				.where(ne(users.id, systemUserId))
				.limit(1);
			if (realUsers.length === 0) {
				const { hashPassword } = await import('$lib/server/auth');
				const adminPasswordHash = await hashPassword(adminPassword);
				await db.insert(users).values({
					username: 'admin',
					email: adminEmail,
					passwordHash: adminPasswordHash,
					displayName: 'Administrator',
					groupSlug: 'admin'
				});
			}
		}

		seeded = true;
	} catch (e) {
		console.error('Error during core database seeding:', e);
	}
}
