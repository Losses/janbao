import { users } from './schema';
import { eq } from 'drizzle-orm';
import type { D1Db } from './index';
import { env as svelteEnv } from '$env/dynamic/private';
import { seedBaseline } from './seed-baseline';

let seeded = false;

export async function seedCore(db: D1Db, env?: App.Platform['env']) {
	if (seeded) return;

	try {
		await seedBaseline(db);

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
