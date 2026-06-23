<!-- src/lib/components/panels/SettingsMenuPanel.svelte -->
<script lang="ts">
	import DirectoryGrid, {
		type DirectoryGroup
	} from '$lib/components/molecules/DirectoryGrid.svelte';
	import {
		mdiAccountEditOutline,
		mdiLockOutline,
		mdiAccountCircleOutline,
		mdiBellOutline,
		mdiIncognito,
		mdiCloudDownloadOutline,
		mdiFileDocumentEditOutline
	} from '@mdi/js';
	import type { UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface Props {
		user: UserInfoSummary;
		t: TranslationDict;
		lang: string;
	}

	let { user, t, lang }: Props = $props();

	const profileT = $derived(t.profile);
	const isZh = $derived(lang === 'zh-CN');

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

<div class="space-y-4">
	<DirectoryGrid {groups} />
</div>
