<script lang="ts">
	/**
	 * MessageCompose Organism - The full compose-a-message experience: layout,
	 * sidebar, recipient picker, subject, editor, and send logic.
	 *
	 * Shared by `/messages/new` and `/messages/add/[userId]` so the two routes
	 * differ only in how they source the prefilled recipient (query param vs
	 * route param), resolved in their respective `+page.server.ts`.
	 */
	import { untrack } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import GesturePageLayout from '$lib/components/templates/GesturePageLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import MentionChipInput from '$lib/components/organisms/MentionChipInput.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditorLazy.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { isLexicalEmpty, MAX_CONTENT_SIZE } from '$lib/utils/lexical';
	import { goto } from '$app/navigation';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import type { UserSearchResult, ApiResult, UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface MessageComposeResult extends ApiResult {
		conversationId?: number;
	}

	interface MessageComposeProps {
		prefillRecipient: UserSearchResult | null;
		messageDraft: string | null;
		user: UserInfoSummary | null;
		t: TranslationDict;
	}

	let { prefillRecipient, messageDraft, user, t }: MessageComposeProps = $props();

	const online = getOnlineStore();

	const messageT = $derived(t.message);
	const userSlug = $derived(generateSlug(user?.username || ''));

	// Prefill only seeds recipients once on mount; untrack so later prop changes
	// (e.g. re-navigation) don't clobber the user's edited selection.
	let recipients = $state<UserSearchResult[]>(
		untrack(() => (prefillRecipient ? [prefillRecipient] : []))
	);
	let title = $state('');
	let content = $state('');
	let sending = $state(false);
	let errorMessage = $state<string | null>(null);

	$effect(() => {
		if (messageDraft) {
			content = messageDraft;
		}
	});

	const selectedIds = $derived(recipients.map((r) => r.id));

	function handleRecipientsChange(recipientUsers: UserSearchResult[]) {
		recipients = recipientUsers;
	}

	async function send() {
		if (!online.online) return;
		if (sending) return;
		if (
			recipients.length === 0 ||
			!title.trim() ||
			isLexicalEmpty(content) ||
			content.length > MAX_CONTENT_SIZE
		)
			return;
		sending = true;
		errorMessage = null;
		try {
			const res = await fetch('/api/messages', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					recipientIds: recipients.map((r) => r.id),
					title: title.trim(),
					contentJson: content
				})
			});
			const result: MessageComposeResult = await res.json();
			if (result.success && result.conversationId) {
				goto(`/messages/${result.conversationId}`);
				return;
			} else if (res.status === 429) {
				errorMessage = t.common.tooManyRequests;
			} else {
				errorMessage = result.error || t.common.error;
			}
		} catch {
			errorMessage = t.auth.networkError;
		}
		sending = false;
	}
</script>

<svelte:head>
	<title>{formatTitle(messageT.composeTitle)}</title>
</svelte:head>

{#snippet sidebar()}
	{#if user}
		<ProfileSidebar
			{user}
			{t}
			activeItem="mailbox"
			targetUserId={user.id}
			targetUserSlug={userSlug}
		/>
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<GesturePageLayout centerTab={2} leftHref="/messages/inbox">
		<div class="space-y-3">
			<h1 class="page-title border-b border-base-300 pb-4">{messageT.composeTitle}</h1>

			{#if errorMessage}
				<div class="alert alert-warning" role="alert">{errorMessage}</div>
			{/if}

			<div class="space-y-4">
				<!-- Recipients -->
				<div class="form-control">
					<label class="label" for="recipients-input">
						<span class="label-text font-medium">{messageT.recipients}</span>
					</label>
					<div id="recipients-input">
						<MentionChipInput
							excludeIds={selectedIds}
							initialRecipients={prefillRecipient ? [prefillRecipient] : undefined}
							onRecipientsChange={handleRecipientsChange}
							disabled={sending || !online.online}
							{t}
						/>
					</div>
				</div>

				<!-- Subject -->
				<div class="form-control">
					<label class="label" for="title-input">
						<span class="label-text font-medium">{messageT.title}</span>
					</label>
					<input
						id="title-input"
						type="text"
						class="input input-bordered w-full"
						bind:value={title}
						disabled={sending || !online.online}
					/>
				</div>

				<!-- Content -->
				<div class="form-control">
					<label class="label" for="content-editor">
						<span class="label-text font-medium">{messageT.content}</span>
					</label>
					<div id="content-editor">
						{#key messageDraft}
							<LexicalEditor
								contextType="message"
								contextId={0}
								initialContent={messageDraft}
								placeholder=""
								disableImageUpload={true}
								onContentChange={(json) => (content = json)}
								onSubmit={send}
								{t}
							/>
						{/key}
					</div>
				</div>

				<div class="flex justify-end">
					<button
						class="btn btn-primary"
						onclick={send}
						disabled={sending ||
							recipients.length === 0 ||
							!title.trim() ||
							isLexicalEmpty(content) ||
							content.length > MAX_CONTENT_SIZE ||
							!online.online}
					>
						{#if sending}
							<span class="loading loading-spinner loading-xs"></span>
						{/if}
						{messageT.send}
					</button>
				</div>
			</div>
		</div>
	</GesturePageLayout>
</DualColumnLayout>
