import type { PageServerLoad } from './$types';
import { getMaintenanceOverview } from '$lib/server/maintenance';

export const load: PageServerLoad = async ({ locals, platform }) => {
	// Per-op availability (analyze on local + D1; integrity_check / fts_rebuild
	// local only) plus last-run timestamps read from the app_settings KV store,
	// and any in-flight detached-run status for the client to poll. `t`/`user`
	// are inherited from the root + admin layouts.
	const overview = await getMaintenanceOverview(locals.db, platform);
	return { overview };
};
