import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { getCookieSecure } from '$lib/server/constants';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		// Match the flags used when the cookie was set so the deletion takes effect
		// across the same scope (httpOnly/sameSite are cosmetic on delete but keep
		// the call site consistent with login/register).
		event.cookies.delete('session_token', {
			path: '/',
			secure: getCookieSecure(event.url),
			sameSite: 'strict'
		});
		return json({ success: true });
	} catch (e) {
		console.error('Logout error:', e);
		return jsonError(event.locals.t, 'common.internalError', 500);
	}
};
