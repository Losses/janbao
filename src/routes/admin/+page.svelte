<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import AdminSidebar from '$lib/components/molecules/AdminSidebar.svelte';
	import DirectoryGrid, { type DirectoryGroup } from '$lib/components/molecules/DirectoryGrid.svelte';
	import PageTitle from '$lib/components/molecules/PageTitle.svelte';
	import { formatTitle } from '$lib/utils/title';
	import {
		mdiAccountGroup,
		mdiShieldLockOutline,
		mdiFolderOutline,
		mdiBackupRestore,
		mdiWrenchOutline
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

	const groups = $derived<DirectoryGroup[]>(user ? [
		{
			title: isZh ? '权限与用户' : 'Permissions & Users',
			items: [
				{
					label: adminT['userGroups'],
					href: '/admin/user-groups',
					icon: mdiAccountGroup,
					description: isZh ? '管理用户组设置及各组描述信息' : 'Manage user groups and descriptions'
				},
				{
					label: adminT['categoryPermissions'],
					href: '/admin/permissions',
					icon: mdiShieldLockOutline,
					description: isZh ? '为话题分类配置细粒度的用户组读写发表权限' : 'Configure permissions per category'
				}
			]
		},
		{
			title: isZh ? '内容管理' : 'Content Management',
			items: [
				{
					label: adminT['categories'],
					href: '/admin/categories',
					icon: mdiFolderOutline,
					description: isZh ? '添加、编辑或删除论坛话题分类及Slug设置' : 'Manage forum discussion categories'
				}
			]
		},
		{
			title: isZh ? '系统维护' : 'System Maintenance',
			items: [
				{
					label: t.backup.nav,
					href: '/admin/backups',
					icon: mdiBackupRestore,
					description: isZh ? '管理数据库自动快照，进行手动备份与下载还原' : 'Manage database backups and snapshotting'
				},
				{
					label: t.maintenance.nav,
					href: '/admin/maintenance',
					icon: mdiWrenchOutline,
					description: isZh ? '刷新查询规划器统计，执行完整性校验与索引重建' : 'Perform database optimization and index rebuilds'
				}
			]
		}
	] : []);
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
		<div class="border-t border-base-300 pt-4">
			<DirectoryGrid {groups} />
		</div>
	</div>
</DualColumnLayout>
