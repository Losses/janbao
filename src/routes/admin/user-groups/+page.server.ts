import type { PageServerLoad } from './$types';
import { listUserGroupsWithCounts } from '$lib/server/db/dao/admin-permissions';

export const load: PageServerLoad = async ({ locals }) => {
	return { groups: await listUserGroupsWithCounts(locals.db) };
};
