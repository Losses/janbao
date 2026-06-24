<!-- src/lib/components/panels/AdminMenuPanel.svelte -->
<script lang="ts">
	import DirectoryGrid, {
		type DirectoryGroup
	} from '$lib/components/molecules/DirectoryGrid.svelte';
	import PageTitle from '$lib/components/molecules/PageTitle.svelte';
	import {
		mdiAccountGroup,
		mdiShieldLockOutline,
		mdiFolderOutline,
		mdiBackupRestore,
		mdiWrenchOutline,
		mdiChartBar
	} from '@mdi/js';
	import type { UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface Props {
		user: UserInfoSummary;
		t: TranslationDict;
	}

	let { user, t }: Props = $props();

	const adminT = $derived(t.admin);
	const directoryT = $derived(t.directory);

	const groups = $derived<DirectoryGroup[]>(
		user
			? [
					{
						title: directoryT.permissionsUsers,
						items: [
							{
								label: adminT['userGroups'],
								href: '/admin/user-groups',
								icon: mdiAccountGroup
							},
							{
								label: adminT['categoryPermissions'],
								href: '/admin/permissions',
								icon: mdiShieldLockOutline
							}
						]
					},
					{
						title: directoryT.contentManagement,
						items: [
							{
								label: adminT['categories'],
								href: '/admin/categories',
								icon: mdiFolderOutline
							}
						]
					},
					{
						title: directoryT.systemMaintenance,
						items: [
							{
								label: t.backup.nav,
								href: '/admin/backups',
								icon: mdiBackupRestore
							},
							{
								label: t.maintenance.nav,
								href: '/admin/maintenance',
								icon: mdiWrenchOutline
							},
							{
								label: adminT['stats'],
								href: '/admin/stats',
								icon: mdiChartBar
							}
						]
					}
				]
			: []
	);
</script>

<div class="space-y-4">
	<PageTitle title={adminT['title'] || 'Admin'} />
	<DirectoryGrid {groups} />
</div>
