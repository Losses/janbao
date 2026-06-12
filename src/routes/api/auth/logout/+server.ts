import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		event.cookies.delete('session_token', { path: '/' });
		return json({ success: true });
	} catch (e) {
		console.error('Logout error:', e);
		return jsonError(event.locals.t, 'common.internalError', 500);
	}
};
