<!-- src/lib/components/panels/SettingsMenuPanel.svelte -->
<script lang="ts">
	import DirectoryGrid, {
		type DirectoryGroup
	} from '$lib/components/molecules/DirectoryGrid.svelte';
	import PageTitle from '$lib/components/molecules/PageTitle.svelte';
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
	import type { UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface Props {
		user: UserInfoSummary;
		t: TranslationDict;
	}

	let { user, t }: Props = $props();

	const profileT = $derived(t.profile);
	const directoryT = $derived(t.directory);

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

<div class="space-y-4">
	<PageTitle title={profileT['accountSettings'] || 'Settings'} />
	<DirectoryGrid {groups} />
</div>
