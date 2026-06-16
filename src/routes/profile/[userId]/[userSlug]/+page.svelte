<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import ActivityList from '$lib/components/organisms/ActivityList.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditor.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import {
		mdiAccountGroup,
		mdiCalendarClock,
		mdiClockOutline,
		mdiEyeOutline,
		mdiAccountPlusOutline
	} from '@mdi/js';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const profileT = $derived(t.profile);
	const user = $derived(data.user);
	const targetUser = $derived(data.targetUser);
	const invitedBy = $derived(data.invitedBy);
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
					recipientId: isOwner ? null : targetUser.id
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
		targetUserGroupSlug={targetUser.groupSlug}
		targetUserEmail={data.targetUserEmail}
		manageableGroups={data.manageableGroups}
	/>
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-3">
		<!-- Profile Header -->
		<div>
			<div class="flex items-center gap-4">
				<Avatar
					userId={targetUser.id}
					avatarFileId={targetUser.avatarFileId}
					displayName={targetUser.displayName}
					size="lg"
				/>
				<div>
					<h1 class="user-display-name page-title">
						{targetUser.displayName}
					</h1>
					{#if targetUser.bio}
						<p class="text-base-content/70 mt-1 whitespace-pre-line">{targetUser.bio}</p>
					{/if}
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
				{#if invitedBy}
					<div class="flex items-center gap-1.5">
						<Icon path={mdiAccountPlusOutline} size={16} class="text-base-content/50" />
						<span class="font-medium text-base-content">{profileT.invitedBy}</span>
						<a
							href="/profile/{invitedBy.id}/{generateSlug(invitedBy.username)}"
							class="hover:underline">{invitedBy.displayName}</a
						>
					</div>
				{/if}
			</div>
		</div>

		<!-- Directed/Normal Activity Composer (if logged in) -->
		{#if user}
			<div>
				<p class="text-sm text-base-content/70 mb-2">
					{#if isOwner}
						{profileT.postNormalActivity}
					{:else}
						{profileT.postToProfile} → {targetUser.displayName}
					{/if}
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
			<div class="overflow-hidden">
				<ActivityList
					items={activityList}
					currentUserId={user?.id}
					isAdmin={user?.groupSlug === 'admin'}
					mentionedUsers={data.mentionedUsers}
					{t}
				/>
			</div>
		{/if}
	</div>
</DualColumnLayout>
