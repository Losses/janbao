import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { verifyPassword, hashPassword } from '$lib/server/auth';
import { jsonError } from '$lib/server/errors';
import type { ProfilePasswordBody } from '$lib/types/api';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const body: ProfilePasswordBody = await request.json();
	const currentPassword = body.currentPassword;
	const newPassword = body.newPassword;

	if (!currentPassword) {
		return jsonError(t, 'profile.currentPasswordRequired', 400);
	}

	if (!newPassword) {
		return jsonError(t, 'profile.newPasswordRequired', 400);
	}

	if (newPassword.length < 5) {
		return jsonError(t, 'auth.passwordTooShort', 400);
	}

	const userRecords = await locals.db
		.select({ passwordHash: users.passwordHash })
		.from(users)
		.where(eq(users.id, user.id))
		.limit(1);

	if (userRecords.length === 0) {
		return jsonError(t, 'profile.userNotFound', 404);
	}

	const isValid = await verifyPassword(currentPassword, userRecords[0].passwordHash);
	if (!isValid) {
		return jsonError(t, 'profile.currentPasswordIncorrect', 400);
	}

	const newHash = await hashPassword(newPassword);
	await locals.db.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));

	return json({ success: true });
};
