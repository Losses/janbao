<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import ProfileHeader from '$lib/components/molecules/ProfileHeader.svelte';
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import ActivityList from '$lib/components/organisms/ActivityList.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditorLazy.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { mdiArrowRight } from '@mdi/js';
	import type { PageData } from './$types';
	import { getOnlineStore } from '$lib/stores/online.svelte';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const online = getOnlineStore();

	const t = $derived(data.t);
	const profileT = $derived(t.profile);
	const user = $derived(data.user);
	const targetUser = $derived(data.targetUser);
	const invitedBy = $derived(data.invitedBy);
	const isOwner = $derived(data.isOwner);
	const activityList = $derived(data.activities);
	const headerEmail = $derived(data.headerEmail);
	const showLastActive = $derived(!targetUser.isStealth || isOwner || user?.groupSlug === 'admin');

	let editorContent = $state('');
	let submitting = $state(false);

	const targetUserSlug = $derived(generateSlug(targetUser.username));

	function handleEditorChange(json: string) {
		editorContent = json;
	}

	async function submitDirectedActivity() {
		if (!online.online) return;
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
		<ProfileHeader {targetUser} {invitedBy} email={headerEmail} {showLastActive} {t} />

		<!-- Directed/Normal Activity Composer (if logged in) -->
		{#if user}
			<div>
				<p class="text-sm text-base-content/70 mb-2">
					{#if isOwner}
						{profileT.postNormalActivity}
					{:else}
						<span class="inline-flex items-center gap-1 flex-wrap">
							{profileT.postToProfile}
							<Icon path={mdiArrowRight} size={16} class="text-base-content/60" />
							{targetUser.displayName}
						</span>
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
					onSubmit={submitDirectedActivity}
				/>
				<div class="flex justify-end mt-3">
					<button
						class="btn btn-primary btn-sm"
						onclick={submitDirectedActivity}
						disabled={submitting || !editorContent.trim() || !online.online}
					>
						{submitting ? t.common.saving : t.common.submit}
					</button>
				</div>
			</div>
		{/if}

		<!-- Activities Stream -->
		{#if activityList.length === 0}
			<EmptyState message={t.common.noResults} bordered={false} />
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
