<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import ActivityList from '$lib/components/organisms/ActivityList.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditorLazy.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { isLexicalEmpty, MAX_CONTENT_SIZE } from '$lib/utils/lexical';
	import { goto, invalidateAll } from '$app/navigation';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import type { PageData } from './$types';

	const online = getOnlineStore();

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const user = $derived(data.user);
	const activityList = $derived(data.activities);
	const currentPage = $derived(data.page);
	const totalPages = $derived(data.totalPages);

	let editorContent = $state('');
	let submitting = $state(false);
	let editorKey = $state(0);

	$effect(() => {
		if (data.activityDraft) {
			editorContent = data.activityDraft;
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

<svelte:head>
	<title>{formatTitle(t.nav.activity)}</title>
</svelte:head>

<DualColumnLayout {user} {t}>
	{#snippet sidebar()}
		{#if user}
			<div>
				<UserInfoBlock {user} {t} />
			</div>
		{/if}
	{/snippet}

	<div class="space-y-3">
		<!-- Activity Composer -->
		{#if user}
			<div class="space-y-3">
				{#key editorKey}
					<LexicalEditor
						initialContent={editorKey === 0 ? data.activityDraft : null}
						placeholder={t.editor.placeholderActivity}
						contextType="activity"
						contextId={0}
						{t}
						disableHeadings={true}
						onContentChange={handleEditorChange}
						onSubmit={submitActivity}
					/>
				{/key}
				<div class="flex justify-end mt-3">
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
			{#if totalPages > 1}
				<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
			{/if}
		</div>

		<!-- Activities Stream -->
		{#if !online.online || activityList.length === 0}
			<EmptyState
				message={!online.online ? t.offline.disabled.title : t.common.noResults}
				bordered={false}
			/>
		{:else}
			<div class="space-y-0">
				<ActivityList
					items={activityList}
					currentUserId={user?.id}
					isAdmin={user?.groupSlug === 'admin'}
					mentionedUsers={data.mentionedUsers}
					{t}
				/>
			</div>

			<!-- Bottom Paginator -->
			{#if totalPages > 1}
				<div class="flex justify-end pt-2">
					<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
				</div>
			{/if}
		{/if}
	</div>
</DualColumnLayout>
