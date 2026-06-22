<script lang="ts">
	import ActivityRow from '$lib/components/organisms/ActivityRow.svelte';
	import JoinedActivityRow from '$lib/components/organisms/JoinedActivityRow.svelte';
	import type { ActivityListItem } from '$lib/types/api';
	import type { MentionedUsersMap } from '$lib/types/mentions';
	import type { TranslationDict } from '$lib/types/translation';

	interface ActivityListProps {
		items: ActivityListItem[];
		currentUserId?: number | null;
		isAdmin?: boolean;
		mentionedUsers?: MentionedUsersMap | null;
		t: TranslationDict;
	}

	let {
		items,
		currentUserId = null,
		isAdmin = false,
		mentionedUsers = null,
		t
	}: ActivityListProps = $props();
</script>

{#each items as activity (activity.id)}
	{#if activity.isJoined}
		<JoinedActivityRow
			id={activity.id}
			createdAt={activity.createdAt}
			members={activity.joinedMembers}
			commentCount={activity.commentCount}
			authorId={activity.authorId}
			{currentUserId}
			{isAdmin}
			{t}
		/>
	{:else}
		<ActivityRow
			id={activity.id}
			authorId={activity.authorId}
			authorDisplayName={activity.authorDisplayName}
			authorUsername={activity.authorUsername}
			authorAvatarFileId={activity.authorAvatarFileId}
			recipientId={activity.recipientId}
			recipientDisplayName={activity.recipientDisplayName}
			recipientUsername={activity.recipientUsername}
			contentJson={activity.contentJson}
			createdAt={activity.createdAt}
			commentCount={activity.commentCount}
			{currentUserId}
			{isAdmin}
			{t}
			{mentionedUsers}
		/>
	{/if}
{/each}
