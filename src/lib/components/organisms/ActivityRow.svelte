<script lang="ts">
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import ConfirmationModal from '$lib/components/organisms/ConfirmationModal.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditor.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import { isLexicalEmpty, MAX_CONTENT_SIZE } from '$lib/utils/lexical';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiArrowRight } from '@mdi/js';
	import type { ApiResult, ActivityCommentItem, ActivityCommentsResponse } from '$lib/types/api';
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
	let commentsLoaded = $state(false);
	let comments = $state<ActivityCommentItem[]>([]);
	let loadingComments = $state(false);
	let commentContentJson = $state('');
	let submittingComment = $state(false);
	// svelte-ignore state_referenced_locally
	let commentCountState = $state(commentCount);
	let showDeleteModal = $state(false);
	let deleteTargetId = $state<number | null>(null);
	let editorKey = $state(0);

	$effect(() => {
		if (isTopLevel && !commentsLoaded) {
			commentsLoaded = true;
			loadComments();
		}
	});

	function handleCommentEditorChange(json: string) {
		commentContentJson = json;
	}

	function gtc(key: string): string {
		const common = t['common'] as Record<string, string> | undefined;
		if (common && key in common) {
			const val = common[key];
			return typeof val === 'string' ? val : key;
		}
		return key;
	}

	function toggleEditor() {
		showEditor = !showEditor;
	}

	async function loadComments() {
		loadingComments = true;
		try {
			const res = await fetch(`/api/activities?parentId=${id}`);
			if (res.ok) {
				const data: ActivityCommentsResponse = await res.json();
				comments = data.comments || [];
			}
		} catch {
			// Silently fail
		}
		loadingComments = false;
	}

	async function submitComment() {
		if (isLexicalEmpty(commentContentJson) || commentContentJson.length > MAX_CONTENT_SIZE) return;
		submittingComment = true;
		try {
			const res = await fetch('/api/activities/comments', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					parentActivityId: id,
					contentJson: commentContentJson
				})
			});
			if (res.ok) {
				commentContentJson = '';
				editorKey += 1;
				commentCountState += 1;
				showEditor = false;
				await loadComments();
			}
		} catch {
			// Silently fail
		}
		submittingComment = false;
	}

	function confirmDelete(activityId: number) {
		deleteTargetId = activityId;
		showDeleteModal = true;
	}

	async function handleDelete() {
		if (!deleteTargetId) return;
		try {
			const res = await fetch('/api/activities', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ activityId: deleteTargetId })
			});
			const result: ApiResult = await res.json();
			if (result.success) {
				if (deleteTargetId === id) {
					window.location.reload();
				} else {
					comments = comments.filter((c) => c.id !== deleteTargetId);
					commentCountState = Math.max(0, commentCountState - 1);
				}
			}
		} catch {
			// Silently fail
		}
		showDeleteModal = false;
		deleteTargetId = null;
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
		deleteTargetId = null;
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
				{#if isTopLevel && currentUserId}
					<button
						type="button"
						class="btn btn-xs btn-ghost text-base-content/60 hover:text-primary"
						onclick={toggleEditor}
					>
						{gtc('comment')}{commentCountState > 0 ? ` (${commentCountState})` : ''}
					</button>
				{/if}
				{#if currentUserId === authorId || isAdmin || currentUserId === recipientId}
					<button
						type="button"
						class="btn btn-xs btn-ghost text-error/60 hover:text-error"
						onclick={() => confirmDelete(id)}
					>
						{gtc('delete')}
					</button>
				{/if}
			</div>

			{#if isTopLevel && (showEditor || loadingComments || comments.length > 0)}
				<div class="mt-3 bg-base-200/50 rounded-box p-3">
					{#if showEditor && currentUserId}
						<div class="mb-3 flex flex-col gap-2">
							{#key editorKey}
								<LexicalEditor
									placeholder={gtc('commentPlaceholder')}
									contextType="activity"
									contextId={id}
									{t}
									disableHeadings={true}
									disableImageUpload={true}
									onContentChange={handleCommentEditorChange}
								/>
							{/key}
							<div class="flex justify-end">
								<button
									class="btn btn-sm btn-primary"
									onclick={submitComment}
									disabled={submittingComment ||
										isLexicalEmpty(commentContentJson) ||
										commentContentJson.length > MAX_CONTENT_SIZE}
								>
									{submittingComment ? gtc('saving') : gtc('submit')}
								</button>
							</div>
						</div>
					{/if}

					{#if loadingComments}
						<p class="text-sm text-base-content/50">{gtc('loading')}</p>
					{:else if comments.length > 0}
						<div class="space-y-3">
							{#each comments as comment (comment.id)}
								<div class="flex gap-2">
									<div class="flex-shrink-0">
										<a href="/profile/{comment.authorId}/{generateSlug(comment.authorUsername)}">
											<Avatar
												userId={comment.authorId}
												avatarFileId={comment.authorAvatarFileId}
												displayName={comment.authorDisplayName}
												size="xs"
											/>
										</a>
									</div>
									<div class="flex-1 min-w-0">
										<!-- Row 1: Username -->
										<div class="flex items-center gap-1 flex-wrap">
											<a
												href="/profile/{comment.authorId}/{generateSlug(comment.authorUsername)}"
												class="font-medium text-sm text-base-content hover:text-primary transition-colors"
											>
												{comment.authorDisplayName}
											</a>
										</div>
										<!-- Row 2: Content -->
										<div class="mt-0.5">
											<LexicalRenderer contentJson={comment.contentJson} class="text-sm" />
										</div>
										<!-- Row 3: Timestamp + action buttons -->
										<div
											class="flex justify-end items-center gap-2 pt-1 border-t border-base-200/50 mt-1"
										>
											<div class="flex-1 text-xs text-base-content/50">
												<DateComponent value={comment.createdAt} {t} class="text-xs" />
											</div>
											{#if currentUserId === comment.authorId || isAdmin || currentUserId === authorId || currentUserId === recipientId}
												<button
													type="button"
													class="btn btn-xs btn-ghost text-error/60 hover:text-error"
													onclick={() => confirmDelete(comment.id)}
												>
													{gtc('delete')}
												</button>
											{/if}
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
