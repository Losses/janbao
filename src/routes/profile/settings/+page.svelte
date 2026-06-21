<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import SettingsSidebar from '$lib/components/molecules/SettingsSidebar.svelte';
	import DirectoryGrid, { type DirectoryGroup } from '$lib/components/molecules/DirectoryGrid.svelte';
	import PageTitle from '$lib/components/molecules/PageTitle.svelte';
	import { formatTitle } from '$lib/utils/title';
	import {
		mdiAccountEditOutline,
		mdiLockOutline,
		mdiAccountCircleOutline,
		mdiBellOutline,
		mdiIncognito,
		mdiCloudDownloadOutline,
		mdiFileDocumentEditOutline
	} from '@mdi/js';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const profileT = $derived(t.profile);
	const user = $derived(data.user);

	const isZh = $derived(data.lang === 'zh-CN');

	const groups = $derived<DirectoryGroup[]>(user ? [
		{
			title: isZh ? '基本信息' : 'Basic Info',
			items: [
				{
					label: profileT['editAccount'],
					href: '/profile/edit',
					icon: mdiAccountEditOutline,
					description: isZh ? '更新您的公开显示名称、邮箱和个人简介' : 'Update your display name, email, and bio'
				},
				{
					label: profileT['changePassword'],
					href: '/profile/password',
					icon: mdiLockOutline,
					description: isZh ? '定期修改您的登录密码以确保账户安全' : 'Change your account password for security'
				},
				{
					label: profileT['avatar'],
					href: '/profile/picture',
					icon: mdiAccountCircleOutline,
					description: isZh ? '上传或更新您的论坛个人头像' : 'Upload or update your forum profile picture'
				}
			]
		},
		{
			title: isZh ? '功能与偏好' : 'Features & Preferences',
			items: [
				{
					label: profileT['preferences'],
					href: '/profile/preferences',
					icon: mdiBellOutline,
					description: isZh ? '配置各种论坛互动的站内信与通知推送' : 'Configure email and notify preferences for interactions'
				},
				{
					label: profileT['stealthSettings'],
					href: '/profile/onlineNow',
					icon: mdiIncognito,
					description: isZh ? '启用隐身模式以隐藏您的在线状态' : 'Toggle incognito mode to hide your online status'
				},
				{
					label: profileT['editorSettingsNav'],
					href: '/profile/editor',
					icon: mdiFileDocumentEditOutline,
					description: isZh ? '自定义您的发帖与回复富文本编辑器偏好' : 'Customize your rich text post editor options'
				}
			]
		},
		{
			title: isZh ? '高级特性' : 'Advanced Features',
			items: [
				{
					label: profileT['offlineReadingNav'],
					href: '/profile/offlineReading',
					icon: mdiCloudDownloadOutline,
					description: isZh ? '管理离线缓存以在无网状态下阅读内容' : 'Configure device caching to read threads offline'
				}
			]
		}
	] : []);
</script>

<svelte:head>
	<title>{formatTitle(profileT['accountSettings'] || 'Settings')}</title>
</svelte:head>

{#snippet sidebar()}
	{#if user}
		<SettingsSidebar {user} {t} activeItem="" />
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-4">
		<PageTitle title={profileT['accountSettings'] || 'Settings'} />
		<div class="border-t border-base-300 pt-4">
			<DirectoryGrid {groups} />
		</div>
	</div>
</DualColumnLayout>
