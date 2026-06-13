import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { invitations } from '$lib/server/db/schema';
import { getMonthlyRequestCount } from '$lib/server/db/dao/invitations';
import { getMonthlyInvitationLimit, getForumTimezone } from '$lib/server/constants';
import { getTzMonthBoundaries } from '$lib/server/db/welcome';
import type { RequestHandler } from './$types';

const CODE_LENGTH = 12;
const CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Unambiguous (no I/O/0/1)
const EXPIRY_DAYS = 30;

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
// Administrators bypass the monthly limit entirely.
export const POST: RequestHandler = async ({ locals, platform }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const isAdmin = user.groupSlug === 'admin';
	const platformEnv = platform?.env;
	const db = locals.db;

	if (!isAdmin) {
		const limit = getMonthlyInvitationLimit(platformEnv);
		const tz = getForumTimezone(platformEnv);
		const window = getTzMonthBoundaries(tz);

		const requestedThisMonth = await getMonthlyRequestCount(db, user.id, window);
		if (requestedThisMonth >= limit) {
			return jsonError(t, 'invitation.monthlyLimitExceeded', 400);
		}
	}

	const now = new Date();
	const expiresAt = new Date(now.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

	// PK collisions are astronomically rare (30^12 ≈ 5.3×10^17 space).
	// A single insert with try/catch is sufficient — no retry loop needed.
	try {
		await db.insert(invitations).values({
			code: generateInvitationCode(),
			creatorId: user.id,
			usedById: null,
			createdAt: now,
			expiresAt
		});
	} catch {
		return jsonError(t, 'common.internalError', 500);
	}

	return json({ success: true }, { status: 201 });
};
