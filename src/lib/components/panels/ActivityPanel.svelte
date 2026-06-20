<script lang="ts">
	/**
	 * ActivityPanel - Content-only activity feed (composer + stream). Owns the
	 * composer `$state` (editorContent / submitting / editorKey) and the submit
	 * handler, so when the mobile pager mounts this panel once and keeps it alive,
	 * an in-progress post survives switching to another tab and back. Has no
	 * chrome of its own.
	 *
	 * NOTE: the offline → /offline/activity redirect lived on the route page; it is
	 * kept on the desktop activity route. The mobile pager does not auto-redirect
	 * (the offline reader remains reachable directly).
	 */
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import ActivityList from '$lib/components/organisms/ActivityList.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditorLazy.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { isLexicalEmpty, MAX_CONTENT_SIZE } from '$lib/utils/lexical';
	import type { ActivityListItem, UserInfoSummary } from '$lib/types/api';
	import type { MentionedUsersMap } from '$lib/types/mentions';
	import type { TranslationDict } from '$lib/types/translation';

	interface ActivityPanelProps {
		activities: ActivityListItem[];
		currentPage: number;
		totalPages: number;
		activityDraft: string | null;
		mentionedUsers: MentionedUsersMap;
		t: TranslationDict;
		user: UserInfoSummary | null;
		/** Show the paginator. Desktop always; mobile pager only on the active panel. */
		paginate?: boolean;
	}

	let {
		activities,
		currentPage,
		totalPages,
		activityDraft,
		mentionedUsers,
		t,
		user,
		paginate = true
	}: ActivityPanelProps = $props();

	const online = getOnlineStore();

	let editorContent = $state('');
	let submitting = $state(false);
	let editorKey = $state(0);

	$effect(() => {
		if (activityDraft) {
			editorContent = activityDraft;
		}
	});

	function handlePageChange(newPage: number) {
		goto(`?page=${newPage}`);
	}

	function handleEditorChange(json: string) {
		editorContent = json;
	}

	async function submitActivity() {
		if (!online.online) return;
		if (isLexicalEmpty(editorContent) || editorContent.length > MAX_CONTENT_SIZE || submitting)
			return;
		submitting = true;
		try {
			const res = await fetch('/api/activities', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ contentJson: editorContent })
			});
			if (res.ok) {
				editorContent = '';
				editorKey++;
				await invalidateAll();
			} else if (res.status === 429) {
				alert(t.common.tooManyRequests);
			} else {
				alert(t.common.error);
			}
		} catch {
			// Silently fail
		}
		submitting = false;
	}
</script>

<div class="space-y-3">
	<!-- Activity Composer -->
	{#if user}
		<div class="space-y-3">
			{#key editorKey}
				<LexicalEditor
					initialContent={editorKey === 0 ? activityDraft : null}
					placeholder={t.editor.placeholderActivity}
					contextType="activity"
					contextId={0}
					{t}
					disableHeadings={true}
					onContentChange={handleEditorChange}
					onSubmit={submitActivity}
				/>
			{/key}
			<div class="mt-3 flex justify-end">
				<button
					class="btn btn-primary btn-sm"
					onclick={submitActivity}
					disabled={submitting ||
						isLexicalEmpty(editorContent) ||
						editorContent.length > MAX_CONTENT_SIZE ||
						!online.online}
				>
					{submitting ? t.common.saving : t.common.submit}
				</button>
			</div>
		</div>
	{/if}

	<!-- Title Banner -->
	<div class="flex items-center justify-between border-b border-base-300 pb-4">
		<h1 class="page-title">{t.nav.activity}</h1>
		{#if paginate && totalPages > 1}
			<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
		{/if}
	</div>

	<!-- Activities Stream -->
	{#if !online.online || activities.length === 0}
		<EmptyState
			message={!online.online ? t.offline.disabled.title : t.common.noResults}
			bordered={false}
		/>
	{:else}
		<div class="space-y-0">
			<ActivityList
				items={activities}
				currentUserId={user?.id}
				isAdmin={user?.groupSlug === 'admin'}
				{mentionedUsers}
				{t}
			/>
		</div>

		<!-- Bottom Paginator -->
		{#if paginate && totalPages > 1}
			<div class="flex justify-end pt-2">
				<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
			</div>
		{/if}
	{/if}
</div>
