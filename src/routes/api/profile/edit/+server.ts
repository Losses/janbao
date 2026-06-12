import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { ProfileEditBody } from '$lib/types/api';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return json({ error: t.common.unauthorized }, { status: 401 });
	}

	const body: ProfileEditBody = await request.json();
	const { displayName, email, showEmail, languagePreference, username, avatarFileId } = body;

	const updates: Partial<{
		displayName: string;
		email: string;
		showEmail: boolean;
		languagePreference: string;
		username: string;
		avatarFileId: string;
	}> = {};

	if (displayName !== undefined) {
		const trimmed = displayName.trim();
		if (trimmed.length === 0) {
			return json({ error: t.profile.displayNameEmpty }, { status: 400 });
		}
		updates.displayName = trimmed;
	}

	if (email !== undefined) {
		const trimmed = email.trim();
		if (trimmed.length === 0) {
			return json({ error: t.profile.emailEmpty }, { status: 400 });
		}
		const existing = await locals.db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.email, trimmed))
			.limit(1);

		if (existing.length > 0 && existing[0].id !== user.id) {
			return json({ error: t.profile.emailInUse }, { status: 409 });
		}
		updates.email = trimmed;
	}

	if (showEmail !== undefined) {
		updates.showEmail = showEmail;
	}

	if (languagePreference !== undefined) {
		if (languagePreference !== 'en' && languagePreference !== 'zh-CN') {
			return json({ error: t.profile.invalidLanguage }, { status: 400 });
		}
		updates.languagePreference = languagePreference;
	}

	if (username !== undefined) {
		if (user.groupSlug !== 'admin') {
			return json({ error: t.profile.usernameAdminOnlyError }, { status: 403 });
		}
		const trimmed = username.trim();
		if (trimmed.length === 0) {
			return json({ error: t.profile.usernameEmpty }, { status: 400 });
		}
		const existingUsername = await locals.db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.username, trimmed))
			.limit(1);

		if (existingUsername.length > 0 && existingUsername[0].id !== user.id) {
			return json({ error: t.profile.usernameInUse }, { status: 409 });
		}
		updates.username = trimmed;
	}

	if (avatarFileId !== undefined) {
		updates.avatarFileId = avatarFileId;
	}

	if (Object.keys(updates).length === 0) {
		return json({ error: t.common.noFieldsToUpdate }, { status: 400 });
	}

	await locals.db.update(users).set(updates).where(eq(users.id, user.id));

	return json({ success: true });
};
