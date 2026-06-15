<script lang="ts">
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import ConfirmationModal from '$lib/components/organisms/ConfirmationModal.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditor.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import { isLexicalEmpty, MAX_CONTENT_SIZE } from '$lib/utils/lexical';
	import type { ApiResult, ActivityCommentItem, ActivityCommentsResponse } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	// Collapsible comment thread for a top-level activity. The toggle button
	// lives in the parent row; this renders the editor + list. `open` is
	// parent-controlled, `commentCount` is bindable.

	interface ActivityCommentsProps {
		activityId: number;
		open: boolean;
		commentCount: number;
		currentUserId?: number | null;
		isAdmin?: boolean;
		activityAuthorId: number;
		activityRecipientId?: number | null;
		t: TranslationDict;
	}

	let {
		activityId,
		open = false,
		commentCount = $bindable(0),
		currentUserId = null,
		isAdmin = false,
		activityAuthorId,
		activityRecipientId = null,
		t
	}: ActivityCommentsProps = $props();

	let commentsLoaded = $state(false);
	let comments = $state<ActivityCommentItem[]>([]);
	let loadingComments = $state(false);
	let commentContentJson = $state('');
	let submittingComment = $state(false);
	let showDeleteModal = $state(false);
	let deleteTargetId = $state<number | null>(null);
	let editorKey = $state(0);

	$effect(() => {
		if (!commentsLoaded) {
			commentsLoaded = true;
			loadComments();
		}
	});

	function gtc(key: string): string {
		const common = t['common'] as Record<string, string> | undefined;
		if (common && key in common) {
			const val = common[key];
			return typeof val === 'string' ? val : key;
		}
		return key;
	}

	function handleCommentEditorChange(json: string) {
		commentContentJson = json;
	}

	function canDeleteComment(authorId: number): boolean {
		return (
			currentUserId === authorId ||
			isAdmin ||
			currentUserId === activityAuthorId ||
			currentUserId === activityRecipientId
		);
	}

	async function loadComments() {
		loadingComments = true;
		try {
			const res = await fetch(`/api/activities?parentId=${activityId}`);
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
				body: JSON.stringify({ parentActivityId: activityId, contentJson: commentContentJson })
			});
			if (res.ok) {
				commentContentJson = '';
				editorKey += 1;
				commentCount += 1;
				await loadComments();
			}
		} catch {
			// Silently fail
		}
		submittingComment = false;
	}

	function confirmDelete(commentId: number) {
		deleteTargetId = commentId;
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
				comments = comments.filter((c) => c.id !== deleteTargetId);
				commentCount = Math.max(0, commentCount - 1);
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

{#if open || loadingComments || comments.length > 0}
	<div class="mt-3 bg-base-200/50 rounded-box p-3">
		{#if open && currentUserId !== null && currentUserId !== undefined}
			<div class="mb-3 flex flex-col gap-2">
				{#key editorKey}
					<LexicalEditor
						placeholder={gtc('commentPlaceholder')}
						contextType="activity"
						contextId={activityId}
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
							<div class="flex items-center gap-1 flex-wrap">
								<a
									href="/profile/{comment.authorId}/{generateSlug(comment.authorUsername)}"
									class="font-medium text-sm text-base-content hover:text-primary transition-colors"
								>
									{comment.authorDisplayName}
								</a>
							</div>
							<div class="mt-0.5">
								<LexicalRenderer contentJson={comment.contentJson} class="text-sm" />
							</div>
							<div class="flex justify-end items-center gap-2 mt-1">
								<div class="flex-1 text-xs text-base-content/50">
									<DateComponent value={comment.createdAt} {t} class="text-xs" />
								</div>
								{#if canDeleteComment(comment.authorId)}
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
