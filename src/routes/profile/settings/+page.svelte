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
	import TabDiscussionsPanel from '$lib/components/panels/TabDiscussionsPanel.svelte';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();
	const navStore = getNavigationStore();
	const listCache = getListCacheStore();

	const t = $derived(data.t);
	const profileT = $derived(t.profile);
	const user = $derived(data.user);
	const directoryT = $derived(t.directory);

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
						title: directoryT.basicInfo,
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
						title: directoryT.featuresPreferences,
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
						title: directoryT.advancedFeatures,
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
			<ProfileMenuPanel {user} {t} />
		{:else}
			<TabDiscussionsPanel cache={listCache} {t} {user} />
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
