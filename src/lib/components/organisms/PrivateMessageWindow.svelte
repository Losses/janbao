<script lang="ts">
	/**
	 * PrivateMessageWindow Organism - Conversation message stream with a
	 * composer and author-only inline editing. PMs can be edited but never
	 * deleted, so no ConfirmationModal is rendered (RQ00-Frontend §6.5).
	 */
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import LinkButton from '$lib/components/atoms/LinkButton.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditor.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { mdiPencilOutline } from '@mdi/js';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import type { TranslationDict } from '$lib/types/translation';
	import type { MentionedUsersMap } from '$lib/types/mentions';

	interface PrivateMessage {
		id: string;
		conversationId: string;
		authorId: string;
		authorDisplayName: string;
		authorUsername: string;
		authorAvatarFileId: string | null;
		contentJson: string;
		createdAt: Date;
		updatedAt: Date;
	}

	interface PrivateMessageWindowProps {
		messages: PrivateMessage[];
		conversationId: string;
		currentUserId?: string | null;
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

	// Inline edit state - only one message edited at a time
	let editingMessageId = $state<string | null>(null);
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
	{#each messages as msg (msg.id)}
		<div
			class="card bg-base-100 border border-base-200 rounded-xl p-4 shadow-sm {msg.authorId ===
			currentUserId
				? 'border-primary/30'
				: ''}"
		>
			<div class="flex gap-3">
				<div class="flex-shrink-0">
					<a href="/profile/{msg.authorId}/{generateSlug(msg.authorUsername)}">
						<Avatar
							src={msg.authorAvatarFileId ? `/img/${msg.authorAvatarFileId}` : null}
							displayName={msg.authorDisplayName}
							size="sm"
						/>
					</a>
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2 flex-wrap">
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

					{#if editingMessageId === msg.id}
						<!-- Inline edit -->
						<div class="mt-2">
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
								class="flex items-center gap-2"
							>
								<input type="hidden" name="messageId" value={msg.id} />
								<input type="hidden" name="contentJson" value={editContent} />
								<button
									type="submit"
									class="btn btn-primary btn-sm"
									disabled={!editContent || isSavingEdit}
								>
									{isSavingEdit ? gtc('saving') : gtc('confirm')}
								</button>
								<button type="button" class="btn btn-ghost btn-sm" onclick={cancelEdit}>
									{gtc('cancel')}
								</button>
							</form>
						</div>
					{:else}
						<div class="mt-1">
							<LexicalRenderer contentJson={msg.contentJson} {mentionedUsers} />
						</div>
						{#if msg.authorId === currentUserId}
							<div class="mt-1">
								<LinkButton onclick={() => startEdit(msg)} class="text-xs">
									<Icon path={mdiPencilOutline} size={0.8} />
									{gtc('edit')}
								</LinkButton>
							</div>
						{/if}
					{/if}
				</div>
			</div>
		</div>
	{/each}

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
						disabled={!composeContent || isPosting}
					>
						{isPosting ? gtc('saving') : (messageT['send'] ?? gtc('submit'))}
					</button>
				</div>
			</form>
		</div>
	{/if}
</div>
