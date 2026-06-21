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
					icon: mdiLightningBolt,
					description: isZh ? '查看发布的所有动态和留言' : 'View all posted activities and comments'
				},
				{
					label: profileT['discussions'],
					href: `/profile/discussions/${user.id}/${targetUserSlug}`,
					icon: mdiForum,
					description: isZh ? '查看发起的所有讨论话题' : 'View all initiated discussions'
				},
				{
					label: profileT['comments'],
					href: `/profile/comments/${user.id}/${targetUserSlug}`,
					icon: mdiCommentOutline,
					description: isZh ? '查看参与的所有讨论回复与评论' : 'View all replied comments and discussions'
				}
			]
		},
		{
			title: isZh ? '消息与通知' : 'Messages & Notifications',
			items: [
				{
					label: profileT['mailbox'],
					href: '/messages/inbox',
					icon: mdiEmailOutline,
					description: isZh ? '与其他用户的私聊站内信' : 'Private messages with other users'
				},
				{
					label: profileT['notifications'],
					href: '/notifications',
					icon: mdiBell,
					description: isZh ? '接收系统与互动的通知提醒' : 'Receive system and interaction alerts'
				}
			]
		},
		{
			title: isZh ? '账号与系统' : 'Account & System',
			items: [
				{
					label: profileT['invitations'],
					href: '/profile/invitations',
					icon: mdiAccountPlusOutline,
					description: isZh ? '管理与生成新用户的邀请码' : 'Manage and generate invite codes'
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
			<div class="border-t border-base-300 pt-6">
				<DirectoryGrid {groups} />
			</div>
		{/if}
	</div>
</DualColumnLayout>
