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
					icon: mdiAccountEditOutline
				},
				{
					label: profileT['changePassword'],
					href: '/profile/password',
					icon: mdiLockOutline
				},
				{
					label: profileT['avatar'],
					href: '/profile/picture',
					icon: mdiAccountCircleOutline
				}
			]
		},
		{
			title: isZh ? '功能与偏好' : 'Features & Preferences',
			items: [
				{
					label: profileT['preferences'],
					href: '/profile/preferences',
					icon: mdiBellOutline
				},
				{
					label: profileT['stealthSettings'],
					href: '/profile/onlineNow',
					icon: mdiIncognito
				},
				{
					label: profileT['editorSettingsNav'],
					href: '/profile/editor',
					icon: mdiFileDocumentEditOutline
				}
			]
		},
		{
			title: isZh ? '高级特性' : 'Advanced Features',
			items: [
				{
					label: profileT['offlineReadingNav'],
					href: '/profile/offlineReading',
					icon: mdiCloudDownloadOutline
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
		<DirectoryGrid {groups} />
	</div>
</DualColumnLayout>
