import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getInvitations, getMonthlyRequestCount } from '$lib/server/db/dao/invitations';
import { getMonthlyInvitationLimit, getForumTimezone } from '$lib/server/constants';
import { getTzMonthBoundaries } from '$lib/server/db/welcome';

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) {
		redirect(302, '/entry/signin');
	}

	const platformEnv = event.platform?.env;
	const monthlyLimit = getMonthlyInvitationLimit(platformEnv);
	const window = getTzMonthBoundaries(getForumTimezone(platformEnv));

	const [invitations, requestedThisMonth] = await Promise.all([
		getInvitations(event.locals.db, user.id),
		getMonthlyRequestCount(event.locals.db, user.id, window)
	]);

	return {
		invitations,
		monthlyLimit,
		requestedThisMonth,
		canRequestMore: requestedThisMonth < monthlyLimit
	};
};
