<script lang="ts">
	import ActivityRow from '$lib/components/organisms/ActivityRow.svelte';
	import JoinedActivityRow from '$lib/components/organisms/JoinedActivityRow.svelte';
	import type { JoinedMember } from '$lib/types/api';
	import type { MentionedUsersMap } from '$lib/types/mentions';
	import type { TranslationDict } from '$lib/types/translation';

	// A feed item as produced by the /activity and profile loaders. The fields
	// are the union of what ActivityRow and JoinedActivityRow consume.
	export interface ActivityListItem {
		id: number;
		authorId: number;
		authorDisplayName: string;
		authorUsername: string;
		authorAvatarFileId: string | null;
		recipientId?: number | null;
		recipientDisplayName?: string | null;
		recipientUsername?: string | null;
		contentJson: string;
		createdAt: Date;
		commentCount: number;
		isJoined: boolean;
		joinedMembers: JoinedMember[];
	}

	interface ActivityListProps {
		items: ActivityListItem[];
		locale: string;
		currentUserId?: number | null;
		isAdmin?: boolean;
		mentionedUsers?: MentionedUsersMap | null;
		t: TranslationDict;
	}

	let {
		items,
		locale,
		currentUserId = null,
		isAdmin = false,
		mentionedUsers = null,
		t
	}: ActivityListProps = $props();
</script>

{#each items as activity (activity.id)}
	{#if activity.isJoined}
		<JoinedActivityRow
			createdAt={activity.createdAt}
			members={activity.joinedMembers}
			{locale}
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
