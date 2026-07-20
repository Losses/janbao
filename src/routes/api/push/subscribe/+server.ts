import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { pushSubscriptions } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import type { PushSubscribeBody, PushUnsubscribeBody } from '$lib/types/api';

/** Push service hosts permitted as subscription endpoints (SSRF allowlist). */
const ALLOWED_PUSH_HOSTS = [
	'fcm.googleapis.com', // Firebase Cloud Messaging (Chrome/Android)
	'updates.push.services.mozilla.com', // Firefox
	'web.push.apple.com' // Safari
];

/** Validate that an endpoint URL targets a known push service over HTTPS. */
function isAllowedPushEndpoint(endpoint: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(endpoint);
	} catch {
		return false;
	}
	if (parsed.protocol !== 'https:') return false;
	return ALLOWED_PUSH_HOSTS.some(
		(host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
	);
}

// POST /api/push/subscribe - register (or refresh) the active user's PushSubscription
// for the endpoint supplied by the browser PushManager. The endpoint is globally
// unique per (browser, push service), so we upsert keyed on endpoint: existing
// rows are overwritten with the current user + refreshed keys rather than
// duplicated. This also handles the case where a single device switches accounts.
// The single ON CONFLICT DO UPDATE statement is race-safe against double-subscribe
// retries hitting the endpoint unique constraint.
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	let body: PushSubscribeBody;
	try {
		body = (await request.json()) as PushSubscribeBody;
	} catch {
		return jsonError(t, 'common.badRequest', 400);
	}

	const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
	const p256dh = body.keys && typeof body.keys.p256dh === 'string' ? body.keys.p256dh : '';
	const auth = body.keys && typeof body.keys.auth === 'string' ? body.keys.auth : '';

	if (!endpoint || !p256dh || !auth) {
		return jsonError(t, 'common.badRequest', 400);
	}

	if (!isAllowedPushEndpoint(endpoint)) {
		return jsonError(t, 'common.badRequest', 400);
	}

	const userAgent = request.headers.get('user-agent');
	const db = locals.db;

	await db
		.insert(pushSubscriptions)
		.values({
			userId: user.id,
			endpoint,
			p256dhKey: p256dh,
			authKey: auth,
			userAgent: userAgent ?? null
		})
		.onConflictDoUpdate({
			target: pushSubscriptions.endpoint,
			set: {
				userId: user.id,
				p256dhKey: p256dh,
				authKey: auth,
				userAgent: userAgent ?? null,
				lastErrorAt: null
			}
		});

	return json({ success: true });
};

// DELETE /api/push/subscribe - remove the active user's subscription for an endpoint.
// Used by the client on explicit disable, or when the user logs out from this
// device. Scoped to the active user so one user cannot revoke another's
// subscription by guessing endpoints.
export const DELETE: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	let body: PushUnsubscribeBody;
	try {
		body = (await request.json()) as PushUnsubscribeBody;
	} catch {
		return jsonError(t, 'common.badRequest', 400);
	}

	const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
	if (!endpoint) {
		return jsonError(t, 'common.badRequest', 400);
	}

	await locals.db
		.delete(pushSubscriptions)
		.where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, user.id)));

	return json({ success: true });
};
