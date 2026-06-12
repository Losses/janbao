<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import ActivityRow from '$lib/components/organisms/ActivityRow.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditor.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import type { PageData } from './$types';

	let { data } = $props<{ data: PageData }>();

	const t = $derived(data.t);
	const profileT = $derived(t.profile);
	const user = $derived(data.user);
	const targetUser = $derived(data.targetUser);
	const isOwner = $derived(data.isOwner);
	const activityList = $derived(data.activities);

	let isDrawerOpen = $state(false);
	let editorContent = $state('');
	let submitting = $state(false);

	const targetUserSlug = $derived(generateSlug(targetUser.username));

	function handleEditorChange(json: string) {
		editorContent = json;
	}

	async function submitDirectedActivity() {
		if (!editorContent.trim()) return;
		submitting = true;
		try {
			const res = await fetch('/api/activities', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					contentJson: editorContent,
					recipientId: targetUser.id
				})
			});
			if (res.ok) {
				editorContent = '';
				window.location.reload();
			}
		} catch {
			// Silently fail
		}
		submitting = false;
	}
</script>

<svelte:head>
	<title>{formatTitle(targetUser.displayName)}</title>
</svelte:head>

{#snippet sidebar()}
	<div class="card bg-base-200 border border-base-300 p-4 space-y-4">
		{#if user}
			<UserInfoBlock {user} {t} />
			<div class="divider my-1"></div>
			{#if isOwner}
				<ul class="menu menu-sm w-full gap-1">
					<li><a href="/profile/{user.id}/{targetUserSlug}">{profileT.dynamics}</a></li>
					<li><a href="/notifications">{profileT.notifications}</a></li>
					<li><a href="/profile/invitations">{profileT.invitations}</a></li>
					<li><a href="/messages/inbox">{profileT.mailbox}</a></li>
					<li>
						<a href="/profile/discussions/{user.id}/{targetUserSlug}">{profileT.discussions}</a>
					</li>
					<li><a href="/profile/comments/{user.id}/{targetUserSlug}">{profileT.comments}</a></li>
					<li class="menu-title mt-2">{profileT.accountSettings}</li>
					<li><a href="/profile/edit">{profileT.editAccount}</a></li>
					<li><a href="/profile/password">{profileT.changePassword}</a></li>
					<li><a href="/profile/preferences">{profileT.preferences}</a></li>
					<li><a href="/profile/picture">{profileT.avatar}</a></li>
					<li><a href="/profile/OnlineNow">{profileT.stealthSettings}</a></li>
				</ul>
			{:else}
				<ul class="menu menu-sm w-full gap-1">
					<li><a href="/profile/{targetUser.id}/{targetUserSlug}">{profileT.dynamics}</a></li>
					<li>
						<a href="/profile/discussions/{targetUser.id}/{targetUserSlug}"
							>{profileT.discussions}</a
						>
					</li>
					<li>
						<a href="/profile/comments/{targetUser.id}/{targetUserSlug}">{profileT.comments}</a>
					</li>
				</ul>
			{/if}
		{:else}
			<ul class="menu menu-sm w-full gap-1">
				<li><a href="/profile/{targetUser.id}/{targetUserSlug}">{profileT.dynamics}</a></li>
				<li>
					<a href="/profile/discussions/{targetUser.id}/{targetUserSlug}">{profileT.discussions}</a>
				</li>
				<li>
					<a href="/profile/comments/{targetUser.id}/{targetUserSlug}">{profileT.comments}</a>
				</li>
			</ul>
			<div class="divider my-1"></div>
			<div class="flex gap-2">
				<a href="/entry/signin" class="btn btn-sm btn-primary flex-1">{t.nav.signin}</a>
				<a href="/entry/register" class="btn btn-sm btn-outline flex-1">{t.nav.register}</a>
			</div>
		{/if}
	</div>
{/snippet}

<DualColumnLayout {sidebar} bind:isDrawerOpen>
	<div class="space-y-6">
		<!-- Profile Header -->
		<div class="card bg-base-100 border border-base-200 rounded-xl p-6 shadow-sm">
			<div class="flex items-center gap-4">
				<Avatar
					src={targetUser.avatarFileId ? `/img/${targetUser.avatarFileId}` : null}
					displayName={targetUser.displayName}
					size="lg"
				/>
				<div>
					<h1 class="text-2xl font-bold text-base-content">{targetUser.displayName}</h1>
					<p class="text-sm text-base-content/60">@{targetUser.username}</p>
				</div>
			</div>

			<!-- User Statistics -->
			<div class="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-sm text-base-content/70">
				<div>
					<span class="font-medium text-base-content">{profileT.group}:</span>
					<span class="ml-1">{targetUser.groupSlug}</span>
				</div>
				<div>
					<span class="font-medium text-base-content">{profileT.joined}:</span>
					<span class="ml-1">
						<DateComponent value={targetUser.signupTime} {t} />
					</span>
				</div>
				<div>
					<span class="font-medium text-base-content">{profileT.lastActive}:</span>
					<span class="ml-1">
						<DateComponent value={targetUser.lastActiveTime} {t} />
					</span>
				</div>
				<div>
					<span class="font-medium text-base-content">{profileT.views}:</span>
					<span class="ml-1">{targetUser.viewCount}</span>
				</div>
			</div>
		</div>

		<!-- Directed Activity Composer (if logged in and not own profile) -->
		{#if user && !isOwner}
			<div class="card bg-base-100 border border-base-200 rounded-xl p-4 shadow-sm">
				<p class="text-sm text-base-content/70 mb-2">
					{profileT.postToProfile} → {targetUser.displayName}
				</p>
				<LexicalEditor
					initialContent={data.activityDraft}
					placeholder={t.editor.placeholderActivity}
					contextType="activity"
					contextId={targetUser.id}
					{t}
					disableHeadings={true}
					onContentChange={handleEditorChange}
				/>
				<div class="flex justify-end mt-3">
					<button
						class="btn btn-primary btn-sm"
						onclick={submitDirectedActivity}
						disabled={submitting || !editorContent.trim()}
					>
						{submitting ? t.common.saving : t.common.submit}
					</button>
				</div>
			</div>
		{/if}

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
						contentJson={activity.contentJson}
						createdAt={activity.createdAt}
						commentCount={0}
						currentUserId={user?.id}
						isAdmin={user?.groupSlug === 'admin'}
						{t}
					/>
				{/each}
			</div>
		{/if}
	</div>
</DualColumnLayout>
