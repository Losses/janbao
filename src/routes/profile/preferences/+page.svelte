<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import SettingsSidebar from '$lib/components/molecules/SettingsSidebar.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { ApiResult, FeedbackMessage } from '$lib/types/api';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const profileT = $derived(t.profile);
	const user = $derived(data.user);
	const prefs = $derived(data.preferences);

	// svelte-ignore state_referenced_locally
	let profileComment = $state(prefs.profileComment);
	// svelte-ignore state_referenced_locally
	let discussionReply = $state(prefs.discussionReply);
	// svelte-ignore state_referenced_locally
	let discussionComment = $state(prefs.discussionComment);
	// svelte-ignore state_referenced_locally
	let participatedComment = $state(prefs.participatedComment);
	// svelte-ignore state_referenced_locally
	let mention = $state(prefs.mention);
	// svelte-ignore state_referenced_locally
	let bookmarkedDiscussionComment = $state(prefs.bookmarkedDiscussionComment);
	let saving = $state(false);
	let message = $state<FeedbackMessage | null>(null);

	async function handleSave() {
		saving = true;
		message = null;

		try {
			const res = await fetch('/api/profile/preferences', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					profileComment,
					discussionReply,
					discussionComment,
					participatedComment,
					mention,
					bookmarkedDiscussionComment
				})
			});

			const result: ApiResult = await res.json();
			if (result.success) {
				message = { type: 'success', text: t.common.success };
			} else {
				message = { type: 'error', text: result.error || t.common.error };
			}
		} catch {
			message = { type: 'error', text: t.auth.networkError };
		}

		saving = false;
	}
</script>

<svelte:head>
	<title>{formatTitle(profileT.preferences)}</title>
</svelte:head>

{#snippet sidebar()}
	{#if user}
		<SettingsSidebar {user} {t} activeItem="preferences" />
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-3">
		<h1 class="text-2xl font-bold border-b border-base-300 pb-4">
			{profileT.preferences}
		</h1>

		{#if message}
			<div
				class="alert {message.type === 'success' ? 'alert-primary' : 'alert-warning'}"
				role="alert"
			>
				{message.text}
			</div>
		{/if}

		<div class="space-y-4">
			<p class="text-sm text-base-content/70 mb-2">
				{profileT.preferencesDescription}
			</p>

			<div class="form-control">
				<label class="label cursor-pointer justify-start gap-3" for="pref-profile-comment">
					<input
						id="pref-profile-comment"
						type="checkbox"
						class="checkbox checkbox-sm checkbox-primary"
						bind:checked={profileComment}
					/>
					<div>
						<span class="label-text font-medium">{profileT.prefProfileComment}</span>
						<p class="text-xs text-base-content/50">{profileT.prefProfileCommentDesc}</p>
					</div>
				</label>
			</div>

			<div class="form-control">
				<label class="label cursor-pointer justify-start gap-3" for="pref-discussion-reply">
					<input
						id="pref-discussion-reply"
						type="checkbox"
						class="checkbox checkbox-sm checkbox-primary"
						bind:checked={discussionReply}
					/>
					<div>
						<span class="label-text font-medium">{profileT.prefDiscussionReply}</span>
						<p class="text-xs text-base-content/50">{profileT.prefDiscussionReplyDesc}</p>
					</div>
				</label>
			</div>

			<div class="form-control">
				<label class="label cursor-pointer justify-start gap-3" for="pref-discussion-comment">
					<input
						id="pref-discussion-comment"
						type="checkbox"
						class="checkbox checkbox-sm checkbox-primary"
						bind:checked={discussionComment}
					/>
					<div>
						<span class="label-text font-medium">{profileT.prefDiscussionComment}</span>
						<p class="text-xs text-base-content/50">{profileT.prefDiscussionCommentDesc}</p>
					</div>
				</label>
			</div>

			<div class="form-control">
				<label class="label cursor-pointer justify-start gap-3" for="pref-participated">
					<input
						id="pref-participated"
						type="checkbox"
						class="checkbox checkbox-sm checkbox-primary"
						bind:checked={participatedComment}
					/>
					<div>
						<span class="label-text font-medium">{profileT.prefParticipated}</span>
						<p class="text-xs text-base-content/50">{profileT.prefParticipatedDesc}</p>
					</div>
				</label>
			</div>

			<div class="form-control">
				<label class="label cursor-pointer justify-start gap-3" for="pref-mention">
					<input
						id="pref-mention"
						type="checkbox"
						class="checkbox checkbox-sm checkbox-primary"
						bind:checked={mention}
					/>
					<div>
						<span class="label-text font-medium">{profileT.prefMention}</span>
						<p class="text-xs text-base-content/50">{profileT.prefMentionDesc}</p>
					</div>
				</label>
			</div>

			<div class="form-control">
				<label class="label cursor-pointer justify-start gap-3" for="pref-bookmarked">
					<input
						id="pref-bookmarked"
						type="checkbox"
						class="checkbox checkbox-sm checkbox-primary"
						bind:checked={bookmarkedDiscussionComment}
					/>
					<div>
						<span class="label-text font-medium">{profileT.prefBookmarked}</span>
						<p class="text-xs text-base-content/50">{profileT.prefBookmarkedDesc}</p>
					</div>
				</label>
			</div>

			<div class="pt-2">
				<button class="btn btn-primary" onclick={handleSave} disabled={saving}>
					{saving ? t.common.saving : t.common.submit}
				</button>
			</div>
		</div>
	</div>
</DualColumnLayout>
