import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { jsonError } from '$lib/server/errors';
import { upsertUiPreferences } from '$lib/server/db/dao/ui-preferences';
import { UI_PREF_KEYS, VALID_INTERFACE_THEMES, type UiPreferences } from '$lib/ui/prefs';
import type { UiPreferencesBody } from '$lib/types/api';

export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}
	// Already loaded onto the session by hooks.server.ts - no extra query.
	return json({ success: true, preferences: user.uiPreferences });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const body: UiPreferencesBody = await request.json();
	const updates: Partial<UiPreferences> = {};

	for (const key of UI_PREF_KEYS) {
		const value = body[key];
		if (value === undefined) continue;

		if (key === 'interfaceTheme') {
			if (typeof value !== 'string' || !VALID_INTERFACE_THEMES.has(value)) {
				return jsonError(t, 'profile.invalidValue', 400);
			}
			updates.interfaceTheme = value;
		} else if (key === 'blockPostTheme') {
			if (typeof value !== 'boolean') {
				return jsonError(t, 'profile.invalidValue', 400);
			}
			updates.blockPostTheme = value;
		}
	}

	if (Object.keys(updates).length === 0) {
		return jsonError(t, 'common.noFieldsToUpdate', 400);
	}

	await upsertUiPreferences(locals.db, user.id, updates);

	return json({ success: true });
};
