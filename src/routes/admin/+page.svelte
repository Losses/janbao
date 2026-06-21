<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import AdminSidebar from '$lib/components/molecules/AdminSidebar.svelte';
	import DirectoryGrid, {
		type DirectoryGroup
	} from '$lib/components/molecules/DirectoryGrid.svelte';
	import PageTitle from '$lib/components/molecules/PageTitle.svelte';
	import { formatTitle } from '$lib/utils/title';
	import {
		mdiAccountGroup,
		mdiShieldLockOutline,
		mdiFolderOutline,
		mdiBackupRestore,
		mdiWrenchOutline,
		mdiChartBar
	} from '@mdi/js';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const adminT = $derived(t.admin);
	const user = $derived(data.user);

	const isZh = $derived(data.lang === 'zh-CN');

	// Client-side desktop check: redirect to user groups if the screen is desktop size
	onMount(() => {
		const MOBILE_BREAKPOINT = '(max-width: 767px)';
		const mq = window.matchMedia(MOBILE_BREAKPOINT);
		if (!mq.matches) {
			void goto('/admin/user-groups', { replaceState: true });
		}
	});

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

<svelte:head>
	<title>{formatTitle(adminT['title'] || 'Admin')}</title>
</svelte:head>

{#snippet sidebar()}
	{#if user}
		<AdminSidebar {user} {t} activeItem="" />
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-4">
		<PageTitle title={adminT['title'] || 'Admin'} />
		<DirectoryGrid {groups} />
	</div>
</DualColumnLayout>
