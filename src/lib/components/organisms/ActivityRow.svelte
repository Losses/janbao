<script lang="ts">
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import ConfirmationModal from '$lib/components/organisms/ConfirmationModal.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiArrowRight } from '@mdi/js';
	import type { ApiResult } from '$lib/types/api';
	import type { MentionedUsersMap } from '$lib/types/mentions';
	import type { TranslationDict } from '$lib/types/translation';

	interface ActivityRowProps {
		id: string;
		authorId: string;
		authorDisplayName: string;
		authorUsername: string;
		authorAvatarFileId: string | null;
		recipientId?: string | null;
		recipientDisplayName?: string | null;
		recipientUsername?: string | null;
		contentJson: string;
		createdAt: Date;
		currentUserId?: string | null;
		isAdmin?: boolean;
		t: TranslationDict;
		mentionedUsers?: MentionedUsersMap | null;
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
		currentUserId = null,
		isAdmin = false,
		t,
		mentionedUsers = null
	}: ActivityRowProps = $props();

	let showDeleteModal = $state(false);

	function gtc(key: string): string {
		const common = t['common'] as Record<string, string> | undefined;
		if (common && key in common) {
			const val = common[key];
			return typeof val === 'string' ? val : key;
		}
		return key;
	}

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
	title={gtc('delete')}
	message={gtc('deleteConfirm')}
	confirmLabel={gtc('delete')}
	cancelLabel={gtc('cancel')}
	onconfirm={handleDelete}
	oncancel={() => {
		showDeleteModal = false;
	}}
/>

<div class="py-4">
	<div class="flex gap-3">
		<div class="flex-shrink-0">
			<a href="/profile/{authorId}/{generateSlug(authorUsername)}">
				<Avatar
					src={authorAvatarFileId ? `/img/${authorAvatarFileId}` : null}
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
						<Icon path={mdiArrowRight} size={0.8} />
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
				<LexicalRenderer {contentJson} {mentionedUsers} />
			</div>

			<!-- Row 3: Timestamp + action buttons -->
			<div class="flex justify-end items-center gap-2 pt-2 border-t border-base-200/50 mt-2">
				<div class="flex-1 text-sm text-base-content/50">
					<DateComponent value={createdAt} {t} class="text-sm" />
				</div>
				{#if currentUserId === authorId || isAdmin || currentUserId === recipientId}
					<button
						type="button"
						class="btn btn-xs btn-ghost text-error/60 hover:text-error"
						onclick={confirmDelete}
					>
						{gtc('delete')}
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>
