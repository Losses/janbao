<script lang="ts">
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import ActivityComments from '$lib/components/organisms/ActivityComments.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import type { ActivityCommentItem, JoinedMember } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface JoinedActivityRowProps {
		id: number;
		createdAt: Date;
		members: JoinedMember[];
		commentCount: number;
		comments?: ActivityCommentItem[];
		authorId: number;
		currentUserId?: number | null;
		isAdmin?: boolean;
		t: TranslationDict;
	}

	let {
		id,
		createdAt,
		members,
		commentCount = 0,
		comments = [],
		authorId,
		currentUserId = null,
		isAdmin = false,
		t
	}: JoinedActivityRowProps = $props();

	let showEditor = $state(false);
	// svelte-ignore state_referenced_locally
	let commentCountState = $state(commentCount);

	const first = $derived(members[0]);
	const joinedParts = $derived(t.activity.joined.split('{users}'));
	const itemSep = $derived(t.activity.listItemSeparator);
	const lastSep = $derived(t.activity.listLastSeparator);
	const welcomeLine = $derived(t.activity.welcome);
</script>

<div class="py-4 border-b border-base-300 last:border-b-0">
	<div class="flex gap-3">
		{#if first}
			<div class="flex-shrink-0">
				<a href="/profile/{first.userId}/{generateSlug(first.username)}">
					<Avatar
						userId={first.userId}
						avatarFileId={first.avatarFileId}
						displayName={first.displayName}
						size="md"
					/>
				</a>
			</div>
		{/if}
		<div class="flex-1 min-w-0">
			<!-- Row 1: "{u1} and {u2} joined." - every connector/suffix from i18n -->
			<div class="flex items-center gap-1 flex-wrap">
				{joinedParts[0]}
				{#each members as m, i (m.userId)}
					{#if i > 0}<span class="text-base-content/60"
							>{i === members.length - 1 ? lastSep : itemSep}</span
						>{/if}
					<a
						href="/profile/{m.userId}/{generateSlug(m.username)}"
						class="font-semibold text-base-content hover:text-primary transition-colors"
					>
						{m.displayName || m.username || `user-${m.userId}`}
					</a>
				{/each}
				<span class="text-base-content/70">{joinedParts[1]}</span>
			</div>

			<!-- Row 2: excerpt -->
			{#if welcomeLine}
				<div class="mt-1">
					{welcomeLine}
				</div>
			{/if}

			<!-- Row 3: Timestamp + comment (same line) -->
			<div class="flex justify-end items-center gap-2 mt-2">
				<div class="flex-1 text-sm text-base-content/50">
					<DateComponent value={createdAt} {t} class="text-sm" />
				</div>
				{#if currentUserId !== null && currentUserId !== undefined}
					<button
						type="button"
						class="btn btn-xs btn-ghost text-base-content/60 hover:text-primary"
						onclick={() => (showEditor = !showEditor)}
					>
						{t.common.comment}{commentCountState > 0 ? ` (${commentCountState})` : ''}
					</button>
				{/if}
			</div>

			<!-- Comment thread section -->
			<ActivityComments
				activityId={id}
				open={showEditor}
				bind:commentCount={commentCountState}
				initialComments={comments}
				{currentUserId}
				{isAdmin}
				activityAuthorId={authorId}
				{t}
			/>
		</div>
	</div>
</div>
