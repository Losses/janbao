import { getDb, getLocalDb } from '$lib/server/db';
import { seedCore } from '$lib/server/db/seed';
import { verifyJwt } from '$lib/server/auth';
import { users } from '$lib/server/db/schema';
import { getEditorPreferences } from '$lib/server/db/dao/editor-preferences';
import { getUiPreferences } from '$lib/server/db/dao/ui-preferences';
import { SITE_DEFAULT_THEME } from '$lib/ui/prefs';
import { resolveLang, getTranslation } from '$lib/server/i18n';
import { getJwtSecret, getCookieSecure } from '$lib/server/constants';
import { resolvePcloudConfig, pcloudIsConfigured } from '$lib/server/pcloud';
import { maybeRunDailyBackup } from '$lib/server/backup';
import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import type { Handle } from '@sveltejs/kit';

// Copy SvelteKit dynamic private env variables to process.env for local development
// and node/bun runtime compatibility in server helpers (e.g. constants.ts).
if (typeof process !== 'undefined') {
	for (const [key, value] of Object.entries(env)) {
		if (value && !process.env[key]) {
			process.env[key] = value;
		}
	}
}

// Injecting the signed-in user's interface theme into the SSR HTML avoids the
// FOUC where the page paints the default theme and only switches after
// hydration runs the root layout's $effect. The client $effect still runs and
// agrees with this value, so there is no conflict; the per-page theme override
// (discussion / compose) remains a client-side store update. The default baked
// into app.html is SITE_DEFAULT_THEME (huoxin); an empty interface theme is
// left untouched (stays huoxin), never unset.
function injectInterfaceTheme(html: string, theme: string | null | undefined): string {
	if (!theme || theme === SITE_DEFAULT_THEME) return html;
	return html.replace(`data-theme="${SITE_DEFAULT_THEME}"`, `data-theme="${theme}"`);
}

export const handle: Handle = async ({ event, resolve }) => {
	// 1. Initialize Database Client
	const d1 = event.platform?.env?.D1_DB;
	let db;

	if (d1) {
		// Production: Cloudflare D1 binding
		db = getDb(d1);
	} else {
		// Local development: libsql fallback
		db = await getLocalDb();
	}

	event.locals.db = db;

	// 2. Perform Core Database Seeding (Atomic check & execute)
	await seedCore(db, event.platform?.env);

	// 2b. Daily DB backup (local node/bun mode only). Fire-and-forget: the first
	// request of a new forum day triggers one pCloud snapshot. Non-blocking, and
	// maybeRunDailyBackup short-circuits on an in-memory same-day flag so the
	// per-request cost is negligible after the first-of-day request.
	if (!d1) {
		const cfg = resolvePcloudConfig({ ...env, ...(event.platform?.env ?? {}) });
		if (pcloudIsConfigured(cfg)) {
			void maybeRunDailyBackup(db, cfg, event.platform?.env).catch((err) =>
				console.error('[backup] daily trigger failed:', err)
			);
		}
	}

	// 3. Retrieve and Verify JWT Cookie
	const token = event.cookies.get('session_token');
	event.locals.user = null;

	const jwtSecret = getJwtSecret(event.platform?.env);

	if (token) {
		const payload = await verifyJwt(token, jwtSecret);
		// sub holds the user id as a numeric string. A non-numeric sub (e.g. a legacy
		// UUID token from before the id migration) is treated as an invalid token.
		const userId = payload?.sub !== undefined ? Number(payload.sub) : NaN;
		if (payload && payload.sub && !Number.isNaN(userId)) {
			const usersList = await db.select().from(users).where(eq(users.id, userId)).limit(1);
			if (usersList.length > 0) {
				const userRecord = usersList[0];
				// Editor feature prefs are needed app-wide (every LexicalEditor
				// instance reads them via the client store), so they ride along on
				// the session. A PK lookup on a 1:1 row; sub-ms.
				const editorPreferences = await getEditorPreferences(db, userRecord.id);
				// Interface prefs (site theme override + block-post-theme) are read
				// app-wide too - the root layout applies the theme via the client
				// store, and the discussion/post forms gate on blockPostTheme.
				const uiPreferences = await getUiPreferences(db, userRecord.id);
				// Redact password hash before exposing to locals
				const safeUser = {
					id: userRecord.id,
					username: userRecord.username,
					email: userRecord.email,
					displayName: userRecord.displayName,
					bio: userRecord.bio,
					avatarFileId: userRecord.avatarFileId,
					groupSlug: userRecord.groupSlug,
					signupTime: userRecord.signupTime,
					lastActiveTime: userRecord.lastActiveTime,
					showEmail: userRecord.showEmail,
					languagePreference: userRecord.languagePreference,
					isStealth: userRecord.isStealth,
					rssToken: userRecord.rssToken,
					viewCount: userRecord.viewCount,
					editorPreferences,
					uiPreferences
				};
				event.locals.user = safeUser;

				// Throttled active status updates (only write to DB if lastActiveTime
				// is > 60 seconds old). Stealth users opt out of presence tracking, so
				// their lastActiveTime is left frozen (never revealed as "current"),
				// consistent with the /api/users/online and /api/users/search filters.
				const now = Date.now();
				const lastActive = safeUser.lastActiveTime.getTime();
				if (!safeUser.isStealth && now - lastActive > 60000) {
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

	// Publish the user's interface theme as a readable (non-httpOnly) cookie so
	// the inline script in app.html can set <html data-theme> during HTML parse,
	// before first paint and before hydration. This is the second no-FOUC layer
	// (transformPageChunk is the first): it corrects the theme even when the
	// served HTML did not get the SSR bake (e.g. a stale service worker serving a
	// cached app shell), as long as the cookie is present from a prior visit.
	const interfaceThemeCookie = event.locals.user?.uiPreferences?.interfaceTheme;
	if (interfaceThemeCookie) {
		event.cookies.set('theme', interfaceThemeCookie, {
			path: '/',
			httpOnly: false,
			sameSite: 'lax',
			secure: getCookieSecure(event.url),
			maxAge: 60 * 60 * 24 * 365
		});
	} else if (event.cookies.get('theme')) {
		event.cookies.delete('theme', { path: '/' });
	}

	// Inject the user's interface theme into the SSR HTML so the first paint is
	// already in their theme (no FOUC from the client $effect swapping it later).
	const response = await resolve(event, {
		transformPageChunk: ({ html }) =>
			injectInterfaceTheme(html, event.locals.user?.uiPreferences?.interfaceTheme)
	});
	// The service worker script must always be revalidated: otherwise Firefox
	// byte-serves a cached `/service-worker.js`, a freshly built SW never
	// installs, and users get stuck on a stale app shell / offline layout.
	// (Cloudflare enforces the same via static/_headers; the node adapter
	// ignores that file, so the header is set here too.)
	if (event.url.pathname === '/service-worker.js') {
		response.headers.set('Cache-Control', 'no-cache, must-revalidate');
	}
	return response;
};
