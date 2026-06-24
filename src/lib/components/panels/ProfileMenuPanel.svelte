<!-- src/lib/components/panels/ProfileMenuPanel.svelte -->
<script lang="ts">
	import ProfileHeader from '$lib/components/molecules/ProfileHeader.svelte';
	import DirectoryGrid, {
		type DirectoryGroup
	} from '$lib/components/molecules/DirectoryGrid.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import {
		mdiLightningBolt,
		mdiBell,
		mdiAccountPlusOutline,
		mdiEmailOutline,
		mdiForum,
		mdiCommentOutline,
		mdiPalette,
		mdiLogout
	} from '@mdi/js';
	import type { ProfileHeaderUser } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	type UserData = NonNullable<App.Locals['user']>;

	interface Props {
		user: ProfileHeaderUser | UserData;
		t: TranslationDict;
	}

	let { user, t }: Props = $props();

	const profileT = $derived(t.profile);
	const tNav = $derived(t.nav);
	const directoryT = $derived(t.directory);
	const targetUserSlug = $derived(generateSlug(user.username));

	const groups = $derived<DirectoryGroup[]>([
		{
			title: directoryT.personalInteractions,
			items: [
				{
					label: profileT['activities'],
					href: `/profile/${user.id}/${targetUserSlug}`,
					icon: mdiLightningBolt
				},
				{
					label: profileT['discussions'],
					href: `/profile/discussions/${user.id}/${targetUserSlug}`,
					icon: mdiForum
				},
				{
					label: profileT['comments'],
					href: `/profile/comments/${user.id}/${targetUserSlug}`,
					icon: mdiCommentOutline
				}
			]
		},
		{
			title: directoryT.messagesNotifications,
			items: [
				{
					label: profileT['mailbox'],
					href: '/messages/inbox',
					icon: mdiEmailOutline
				},
				{
					label: profileT['notifications'],
					href: '/notifications',
					icon: mdiBell
				}
			]
		},
		{
			title: directoryT.accountSystem,
			items: [
				{
					label: profileT['invitations'],
					href: '/profile/invitations',
					icon: mdiAccountPlusOutline
				},
				{
					label: profileT['appearanceSettingsNav'],
					href: '/profile/appearance',
					icon: mdiPalette
				},
				{
					label: tNav['signout'],
					href: '/entry/signout',
					icon: mdiLogout,
					tone: 'error'
				}
			]
		}
	]);
</script>

<div class="space-y-6">
	<ProfileHeader
		targetUser={user}
		invitedBy={null}
		email={'email' in user ? user.email : null}
		showLastActive={true}
		{t}
	/>
	<DirectoryGrid {groups} />
</div>
