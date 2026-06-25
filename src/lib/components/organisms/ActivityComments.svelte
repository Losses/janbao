<script lang="ts">
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import ConfirmationModal from '$lib/components/organisms/ConfirmationModal.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditorLazy.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import { isLexicalEmpty, MAX_CONTENT_SIZE } from '$lib/utils/lexical';
	import { formatDisplayName } from '$lib/utils/user';
	import type { ApiResult, ActivityCommentItem, ActivityCommentsResponse } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	// Collapsible comment thread for a top-level activity. The toggle button
	// lives in the parent row; this renders the editor + list. `open` is
	// parent-controlled, `commentCount` is bindable.

	interface ActivityCommentsProps {
		activityId: number;
		open: boolean;
		commentCount: number;
		initialComments?: ActivityCommentItem[];
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
		initialComments = [],
		currentUserId = null,
		isAdmin = false,
		activityAuthorId,
		activityRecipientId = null,
		t
	}: ActivityCommentsProps = $props();

	// Comments are bundled by the page load (loadActivityPage), so local state is
	// seeded from that prop and only refetched after a submit. There is no eager
	// fetch on mount - the previous unconditional $effect fired a request for
	// every row on the page and flashed "加载中" while it was in flight.
	// svelte-ignore state_referenced_locally
	let comments = $state<ActivityCommentItem[]>(initialComments);
	let commentContentJson = $state('');
	let submittingComment = $state(false);
	let showDeleteModal = $state(false);
	let deleteTargetId = $state<number | null>(null);
	let editorKey = $state(0);

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
		try {
			const res = await fetch(`/api/activities?parentId=${activityId}`);
			if (res.ok) {
				const data: ActivityCommentsResponse = await res.json();
				comments = data.comments || [];
			}
		} catch {
			// Silently fail
		}
	}

	async function submitComment() {
		if (submittingComment) return;
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
			} else if (res.status === 429) {
				alert(t.common.tooManyRequests);
			} else {
				const data = (await res.json().catch(() => null)) as ApiResult | null;
				alert(data?.error || t.common.error);
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
	title={t.common.delete}
	message={t.common.deleteConfirm}
	confirmLabel={t.common.delete}
	cancelLabel={t.common.cancel}
	onconfirm={handleDelete}
	oncancel={() => {
		showDeleteModal = false;
		deleteTargetId = null;
	}}
/>

{#if open || comments.length > 0}
	<div class="mt-3 bg-base-200/50 rounded-box p-3">
		{#if open && currentUserId !== null && currentUserId !== undefined}
			<div class="mb-3 flex flex-col gap-2">
				{#key editorKey}
					<LexicalEditor
						placeholder={t.common.commentPlaceholder}
						contextType="activity"
						contextId={activityId}
						{t}
						disableHeadings={true}
						disableImageUpload={true}
						onContentChange={handleCommentEditorChange}
						onSubmit={submitComment}
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
						{submittingComment ? t.common.saving : t.common.submit}
					</button>
				</div>
			</div>
		{/if}

		{#if comments.length > 0}
			<div class="space-y-3">
				{#each comments as comment (comment.id)}
					<div class="flex gap-2">
						<div class="flex-shrink-0">
							<a href="/profile/{comment.authorId}/{generateSlug(comment.authorUsername)}">
								<Avatar
									avatarUrl={comment.authorAvatarUrl}
									displayName={formatDisplayName(comment.authorDisplayName, comment.authorId, t)}
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
									{formatDisplayName(comment.authorDisplayName, comment.authorId, t)}
								</a>
							</div>
							<div class="mt-0.5">
								<LexicalRenderer contentJson={comment.contentJson} class="text-sm" {t} />
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
										{t.common.delete}
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
