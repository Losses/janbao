<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import ActivityRow from '$lib/components/organisms/ActivityRow.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditor.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { mdiAccountGroup, mdiCalendarClock, mdiClockOutline, mdiEyeOutline } from '@mdi/js';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const profileT = $derived(t.profile);
	const user = $derived(data.user);
	const targetUser = $derived(data.targetUser);
	const isOwner = $derived(data.isOwner);
	const activityList = $derived(data.activities);

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
	<ProfileSidebar
		{user}
		{t}
		activeItem="activities"
		targetUserId={targetUser.id}
		{targetUserSlug}
	/>
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-6">
		<!-- Profile Header -->
		<div class="card bg-base-100 p-6">
			<div class="flex items-center gap-4">
				<Avatar
					src={targetUser.avatarFileId ? `/img/${targetUser.avatarFileId}` : null}
					displayName={targetUser.displayName}
					size="lg"
				/>
				<div>
					<h1 class="text-2xl font-bold text-base-content">{targetUser.displayName}</h1>
				</div>
			</div>

			<!-- User Statistics -->
			<div class="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-sm text-base-content/70">
				<div class="flex items-center gap-1.5">
					<Icon path={mdiAccountGroup} size={16} class="text-base-content/50" />
					<span class="font-medium text-base-content">{profileT.group}</span>
					<span>{targetUser.groupSlug}</span>
				</div>
				<div class="flex items-center gap-1.5">
					<Icon path={mdiCalendarClock} size={16} class="text-base-content/50" />
					<span class="font-medium text-base-content">{profileT.joined}</span>
					<span>
						<DateComponent value={targetUser.signupTime} {t} />
					</span>
				</div>
				<div class="flex items-center gap-1.5">
					<Icon path={mdiClockOutline} size={16} class="text-base-content/50" />
					<span class="font-medium text-base-content">{profileT.lastActive}</span>
					<span>
						<DateComponent value={targetUser.lastActiveTime} {t} />
					</span>
				</div>
				<div class="flex items-center gap-1.5">
					<Icon path={mdiEyeOutline} size={16} class="text-base-content/50" />
					<span class="font-medium text-base-content">{profileT.views}</span>
					<span>{targetUser.viewCount}</span>
				</div>
			</div>
		</div>

		<!-- Directed Activity Composer (if logged in and not own profile) -->
		{#if user && !isOwner}
			<div class="card bg-base-100 p-4">
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
			<div class="card bg-base-200/40 p-10 text-center text-base-content/50">
				{t.common.noResults}
			</div>
		{:else}
			<div class="card bg-base-100 overflow-hidden px-4">
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
						commentCount={activity.commentCount}
						recipientDisplayName={activity.recipientDisplayName}
						recipientUsername={activity.recipientUsername}
						currentUserId={user?.id}
						isAdmin={user?.groupSlug === 'admin'}
						{t}
						mentionedUsers={data.mentionedUsers}
					/>
				{/each}
			</div>
		{/if}
	</div>
</DualColumnLayout>
