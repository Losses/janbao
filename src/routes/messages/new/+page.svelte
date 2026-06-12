<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ActiveUsersWall from '$lib/components/molecules/ActiveUsersWall.svelte';
	import ParticipantAdder from '$lib/components/molecules/ParticipantAdder.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditor.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiClose } from '@mdi/js';
	import { formatTitle } from '$lib/utils/title';
	import { goto } from '$app/navigation';
	import type { UserSearchResult, ApiResult } from '$lib/types/api';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const messageT = $derived(t.message);

	// svelte-ignore state_referenced_locally
	let recipients = $state<UserSearchResult[]>(data.prefillRecipient ? [data.prefillRecipient] : []);
	let title = $state('');
	let content = $state('');
	let sending = $state(false);
	let errorMessage = $state<string | null>(null);
	let isDrawerOpen = $state(false);

	const selectedIds = $derived(recipients.map((r) => r.id));

	function addRecipient(user: UserSearchResult) {
		if (recipients.some((r) => r.id === user.id)) return;
		recipients = [...recipients, user];
	}

	function removeRecipient(id: string) {
		recipients = recipients.filter((r) => r.id !== id);
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
	<div class="card bg-base-200 border border-base-300 p-4 space-y-4">
		<a href="/messages/inbox" class="btn btn-outline btn-sm w-full">
			{messageT.inbox}
		</a>
		<div class="divider my-1"></div>
		<ActiveUsersWall {t} />
	</div>
{/snippet}

<DualColumnLayout {sidebar} bind:isDrawerOpen>
	<div class="space-y-6">
		<h1 class="text-2xl font-bold border-b border-base-300 pb-4">{messageT.composeTitle}</h1>

		{#if errorMessage}
			<div class="alert alert-warning" role="alert">{errorMessage}</div>
		{/if}

		<div class="card bg-base-100 border border-base-200 rounded-xl p-5 shadow-sm space-y-4">
			<!-- Recipients -->
			<div class="form-control">
				<label class="label" for="recipients-input">
					<span class="label-text font-medium">{messageT.recipients}</span>
				</label>
				{#if recipients.length > 0}
					<div class="flex flex-wrap gap-2 mb-2">
						{#each recipients as r (r.id)}
							<div class="flex items-center gap-1.5 badge badge-lg badge-primary">
								<Avatar
									src={r.avatarFileId ? `/img/${r.avatarFileId}` : null}
									displayName={r.displayName}
									size="xs"
								/>
								<span class="text-xs">{r.displayName}</span>
								<button
									type="button"
									class="ml-0.5 text-primary-content/80 hover:text-primary-content"
									onclick={() => removeRecipient(r.id)}
									aria-label="{messageT.removeRecipient} {r.displayName}"
								>
									<Icon path={mdiClose} size={0.8} />
								</button>
							</div>
						{/each}
					</div>
				{/if}
				<div id="recipients-input">
					<ParticipantAdder
						placeholder={messageT.recipientPlaceholder}
						excludeIds={selectedIds}
						onSelect={addRecipient}
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
