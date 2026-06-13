<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import PrivateMessageWindow from '$lib/components/organisms/PrivateMessageWindow.svelte';
	import ParticipantAdder from '$lib/components/molecules/ParticipantAdder.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import type { UserSearchResult, ParticipantItem } from '$lib/types/api';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const messageT = $derived(t.message);
	const user = $derived(data.user);
	const conversation = $derived(data.conversation);
	const participants = $derived(data.participants as ParticipantItem[]);
	const totalPages = $derived(data.totalPages);
	const currentPage = $derived(data.page);

	const participantIds = $derived(participants.map((p) => p.userId));
	let pendingParticipant = $state<UserSearchResult | null>(null);
	let addError = $state<string | null>(null);

	function onPick(u: UserSearchResult) {
		pendingParticipant = u;
	}

	function handlePageChange(newPage: number) {
		goto(`/messages/${conversation.id}/p${newPage}`);
	}
</script>

<svelte:head>
	<title>{formatTitle(conversation.title)}</title>
</svelte:head>

{#snippet sidebar()}
	<div class="space-y-4">
		<div>
			<h3 class="text-sm font-semibold text-base-content/70 mb-2">{messageT.participants}</h3>
			<div class="space-y-2">
				{#each participants as p (p.userId)}
					<a
						href="/profile/{p.userId}/{generateSlug(p.username)}"
						class="flex items-center gap-2 hover:text-primary transition-colors"
					>
						<Avatar
							src={p.avatarFileId ? `/img/${p.avatarFileId}` : null}
							displayName={p.displayName}
							size="xs"
						/>
						<span class="text-sm truncate">{p.displayName}</span>
					</a>
				{/each}
			</div>
		</div>

		<div>
			<h3 class="text-sm font-semibold text-base-content/70 mb-2">{messageT.addParticipant}</h3>
			{#if addError}
				<p class="text-xs text-warning mb-1">{addError}</p>
			{/if}
			<form
				method="POST"
				action="?/addParticipant"
				use:enhance={() => {
					addError = null;
					return async ({ result, update }) => {
						if (result.type === 'success') {
							pendingParticipant = null;
							update();
						} else if (result.type === 'failure') {
							addError = (result.data as { error?: string } | null)?.error ?? t.common.error;
							update();
						}
					};
				}}
				class="space-y-2"
			>
				<ParticipantAdder
					placeholder={messageT.addParticipantPlaceholder}
					excludeIds={participantIds}
					onSelect={onPick}
				/>
				<input type="hidden" name="userId" value={pendingParticipant?.id ?? ''} />
				<button type="submit" class="btn btn-primary btn-sm w-full" disabled={!pendingParticipant}>
					{messageT.addParticipant}
				</button>
			</form>
		</div>
	</div>
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-6">
		<div class="flex items-center justify-between border-b border-base-300 pb-4">
			<h1 class="text-2xl font-bold truncate">{conversation.title}</h1>
		</div>

		{#if totalPages > 1}
			<div class="flex justify-end">
				<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
			</div>
		{/if}

		<PrivateMessageWindow
			messages={data.messages}
			conversationId={conversation.id}
			currentUserId={user?.id ?? null}
			messageDraft={data.messageDraft}
			mentionedUsers={data.mentionedUsers}
			{t}
		/>

		{#if totalPages > 1}
			<div class="flex justify-end pt-2">
				<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
			</div>
		{/if}
	</div>
</DualColumnLayout>
