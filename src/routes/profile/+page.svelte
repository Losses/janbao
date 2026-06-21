<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import ProfileHeader from '$lib/components/molecules/ProfileHeader.svelte';
	import DirectoryGrid, { type DirectoryGroup } from '$lib/components/molecules/DirectoryGrid.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import {
		mdiLightningBolt,
		mdiBell,
		mdiAccountPlusOutline,
		mdiEmailOutline,
		mdiForum,
		mdiCommentOutline
	} from '@mdi/js';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const profileT = $derived(t.profile);
	const user = $derived(data.user);
	const targetUser = $derived(data.headerPayload.user);
	const targetUserSlug = $derived(generateSlug(targetUser.username));

	const isZh = $derived(data.lang === 'zh-CN');

	const groups = $derived<DirectoryGroup[]>(user ? [
		{
			title: isZh ? '个人互动' : 'Personal Interactions',
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
			title: isZh ? '消息与通知' : 'Messages & Notifications',
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
			title: isZh ? '账号与系统' : 'Account & System',
			items: [
				{
					label: profileT['invitations'],
					href: '/profile/invitations',
					icon: mdiAccountPlusOutline
				}
			]
		}
	] : []);
</script>

<svelte:head>
	<title>{formatTitle(profileT.accountSettings || 'Profile')}</title>
</svelte:head>

{#snippet sidebar()}
	{#if user}
		<ProfileSidebar
			{user}
			{t}
			activeItem=""
			targetUserId={user.id}
			targetUserSlug={targetUserSlug}
		/>
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-6">
		{#if data.headerPayload}
			<ProfileHeader
				targetUser={data.headerPayload.user}
				invitedBy={data.headerPayload.invitedBy}
				email={data.headerPayload.email}
				showLastActive={true}
				t={t}
			/>
			<DirectoryGrid {groups} />
		{/if}
	</div>
</DualColumnLayout>
