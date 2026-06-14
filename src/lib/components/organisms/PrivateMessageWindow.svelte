<script lang="ts">
	/**
	 * PrivateMessageWindow Organism - Conversation message stream with a
	 * composer and author-only inline editing. PMs can be edited but never
	 * deleted, so no ConfirmationModal is rendered (RQ00-Frontend §6.5).
	 */
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditor.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import { isLexicalEmpty, MAX_CONTENT_SIZE } from '$lib/utils/lexical';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { TranslationDict } from '$lib/types/translation';
	import type { MentionedUsersMap } from '$lib/types/mentions';

	interface PrivateMessage {
		id: number;
		conversationId: number;
		authorId: number;
		authorDisplayName: string;
		authorUsername: string;
		authorAvatarFileId: string | null;
		contentJson: string;
		createdAt: Date;
		updatedAt: Date;
	}

	interface PrivateMessageWindowProps {
		messages: PrivateMessage[];
		conversationId: number;
		currentUserId?: number | null;
		messageDraft?: string | null;
		t: TranslationDict;
		mentionedUsers?: MentionedUsersMap | null;
	}

	let {
		messages,
		conversationId,
		currentUserId = null,
		messageDraft = null,
		mentionedUsers = null,
		t
	}: PrivateMessageWindowProps = $props();

	let composeContent = $state('');
	let isPosting = $state(false);
	let editorKey = $state(0);

	$effect(() => {
		if (messageDraft) {
			composeContent = messageDraft;
		}
	});

	// Inline edit state - only one message edited at a time
	let editingMessageId = $state<number | null>(null);
	let editContent = $state('');
	let isSavingEdit = $state(false);

	const common = $derived((t.common ?? {}) as Record<string, string>);
	const messageT = $derived((t.message ?? {}) as Record<string, string>);
	const editorT = $derived((t.editor ?? {}) as Record<string, string>);

	function gtc(key: string): string {
		return common[key] ?? key;
	}

	function startEdit(msg: PrivateMessage) {
		editingMessageId = msg.id;
		editContent = msg.contentJson;
	}

	function cancelEdit() {
		editingMessageId = null;
		editContent = '';
	}
</script>

<div class="space-y-4">
	<!-- Message stream -->
	<div class="divide-y divide-base-300">
		{#each messages as msg (msg.id)}
			<div class="space-y-4 py-4 first:pt-0 last:pb-0">
				<!-- Metadata -->
				<div class="flex items-center gap-3">
					<a
						href="/profile/{msg.authorId}/{generateSlug(msg.authorUsername)}"
						class="flex-shrink-0"
					>
						<Avatar
							userId={msg.authorId}
							avatarFileId={msg.authorAvatarFileId}
							displayName={msg.authorDisplayName}
							size="sm"
						/>
					</a>
					<div class="flex items-center gap-2 flex-wrap min-w-0">
						<a
							href="/profile/{msg.authorId}/{generateSlug(msg.authorUsername)}"
							class="font-semibold text-sm text-base-content hover:text-primary transition-colors"
						>
							{msg.authorDisplayName}
						</a>
						<DateComponent value={msg.createdAt} {t} class="text-xs text-base-content/40" />
						{#if msg.updatedAt.getTime() !== msg.createdAt.getTime()}
							<span class="text-xs text-base-content/40">({gtc('edit')})</span>
						{/if}
					</div>
				</div>

				{#if editingMessageId === msg.id}
					<!-- Inline edit -->
					<div>
						<LexicalEditor
							contextType="message"
							contextId={msg.id}
							initialContent={msg.contentJson}
							placeholder={editorT['placeholderMessage'] ?? ''}
							disableImageUpload={true}
							onContentChange={(json) => (editContent = json)}
							{t}
							class="mb-2"
						/>
						<form
							method="POST"
							action="?/editMessage"
							use:enhance={() => {
								isSavingEdit = true;
								return async ({ result, update }) => {
									isSavingEdit = false;
									if (result.type === 'success') {
										cancelEdit();
										update();
									} else if (result.type === 'failure') {
										update();
									}
								};
							}}
							class="flex items-center justify-end gap-2"
						>
							<input type="hidden" name="messageId" value={msg.id} />
							<input type="hidden" name="contentJson" value={editContent} />
							<button
								type="submit"
								class="btn btn-primary btn-sm"
								disabled={isLexicalEmpty(editContent) ||
									editContent.length > MAX_CONTENT_SIZE ||
									isSavingEdit}
							>
								{isSavingEdit ? gtc('saving') : gtc('confirm')}
							</button>
							<button type="button" class="btn btn-ghost btn-sm" onclick={cancelEdit}>
								{gtc('cancel')}
							</button>
						</form>
					</div>
				{:else}
					<LexicalRenderer contentJson={msg.contentJson} {mentionedUsers} />

					{#if msg.authorId === currentUserId}
						<div class="flex justify-end items-center gap-2 pt-2 border-t border-base-200/50 mt-2">
							<button
								type="button"
								class="btn btn-xs btn-ghost text-base-content/60 hover:text-primary"
								onclick={() => startEdit(msg)}
							>
								{gtc('edit')}
							</button>
						</div>
					{/if}
				{/if}
			</div>
		{/each}
	</div>

	<!-- Composer -->
	{#if currentUserId}
		<div class="border-t border-base-300 pt-4">
			<form
				method="POST"
				action="?/post"
				use:enhance={() => {
					isPosting = true;
					return async ({ result }) => {
						isPosting = false;
						if (result.type === 'success') {
							composeContent = '';
							editorKey++;
							const data = result.data as { page?: number } | null;
							const page = data?.page;
							if (page) {
								const url =
									page <= 1
										? `/messages/${conversationId}`
										: `/messages/${conversationId}/p${page}`;
								goto(url);
							}
						}
					};
				}}
				class="space-y-3"
			>
				{#key editorKey}
					<LexicalEditor
						contextType="message"
						contextId={conversationId}
						initialContent={editorKey === 0 ? messageDraft : null}
						placeholder={editorT['placeholderMessage'] ?? messageT['content'] ?? ''}
						disableImageUpload={true}
						onContentChange={(json) => (composeContent = json)}
						{t}
					/>
				{/key}
				<div class="flex justify-end">
					<input type="hidden" name="contentJson" value={composeContent} />
					<button
						type="submit"
						class="btn btn-primary btn-sm"
						disabled={isLexicalEmpty(composeContent) ||
							composeContent.length > MAX_CONTENT_SIZE ||
							isPosting}
					>
						{isPosting ? gtc('saving') : (messageT['send'] ?? gtc('submit'))}
					</button>
				</div>
			</form>
		</div>
	{/if}
</div>
