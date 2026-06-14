import { userGroups, users, categories, categoryPermissions } from './schema';
import { ne } from 'drizzle-orm';
import type { D1Db } from './index';
import { SYSTEM_USER_ID } from '../constants';
import { env as svelteEnv } from '$env/dynamic/private';

let seeded = false;

export async function seedCore(db: D1Db, env?: App.Platform['env']) {
	if (seeded) return;

	try {
		// 1. Seed user groups (idempotent: ON CONFLICT DO NOTHING on the slug PK).
		// Idempotent inserts replace the old select-then-insert, which raced under
		// the concurrent first-request burst (UNIQUE(slug)).
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
			await db.insert(userGroups).values(g).onConflictDoNothing({ target: userGroups.slug });
		}

		// 2. Seed System User (idempotent: ON CONFLICT DO NOTHING on the id PK).
		await db
			.insert(users)
			.values({
				id: SYSTEM_USER_ID,
				username: 'system',
				email: 'system@janbao.local',
				passwordHash: 'SYSTEM_NO_PASSWORD',
				displayName: 'System',
				groupSlug: 'system',
				isStealth: true,
				rssToken: crypto.randomUUID()
			})
			.onConflictDoNothing({ target: users.id });

		// 3. Seed default categories (idempotent: ON CONFLICT DO NOTHING on the slug PK).
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
			await db.insert(categories).values(cat).onConflictDoNothing({ target: categories.slug });
		}

		// Seed category permissions: guests cannot read "general"
		// (idempotent: ON CONFLICT DO NOTHING on the composite PK).
		await db
			.insert(categoryPermissions)
			.values({
				categorySlug: 'general',
				groupSlug: 'guest',
				canRead: false,
				canCreate: false,
				canUpdate: false,
				canDelete: false
			})
			.onConflictDoNothing({
				target: [categoryPermissions.categorySlug, categoryPermissions.groupSlug]
			});

		// 4. Bootstrap admin user from environment variables if no real users exist.
		// The realUsers guard is semantic (never inject an admin into a populated
		// forum); onConflictDoNothing makes the insert itself race-safe, so the
		// concurrent first-request burst can no longer trip UNIQUE(id).
		const adminEmail = env?.ADMIN_EMAIL || svelteEnv.ADMIN_EMAIL;
		const adminPassword = env?.ADMIN_PASSWORD || svelteEnv.ADMIN_PASSWORD;
		if (adminEmail && adminPassword) {
			const realUsers = await db
				.select({ id: users.id })
				.from(users)
				.where(ne(users.id, SYSTEM_USER_ID))
				.limit(1);
			if (realUsers.length === 0) {
				const { hashPassword } = await import('$lib/server/auth');
				const adminPasswordHash = await hashPassword(adminPassword);
				await db
					.insert(users)
					.values({
						id: 0,
						username: 'admin',
						email: adminEmail,
						passwordHash: adminPasswordHash,
						displayName: 'Administrator',
						groupSlug: 'admin'
					})
					.onConflictDoNothing({ target: users.id });
			}
		}

		seeded = true;
	} catch (e) {
		console.error('Error during core database seeding:', e);
	}
}
