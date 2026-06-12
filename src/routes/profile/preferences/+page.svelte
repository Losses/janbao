<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
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
	let privateMessage = $state(prefs.privateMessage);
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
	let isDrawerOpen = $state(false);

	const userSlug = $derived(generateSlug(user?.username || ''));

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
					privateMessage,
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
	<div class="card bg-base-200 border border-base-300 p-4 space-y-4">
		{#if user}
			<UserInfoBlock {user} {t} />
			<div class="divider my-1"></div>
			<ul class="menu menu-sm w-full gap-1">
				<li><a href="/profile/{user.id}/{userSlug}">{profileT.dynamics}</a></li>
				<li><a href="/notifications">{profileT.notifications}</a></li>
				<li><a href="/profile/invitations">{profileT.invitations}</a></li>
				<li><a href="/messages/inbox">{profileT.mailbox}</a></li>
				<li><a href="/profile/discussions/{user.id}/{userSlug}">{profileT.discussions}</a></li>
				<li><a href="/profile/comments/{user.id}/{userSlug}">{profileT.comments}</a></li>
				<li class="menu-title mt-2">{profileT.accountSettings}</li>
				<li><a href="/profile/edit">{profileT.editAccount}</a></li>
				<li><a href="/profile/password">{profileT.changePassword}</a></li>
				<li><a href="/profile/preferences" class="active">{profileT.preferences}</a></li>
				<li><a href="/profile/picture">{profileT.avatar}</a></li>
				<li><a href="/profile/OnlineNow">{profileT.stealthSettings}</a></li>
			</ul>
		{/if}
	</div>
{/snippet}

<DualColumnLayout {sidebar} bind:isDrawerOpen>
	<div class="space-y-6">
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

		<div class="card bg-base-100 border border-base-200 rounded-xl p-6 shadow-sm space-y-4">
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
				<label class="label cursor-pointer justify-start gap-3" for="pref-private-message">
					<input
						id="pref-private-message"
						type="checkbox"
						class="checkbox checkbox-sm checkbox-primary"
						bind:checked={privateMessage}
					/>
					<div>
						<span class="label-text font-medium">{profileT.prefPrivateMessage}</span>
						<p class="text-xs text-base-content/50">{profileT.prefPrivateMessageDesc}</p>
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
