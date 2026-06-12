import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { ProfileStealthBody } from '$lib/types/api';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return json({ error: t.common.unauthorized }, { status: 401 });
	}

	const body: ProfileStealthBody = await request.json();
	const isStealth = body.isStealth;

	if (typeof isStealth !== 'boolean') {
		return json({ error: t.profile.invalidValue }, { status: 400 });
	}

	await locals.db.update(users).set({ isStealth }).where(eq(users.id, user.id));

	return json({ success: true });
};
