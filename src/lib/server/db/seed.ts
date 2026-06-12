import { userGroups, users } from './schema';
import { eq } from 'drizzle-orm';
import type { getDb } from './index';

let seeded = false;

export async function seedCore(db: ReturnType<typeof getDb>) {
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
		const systemUserId = '00000000-0000-0000-0000-000000000000';
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
				rssToken: 'system-rss-token-value'
			});
		}

		seeded = true;
	} catch (e) {
		console.error('Error during core database seeding:', e);
	}
}
