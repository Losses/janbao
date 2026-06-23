<!-- src/lib/components/panels/AdminMenuPanel.svelte -->
<script lang="ts">
	import DirectoryGrid, {
		type DirectoryGroup
	} from '$lib/components/molecules/DirectoryGrid.svelte';
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
		lang: string;
	}

	let { user, t, lang }: Props = $props();

	const adminT = $derived(t.admin);
	const isZh = $derived(lang === 'zh-CN');

	const groups = $derived<DirectoryGroup[]>(
		user
			? [
					{
						title: isZh ? '权限与用户' : 'Permissions & Users',
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
						title: isZh ? '内容管理' : 'Content Management',
						items: [
							{
								label: adminT['categories'],
								href: '/admin/categories',
								icon: mdiFolderOutline
							}
						]
					},
					{
						title: isZh ? '系统维护' : 'System Maintenance',
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
	<DirectoryGrid {groups} />
</div>
