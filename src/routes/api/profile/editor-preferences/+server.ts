import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { jsonError } from '$lib/server/errors';
import { upsertEditorPreferences } from '$lib/server/db/dao/editor-preferences';
import { EDITOR_FEATURE_KEYS, PLAIN_MODE_KEY, type EditorPreferences } from '$lib/editor/prefs';
import type { EditorPreferencesBody } from '$lib/types/api';

// Master + every feature key form the write allowlist. Each must be a boolean;
// anything else is rejected so a malformed body cannot poison the row.
const VALID_KEYS = [PLAIN_MODE_KEY, ...EDITOR_FEATURE_KEYS] as const;

export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}
	// Already loaded onto the session by hooks.server.ts - no extra query.
	return json({ success: true, preferences: user.editorPreferences });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const body: EditorPreferencesBody = await request.json();
	const updates: Partial<EditorPreferences> = {};

	for (const key of VALID_KEYS) {
		const value = body[key];
		if (value !== undefined) {
			if (typeof value !== 'boolean') {
				return jsonError(t, 'profile.invalidValue', 400);
			}
			updates[key] = value;
		}
	}

	if (Object.keys(updates).length === 0) {
		return jsonError(t, 'common.noFieldsToUpdate', 400);
	}

	await upsertEditorPreferences(locals.db, user.id, updates);

	return json({ success: true });
};
