import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		event.cookies.delete('session_token', { path: '/' });
		return json({ success: true });
	} catch (e) {
		console.error('Logout error:', e);
		return json({ error: 'Internal server error during logout.' }, { status: 500 });
	}
};
