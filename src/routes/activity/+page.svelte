<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import ActivityRow from '$lib/components/organisms/ActivityRow.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditor.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data } = $props<{ data: PageData }>();

	const t = $derived(data.t);
	const user = $derived(data.user);
	const activityList = $derived(data.activities);
	const currentPage = $derived(data.page);
	const totalPages = $derived(data.totalPages);

	let isDrawerOpen = $state(false);
	let editorContent = $state('');
	let submitting = $state(false);

	function handlePageChange(newPage: number) {
		goto(`?page=${newPage}`);
	}

	function handleEditorChange(json: string) {
		editorContent = json;
	}

	async function submitActivity() {
		if (!editorContent.trim()) return;
		submitting = true;
		try {
			const res = await fetch('/api/activities', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ contentJson: editorContent })
			});
			if (res.ok) {
				editorContent = '';
				goto(window.location.pathname);
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

{#snippet sidebar()}
	<div class="card bg-base-200 border border-base-300 p-4 space-y-4">
		{#if user}
			<UserInfoBlock {user} {t} />
			<div class="divider my-1"></div>
			<div class="flex flex-col gap-2">
				<a href="/post/discussion" class="btn btn-primary btn-sm w-full">
					{t.sidebar.createDiscussion}
				</a>
				<a
					href="/profile/discussions/{user.id}/{generateSlug(user.username)}"
					class="btn btn-outline btn-sm w-full"
				>
					{t.sidebar.myDiscussions}
				</a>
			</div>
		{:else}
			<div class="space-y-2">
				<h3 class="font-semibold text-sm text-base-content/70">{t.home.welcomeTo}</h3>
				<div class="flex gap-2">
					<a href="/entry/signin" class="btn btn-sm btn-primary flex-1">{t.nav.signin}</a>
					<a href="/entry/register" class="btn btn-sm btn-outline flex-1">{t.nav.register}</a>
				</div>
			</div>
		{/if}
	</div>
{/snippet}

<DualColumnLayout {sidebar} bind:isDrawerOpen>
	<div class="space-y-6">
		<!-- Activity Composer -->
		{#if user}
			<div class="card bg-base-100 border border-base-200 rounded-xl p-4 shadow-sm">
				<LexicalEditor
					initialContent={data.activityDraft}
					placeholder={t.editor.placeholderActivity}
					contextType="activity"
					contextId="new"
					{t}
					disableHeadings={true}
					onContentChange={handleEditorChange}
				/>
				<div class="flex justify-end mt-3">
					<button
						class="btn btn-primary btn-sm"
						onclick={submitActivity}
						disabled={submitting || !editorContent.trim()}
					>
						{submitting ? t.common.saving : t.common.submit}
					</button>
				</div>
			</div>
		{/if}

		<!-- Title Banner -->
		<div class="flex items-center justify-between border-b border-base-300 pb-4">
			<h1 class="text-3xl font-extrabold tracking-tight">{t.nav.activity}</h1>
			<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
		</div>

		<!-- Activities Stream -->
		{#if activityList.length === 0}
			<div
				class="card bg-base-200/40 border border-base-200 p-10 text-center text-base-content/50 rounded-xl"
			>
				{t.common.noResults}
			</div>
		{:else}
			<div
				class="card bg-base-100 border border-base-200 rounded-xl overflow-hidden shadow-sm px-4"
			>
				{#each activityList as activity (activity.id)}
					<ActivityRow
						id={activity.id}
						authorId={activity.authorId}
						authorDisplayName={activity.authorDisplayName}
						authorUsername={activity.authorUsername}
						authorAvatarFileId={activity.authorAvatarFileId}
						recipientId={activity.recipientId}
						recipientDisplayName={activity.recipientDisplayName}
						recipientUsername={activity.recipientUsername}
						contentJson={activity.contentJson}
						createdAt={activity.createdAt}
						commentCount={activity.commentCount}
						currentUserId={user?.id}
						isAdmin={user?.groupSlug === 'admin'}
						{t}
					/>
				{/each}
			</div>

			<!-- Bottom Paginator -->
			<div class="flex justify-end pt-2">
				<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
			</div>
		{/if}
	</div>
</DualColumnLayout>
