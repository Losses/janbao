import { userGroups, users, categories, categoryPermissions } from './schema';
import { SYSTEM_USER_ID } from '../constants';
import type { D1Db } from './index';

export async function seedBaseline(db: D1Db) {
	// 1. Seed user groups (idempotent: ON CONFLICT DO NOTHING on the slug PK).
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

	// 4. Seed category permissions: guests cannot read "general"
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
}
