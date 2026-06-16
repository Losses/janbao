import type { PageServerLoad } from './$types';
import {
	listAdminCategories,
	listCategoryPermissions,
	listManageableUserGroups
} from '$lib/server/db/dao/admin-permissions';

export const load: PageServerLoad = async ({ locals }) => {
	const [groups, categories, categoryPermissions] = await Promise.all([
		listManageableUserGroups(locals.db),
		listAdminCategories(locals.db),
		listCategoryPermissions(locals.db)
	]);
	return { groups, categories, categoryPermissions };
};
