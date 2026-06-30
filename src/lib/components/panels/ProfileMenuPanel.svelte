<!-- src/lib/components/panels/ProfileMenuPanel.svelte -->
<script lang="ts">
	import { page } from '$app/state';
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

	// The profile this preview represents lives on page.data: the route's
	// targetUser when viewing someone's profile, falling back to the viewer.
	const user = $derived(page.data.targetUser ?? page.data.user);
	const t = $derived(page.data.t);

	const profileT = $derived(t.profile);
	const tNav = $derived(t.nav);
	const directoryT = $derived(t.directory);
	const targetUserSlug = $derived(user ? generateSlug(user.username) : '');

	const groups = $derived<DirectoryGroup[]>(
		user
			? [
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
				]
			: []
	);
</script>

{#if user}
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
{/if}
