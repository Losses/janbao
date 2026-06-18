import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { pushSubscriptions } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import type { PushUnsubscribeBody } from '$lib/types/api';

// POST /api/push/unsubscribe - remove the active user's subscription for an
// endpoint. Equivalent to DELETE /api/push/subscribe; kept as a separate POST
// route because the client's unsubscribeFromPush helper is invoked from a
// button click and the rest of the push API surface is POST-shaped, which keeps
// the fetch calls uniform. Scoped to the active user.
export const POST: RequestHandler = async ({ request, locals }) => {
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
