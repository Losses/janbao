<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import SettingsSidebar from '$lib/components/molecules/SettingsSidebar.svelte';
	import DirectoryGrid, {
		type DirectoryGroup
	} from '$lib/components/molecules/DirectoryGrid.svelte';
	import PageTitle from '$lib/components/molecules/PageTitle.svelte';
	import { formatTitle } from '$lib/utils/title';
	import {
		mdiAccountEditOutline,
		mdiLockOutline,
		mdiAccountCircleOutline,
		mdiBellOutline,
		mdiIncognito,
		mdiCloudDownloadOutline,
		mdiFileDocumentEditOutline,
		mdiPalette
	} from '@mdi/js';
	import GesturePageLayout from '$lib/components/templates/GesturePageLayout.svelte';
	import ProfileMenuPanel from '$lib/components/panels/ProfileMenuPanel.svelte';
	import { getNavigationStore } from '$lib/stores/navigation.svelte';
	import { getListCacheStore } from '$lib/stores/list-cache.svelte';
	import DiscussionsPanel from '$lib/components/panels/DiscussionsPanel.svelte';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();
	const navStore = getNavigationStore();
	const listCache = getListCacheStore();

	const cachedDiscussions = $derived(listCache.discussions?.items);

	const t = $derived(data.t);
	const profileT = $derived(t.profile);
	const user = $derived(data.user);

	const isZh = $derived(data.lang === 'zh-CN');

	const prevPath = $derived(
		navStore.activeStack.length >= 2
			? navStore.activeStack[navStore.activeStack.length - 2].pathname
			: null
	);
	const targetHref = $derived(prevPath === '/profile' ? '/profile' : '/');

	const groups = $derived<DirectoryGroup[]>(
		user
			? [
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
							},
							{
								label: profileT['appearanceSettingsNav'],
								href: '/profile/appearance',
								icon: mdiPalette
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
				]
			: []
	);
</script>

<svelte:head>
	<title>{formatTitle(profileT['accountSettings'] || 'Settings')}</title>
</svelte:head>

{#snippet sidebar()}
	{#if user}
		<SettingsSidebar {user} {t} activeItem="" />
	{/if}
{/snippet}

{#snippet leftPanel()}
	{#if user}
		{#if prevPath === '/profile'}
			<ProfileMenuPanel {user} {t} lang={data.lang} />
		{:else}
			<DiscussionsPanel
				discussions={cachedDiscussions}
				currentPage={listCache.discussions?.page ?? 1}
				totalPages={listCache.discussions?.totalPages ?? 1}
				{t}
				buildPageUrl={(page) => (page === 1 ? '/' : `/discussions/p${page}`)}
				paginate={true}
			/>
		{/if}
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<GesturePageLayout left={leftPanel} leftHref={targetHref} fallbackRoute={targetHref}>
		<div class="space-y-4">
			<PageTitle title={profileT['accountSettings'] || 'Settings'} />
			<DirectoryGrid {groups} />
		</div>
	</GesturePageLayout>
</DualColumnLayout>
