import { getDb, getLocalDb } from '$lib/server/db';
import { seedCore } from '$lib/server/db/seed';
import { verifyJwt } from '$lib/server/auth';
import { users } from '$lib/server/db/schema';
import { resolveLang, getTranslation } from '$lib/server/i18n';
import { getJwtSecret } from '$lib/server/constants';
import { eq } from 'drizzle-orm';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	// 1. Initialize Database Client
	const d1 = event.platform?.env?.D1_DB;
	let db;

	if (d1) {
		// Production: Cloudflare D1 binding
		db = getDb(d1);
	} else {
		// Local development: bun:sqlite fallback
		db = await getLocalDb();
	}

	event.locals.db = db;

	// 2. Perform Core Database Seeding (Atomic check & execute)
	await seedCore(db, event.platform?.env);

	// 3. Retrieve and Verify JWT Cookie
	const token = event.cookies.get('session_token');
	event.locals.user = null;

	const jwtSecret = getJwtSecret(event.platform?.env);

	if (token) {
		const payload = await verifyJwt(token, jwtSecret);
		if (payload && payload.sub) {
			const usersList = await db
				.select()
				.from(users)
				.where(eq(users.id, Number(payload.sub)))
				.limit(1);
			if (usersList.length > 0) {
				const userRecord = usersList[0];
				// Redact password hash before exposing to locals
				const safeUser = {
					id: userRecord.id,
					username: userRecord.username,
					email: userRecord.email,
					displayName: userRecord.displayName,
					avatarFileId: userRecord.avatarFileId,
					groupSlug: userRecord.groupSlug,
					signupTime: userRecord.signupTime,
					lastActiveTime: userRecord.lastActiveTime,
					showEmail: userRecord.showEmail,
					languagePreference: userRecord.languagePreference,
					isStealth: userRecord.isStealth,
					rssToken: userRecord.rssToken,
					viewCount: userRecord.viewCount
				};
				event.locals.user = safeUser;

				// Throttled active status updates (only write to DB if lastActiveTime is > 60 seconds old)
				const now = Date.now();
				const lastActive = safeUser.lastActiveTime.getTime();
				if (now - lastActive > 60000) {
					// Async update without blocking request
					const promise = db
						.update(users)
						.set({ lastActiveTime: new Date() })
						.where(eq(users.id, safeUser.id))
						.run()
						.catch((err) => console.error('Failed to update lastActiveTime:', err));

					if (event.platform?.context?.waitUntil) {
						event.platform.context.waitUntil(promise);
					}
				}
			} else {
				// Cookie exists but user not found (e.g. deleted), clear invalid cookie
				event.cookies.delete('session_token', { path: '/' });
			}
		} else {
			// Invalid or expired token
			event.cookies.delete('session_token', { path: '/' });
		}
	}

	// 4. Resolve i18n dictionary preferences
	const userPreference = event.locals.user?.languagePreference || null;
	const acceptLangHeader = event.request.headers.get('accept-language');
	const resolvedLang = resolveLang(acceptLangHeader, userPreference);

	event.locals.lang = resolvedLang;
	event.locals.t = getTranslation(resolvedLang);

	return resolve(event);
};
