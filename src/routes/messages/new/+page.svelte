<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import MentionChipInput from '$lib/components/organisms/MentionChipInput.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditor.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { goto } from '$app/navigation';
	import type { UserSearchResult, ApiResult } from '$lib/types/api';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const messageT = $derived(t.message);
	const user = $derived(data.user);
	const userSlug = $derived(generateSlug(user?.username || ''));

	let recipients = $state<UserSearchResult[]>(data.prefillRecipient ? [data.prefillRecipient] : []);
	let title = $state('');
	let content = $state('');
	let sending = $state(false);
	let errorMessage = $state<string | null>(null);

	const selectedIds = $derived(recipients.map((r) => r.id));

	function handleRecipientsChange(users: UserSearchResult[]) {
		recipients = users;
	}

	async function send() {
		if (recipients.length === 0 || !title.trim() || !content.trim()) return;
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
			const result: ApiResult & { conversationId?: string } = await res.json();
			if (result.success && result.conversationId) {
				goto(`/messages/${result.conversationId}`);
				return;
			}
			errorMessage = result.error || t.common.error;
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
	<div class="space-y-6">
		<h1 class="text-2xl font-bold border-b border-base-300 pb-4">{messageT.composeTitle}</h1>

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
						placeholder={messageT.recipientPlaceholder}
						excludeIds={selectedIds}
						initialRecipients={data.prefillRecipient ? [data.prefillRecipient] : undefined}
						onRecipientsChange={handleRecipientsChange}
						disabled={sending}
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
					disabled={sending}
				/>
			</div>

			<!-- Content -->
			<div class="form-control">
				<label class="label" for="content-editor">
					<span class="label-text font-medium">{messageT.content}</span>
				</label>
				<div id="content-editor">
					<LexicalEditor
						contextType="message"
						contextId="new"
						initialContent={data.messageDraft}
						placeholder={messageT.content}
						disableImageUpload={true}
						onContentChange={(json) => (content = json)}
						{t}
					/>
				</div>
			</div>

			<div class="flex justify-end">
				<button
					class="btn btn-primary"
					onclick={send}
					disabled={sending || recipients.length === 0 || !title.trim() || !content.trim()}
				>
					{#if sending}
						<span class="loading loading-spinner loading-xs"></span>
					{/if}
					{messageT.send}
				</button>
			</div>
		</div>
	</div>
</DualColumnLayout>
