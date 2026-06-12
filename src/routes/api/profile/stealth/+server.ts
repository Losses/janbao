import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { jsonError } from '$lib/server/errors';
import type { ProfileStealthBody } from '$lib/types/api';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const body: ProfileStealthBody = await request.json();
	const isStealth = body.isStealth;

	if (typeof isStealth !== 'boolean') {
		return jsonError(t, 'profile.invalidValue', 400);
	}

	await locals.db.update(users).set({ isStealth }).where(eq(users.id, user.id));

	return json({ success: true });
};
