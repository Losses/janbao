<script lang="ts">
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import LinkButton from '$lib/components/atoms/LinkButton.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import ConfirmationModal from '$lib/components/organisms/ConfirmationModal.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiCommentOutline, mdiDeleteOutline, mdiArrowRight } from '@mdi/js';
	import type { ApiResult } from '$lib/types/api';

	interface ActivityComment {
		id: string;
		authorId: string;
		authorDisplayName: string;
		authorUsername: string;
		authorAvatarFileId: string | null;
		contentJson: string;
		createdAt: Date;
	}

	interface ActivityCommentsResponse {
		comments: ActivityComment[];
	}

	interface TranslationDict {
		[key: string]: string | Record<string, string>;
	}

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
		commentCount: number;
		currentUserId?: string | null;
		isAdmin?: boolean;
		t: TranslationDict;
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
		t
	}: ActivityRowProps = $props();

	const initialCommentCount = $derived(commentCount);
	const resolvedAuthorUsername = $derived(authorUsername);
	const resolvedCurrentUserId = $derived(currentUserId);
	const resolvedAuthorId = $derived(authorId);
	const resolvedIsAdmin = $derived(isAdmin);

	let showComments = $state(false);
	let comments = $state<ActivityComment[]>([]);
	let loadingComments = $state(false);
	let commentContentJson = $state('');
	let submittingComment = $state(false);
	// svelte-ignore state_referenced_locally
	let commentCountState = $state(initialCommentCount);
	let showDeleteModal = $state(false);
	let deleteTargetId = $state<string | null>(null);

	function gtc(key: string): string {
		const common = t['common'];
		if (common && typeof common === 'object' && key in common) {
			const val = common[key];
			return typeof val === 'string' ? val : key;
		}
		return key;
	}

	async function toggleComments() {
		showComments = !showComments;
		if (showComments && comments.length === 0) {
			await loadComments();
		}
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
		if (!commentContentJson.trim()) return;
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
				commentCountState += 1;
				await loadComments();
			}
		} catch {
			// Silently fail
		}
		submittingComment = false;
	}

	function confirmDelete(activityId: string) {
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
			<a href="/profile/{authorId}/{generateSlug(resolvedAuthorUsername)}">
				<Avatar
					src={authorAvatarFileId ? `/img/${authorAvatarFileId}` : null}
					displayName={authorDisplayName}
					size="md"
				/>
			</a>
		</div>
		<div class="flex-1 min-w-0">
			<div class="flex items-center gap-1 flex-wrap">
				<a
					href="/profile/{authorId}/{generateSlug(resolvedAuthorUsername)}"
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
				<DateComponent value={createdAt} {t} class="text-base-content/50 text-sm" />
			</div>

			<div class="mt-1">
				<LexicalRenderer {contentJson} />
			</div>

			<div class="flex items-center gap-3 mt-2">
				<LinkButton onclick={toggleComments} class="flex items-center gap-1 text-sm">
					<Icon path={mdiCommentOutline} size={0.9} />
					{commentCountState > 0 ? commentCountState : ''}
				</LinkButton>
				{#if resolvedCurrentUserId === resolvedAuthorId || resolvedIsAdmin}
					<LinkButton onclick={() => confirmDelete(id)} class="text-sm text-warning">
						<Icon path={mdiDeleteOutline} size={0.9} />
					</LinkButton>
				{/if}
			</div>

			{#if showComments}
				<div class="mt-3 bg-base-200/50 rounded-lg p-3">
					{#if loadingComments}
						<p class="text-sm text-base-content/50">{gtc('loading')}</p>
					{:else if comments.length > 0}
						<div class="space-y-3">
							{#each comments as comment (comment.id)}
								<div class="flex gap-2">
									<div class="flex-shrink-0">
										<a href="/profile/{comment.authorId}/{generateSlug(comment.authorUsername)}">
											<Avatar
												src={comment.authorAvatarFileId
													? `/img/${comment.authorAvatarFileId}`
													: null}
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
											<DateComponent
												value={comment.createdAt}
												{t}
												class="text-base-content/50 text-xs"
											/>
											{#if resolvedCurrentUserId === comment.authorId || resolvedIsAdmin}
												<LinkButton
													onclick={() => confirmDelete(comment.id)}
													class="text-xs text-warning ml-1"
												>
													<Icon path={mdiDeleteOutline} size={0.7} />
												</LinkButton>
											{/if}
										</div>
										<div class="mt-0.5">
											<LexicalRenderer contentJson={comment.contentJson} class="text-sm" />
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}

					{#if resolvedCurrentUserId}
						<div class="mt-3 flex gap-2">
							<input
								type="text"
								class="input input-sm input-bordered flex-1"
								placeholder={gtc('commentPlaceholder')}
								bind:value={commentContentJson}
								disabled={submittingComment}
								onkeydown={(e) => {
									if (e.key === 'Enter' && !e.shiftKey) {
										e.preventDefault();
										submitComment();
									}
								}}
							/>
							<button
								class="btn btn-sm btn-primary"
								onclick={submitComment}
								disabled={submittingComment || !commentContentJson.trim()}
							>
								{gtc('submit')}
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
