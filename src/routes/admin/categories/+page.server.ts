import type { PageServerLoad } from './$types';
import { listAdminCategories } from '$lib/server/db/dao/admin-permissions';

export const load: PageServerLoad = async ({ locals }) => {
	return { categories: await listAdminCategories(locals.db) };
};
