import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { users } from '$lib/server/db/schema';
import { eq, sql } from 'drizzle-orm';
import { jsonError } from '$lib/server/errors';
import type { ProfileEditBody } from '$lib/types/api';
import { getAllowSlugChange } from '$lib/server/constants';
import { reindexUser } from '$lib/server/search/fts';
import {
	isValidUsername,
	EMAIL_REGEX,
	MAX_DISPLAY_NAME_LENGTH,
	MAX_EMAIL_LENGTH
} from '$lib/utils/validation';

/** The user fields that back the Users search index; needed for old→new reindex. */
interface UserIdentityFields {
	username: string;
	displayName: string;
	bio: string | null;
}

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const body: ProfileEditBody = await request.json();
	const { displayName, email, showEmail, languagePreference, username, avatarFileId, bio } = body;

	const updates: Partial<ProfileEditBody> = {};

	if (displayName !== undefined) {
		const trimmed = displayName.trim();
		if (trimmed.length === 0) {
			return jsonError(t, 'profile.displayNameEmpty', 400);
		}
		if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
			return jsonError(t, 'auth.displayNameTooLong', 400);
		}
		updates.displayName = trimmed;
	}

	if (bio !== undefined) {
		const trimmed = bio.trim();
		if (trimmed.length > 100) {
			return jsonError(t, 'profile.bioTooLong', 400);
		}
		updates.bio = trimmed;
	}

	if (email !== undefined) {
		const trimmed = email.trim();
		if (trimmed.length === 0) {
			return jsonError(t, 'profile.emailEmpty', 400);
		}
		if (trimmed.length > MAX_EMAIL_LENGTH || !EMAIL_REGEX.test(trimmed)) {
			return jsonError(t, 'auth.invalidEmail', 400);
		}
		// Canonicalise to lower case (matching register) and check uniqueness
		// case-insensitively so a case variant does not slip past the app check
		// only to throw a raw unique-constraint 500.
		const canonical = trimmed.toLowerCase();
		const existing = await locals.db
			.select({ id: users.id })
			.from(users)
			.where(sql`lower(${users.email}) = lower(${canonical})`)
			.limit(1);

		if (existing.length > 0 && existing[0].id !== user.id) {
			return jsonError(t, 'profile.emailInUse', 409);
		}
		updates.email = canonical;
	}

	if (showEmail !== undefined) {
		if (typeof showEmail !== 'boolean') {
			return jsonError(t, 'common.invalidValue', 400);
		}
		updates.showEmail = showEmail;
	}

	if (languagePreference !== undefined) {
		if (languagePreference !== 'en' && languagePreference !== 'zh-CN') {
			return jsonError(t, 'profile.invalidLanguage', 400);
		}
		updates.languagePreference = languagePreference;
	}

	if (username !== undefined) {
		const allowSlugChange = getAllowSlugChange(platform?.env);
		if (!allowSlugChange) {
			return jsonError(t, 'profile.usernameChangeDisabledError', 400);
		}
		if (user.groupSlug !== 'admin') {
			return jsonError(t, 'profile.usernameAdminOnlyError', 403);
		}
		const trimmed = username.trim();
		if (trimmed.length === 0) {
			return jsonError(t, 'profile.usernameEmpty', 400);
		}
		if (!isValidUsername(trimmed)) {
			return jsonError(t, 'auth.invalidUsername', 400);
		}
		const existingUsername = await locals.db
			.select({ id: users.id })
			.from(users)
			.where(sql`lower(${users.username}) = lower(${trimmed})`)
			.limit(1);

		if (existingUsername.length > 0 && existingUsername[0].id !== user.id) {
			return jsonError(t, 'profile.usernameInUse', 409);
		}
		updates.username = trimmed;
	}

	if (avatarFileId !== undefined) {
		updates.avatarFileId = avatarFileId;
	}

	if (Object.keys(updates).length === 0) {
		return jsonError(t, 'common.noFieldsToUpdate', 400);
	}

	// If any Users-search-indexed field changed, read the pre-update values so the
	// contentless FTS5 delete can resupply the exact old text (the source row holds
	// the new value after the update, so it must be captured first).
	const touchesIdentity =
		updates.username !== undefined ||
		updates.displayName !== undefined ||
		updates.bio !== undefined;
	let oldIdentity: UserIdentityFields | null = null;
	if (touchesIdentity) {
		const existing = await locals.db
			.select({
				username: users.username,
				displayName: users.displayName,
				bio: users.bio
			})
			.from(users)
			.where(eq(users.id, user.id))
			.limit(1);
		oldIdentity = existing[0] ?? null;
	}

	await locals.db.update(users).set(updates).where(eq(users.id, user.id));

	if (oldIdentity) {
		const newUsername = updates.username ?? oldIdentity.username;
		const newDisplayName = updates.displayName ?? oldIdentity.displayName;
		// updates.bio is the trimmed string when provided (even if ''), so the
		// !== undefined check keeps an unchanged bio on the old value.
		const newBio = updates.bio !== undefined ? updates.bio : oldIdentity.bio;
		await reindexUser(
			locals.db,
			user.id,
			oldIdentity.username,
			oldIdentity.displayName,
			oldIdentity.bio,
			newUsername,
			newDisplayName,
			newBio
		);
	}

	return json({ success: true });
};
