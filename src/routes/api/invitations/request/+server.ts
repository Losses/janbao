import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { invitations } from '$lib/server/db/schema';
import { getMonthlyRequestCount } from '$lib/server/db/dao/invitations';
import { getMonthlyInvitationLimit, getForumTimezone } from '$lib/server/constants';
import { getTzMonthBoundaries } from '$lib/server/db/welcome';
import type { RequestHandler } from './$types';

const CODE_LENGTH = 12;
const CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Unambiguous (no I/O/0/1)
const EXPIRY_DAYS = 7;
const MAX_CODE_ATTEMPTS = 5; // Bound regeneration on the astronomically rare PK collision

/**
 * Generate a cryptographically-random invitation code of CODE_LENGTH chars
 * sampled uniformly from CODE_CHARSET.
 */
function generateInvitationCode(): string {
	const bytes = new Uint8Array(CODE_LENGTH);
	crypto.getRandomValues(bytes);
	let code = '';
	for (let i = 0; i < CODE_LENGTH; i++) {
		code += CODE_CHARSET[bytes[i] % CODE_CHARSET.length];
	}
	return code;
}

// POST /api/invitations/request - Mint a new invitation code for the active
// user, enforcing the per-month limit defined by MONTHLY_INVITATION_LIMIT.
export const POST: RequestHandler = async ({ locals, platform }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const platformEnv = platform?.env;
	const limit = getMonthlyInvitationLimit(platformEnv);
	const tz = getForumTimezone(platformEnv);
	const window = getTzMonthBoundaries(tz);

	const db = locals.db;

	const requestedThisMonth = await getMonthlyRequestCount(db, user.id, window);
	if (requestedThisMonth >= limit) {
		return jsonError(t, 'invitation.monthlyLimitExceeded', 400);
	}

	const now = new Date();
	const expiresAt = new Date(now.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

	// Mint the code, regenerating on a PK collision (onConflictDoNothing → 0 changes)
	let minted = false;
	for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
		const result = await db
			.insert(invitations)
			.values({
				code: generateInvitationCode(),
				creatorId: user.id,
				usedById: null,
				createdAt: now,
				expiresAt
			})
			.onConflictDoNothing();
		if (result.meta?.changes) {
			minted = true;
			break;
		}
	}

	if (!minted) {
		return jsonError(t, 'common.internalError', 500);
	}

	return json({ success: true }, { status: 201 });
};
