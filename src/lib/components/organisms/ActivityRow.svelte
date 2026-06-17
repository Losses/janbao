<script lang="ts">
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import ConfirmationModal from '$lib/components/organisms/ConfirmationModal.svelte';
	import ActivityComments from '$lib/components/organisms/ActivityComments.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiArrowRight } from '@mdi/js';
	import type { ApiResult } from '$lib/types/api';
	import type { MentionedUsersMap } from '$lib/types/mentions';
	import type { TranslationDict } from '$lib/types/translation';

	interface ActivityRowProps {
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
		currentUserId?: number | null;
		isAdmin?: boolean;
		t: TranslationDict;
		mentionedUsers?: MentionedUsersMap | null;
		isTopLevel?: boolean;
	}

	let {
		id,
		authorId,
		authorDisplayName,
		authorUsername,
		authorAvatarFileId,
		recipientId = null,
		recipientDisplayName = null,
		recipientUsername = null,
		contentJson,
		createdAt,
		commentCount = 0,
		currentUserId = null,
		isAdmin = false,
		t,
		mentionedUsers = null,
		isTopLevel = true
	}: ActivityRowProps = $props();

	let showEditor = $state(false);
	// svelte-ignore state_referenced_locally
	let commentCountState = $state(commentCount);
	let showDeleteModal = $state(false);

	function confirmDelete() {
		showDeleteModal = true;
	}

	async function handleDelete() {
		try {
			const res = await fetch('/api/activities', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ activityId: id })
			});
			const result: ApiResult = await res.json();
			if (result.success) {
				window.location.reload();
			}
		} catch {
			// Silently fail
		}
		showDeleteModal = false;
	}
</script>

<ConfirmationModal
	open={showDeleteModal}
	title={t.common.delete}
	message={t.common.deleteConfirm}
	confirmLabel={t.common.delete}
	cancelLabel={t.common.cancel}
	onconfirm={handleDelete}
	oncancel={() => {
		showDeleteModal = false;
	}}
/>

<div class="py-4 border-b border-base-300 last:border-b-0">
	<div class="flex gap-3">
		<div class="flex-shrink-0">
			<a href="/profile/{authorId}/{generateSlug(authorUsername)}">
				<Avatar
					userId={authorId}
					avatarFileId={authorAvatarFileId}
					displayName={authorDisplayName}
					size="md"
				/>
			</a>
		</div>
		<div class="flex-1 min-w-0">
			<!-- Row 1: Username (→ recipient) -->
			<div class="flex items-center gap-1 flex-wrap">
				<a
					href="/profile/{authorId}/{generateSlug(authorUsername)}"
					class="font-semibold text-base-content hover:text-primary transition-colors"
				>
					{authorDisplayName}
				</a>
				{#if recipientId && recipientDisplayName}
					<span class="flex items-center gap-1 text-base-content/60">
						<Icon path={mdiArrowRight} size={16} />
						<a
							href="/profile/{recipientId}/{generateSlug(recipientUsername || '')}"
							class="font-semibold text-base-content hover:text-primary transition-colors"
						>
							{recipientDisplayName}
						</a>
					</span>
				{/if}
			</div>

			<!-- Row 2: Content -->
			<div class="mt-1">
				<LexicalRenderer {contentJson} {mentionedUsers} {t} />
			</div>

			<!-- Row 3: Timestamp + comment + delete (same line) -->
			<div class="flex justify-end items-center gap-2 mt-2">
				<div class="flex-1 text-sm text-base-content/50">
					<DateComponent value={createdAt} {t} class="text-sm" />
				</div>
				{#if isTopLevel && currentUserId !== null && currentUserId !== undefined}
					<button
						type="button"
						class="btn btn-xs btn-ghost text-base-content/60 hover:text-primary"
						onclick={() => (showEditor = !showEditor)}
					>
						{t.common.comment}{commentCountState > 0 ? ` (${commentCountState})` : ''}
					</button>
				{/if}
				{#if currentUserId === authorId || isAdmin || currentUserId === recipientId}
					<button
						type="button"
						class="btn btn-xs btn-ghost text-error/60 hover:text-error"
						onclick={confirmDelete}
					>
						{t.common.delete}
					</button>
				{/if}
			</div>

			{#if isTopLevel}
				<ActivityComments
					activityId={id}
					open={showEditor}
					bind:commentCount={commentCountState}
					{currentUserId}
					{isAdmin}
					activityAuthorId={authorId}
					activityRecipientId={recipientId}
					{t}
				/>
			{/if}
		</div>
	</div>
</div>
