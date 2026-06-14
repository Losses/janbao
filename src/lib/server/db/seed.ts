import { userGroups, users, categories, categoryPermissions } from './schema';
import { eq } from 'drizzle-orm';
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

		// 4. Bootstrap admin user from environment variables if no admin exists yet.
		// Guard on "no admin" rather than "no users" so a freshly-imported forum
		// (members present, but no admin) still gets its first admin. id 0 is free
		// because Vanilla's UserID 0 is remapped to the ghost sentinel (-2) at
		// import time. onConflictDoNothing keeps the insert race-safe.
		const adminEmail = env?.ADMIN_EMAIL || svelteEnv.ADMIN_EMAIL;
		const adminPassword = env?.ADMIN_PASSWORD || svelteEnv.ADMIN_PASSWORD;
		if (adminEmail && adminPassword) {
			const existingAdmin = await db
				.select({ id: users.id })
				.from(users)
				.where(eq(users.groupSlug, 'admin'))
				.limit(1);
			if (existingAdmin.length === 0) {
				// Reserve the 'admin' username for the bootstrap admin: any user
				// squatting on it (e.g. an imported Vanilla account) is renamed to
				// user_<id> so nobody can impersonate the admin. No admin-group user
				// exists here, so every 'admin' match is an impostor; the rename is
				// idempotent (UPDATE to the same value), so the concurrent burst is safe.
				const adminImpostors = await db
					.select({ id: users.id })
					.from(users)
					.where(eq(users.username, 'admin'));
				for (const imp of adminImpostors) {
					if (imp.id === 0) continue;
					await db
						.update(users)
						.set({ username: `user_${imp.id}` })
						.where(eq(users.id, imp.id));
				}

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
