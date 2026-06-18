<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import PrivateMessageWindow from '$lib/components/organisms/PrivateMessageWindow.svelte';
	import ParticipantAdder from '$lib/components/molecules/ParticipantAdder.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { goto, invalidate } from '$app/navigation';
	import { enhance } from '$app/forms';
	import type { UserSearchResult, ParticipantItem } from '$lib/types/api';
	import type { PageData } from './$types';
	import { getOnlineStore } from '$lib/stores/online.svelte';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const online = getOnlineStore();

	const t = $derived(data.t);
	const messageT = $derived(t.message);
	const user = $derived(data.user);
	const conversation = $derived(data.conversation);
	const participants = $derived(data.participants as ParticipantItem[]);
	const totalPages = $derived(data.totalPages);
	const currentPage = $derived(data.page);

	const participantIds = $derived(participants.map((p) => p.userId));
	let pendingParticipants = $state<UserSearchResult[]>([]);
	let addError = $state<string | null>(null);

	function onPick(u: UserSearchResult) {
		if (!pendingParticipants.some((p) => p.id === u.id)) {
			pendingParticipants = [...pendingParticipants, u];
		}
	}

	function handlePageChange(newPage: number) {
		goto(`/messages/${conversation.id}/p${newPage}`);
	}

	// Entering a conversation marks it read server-side (see +page.server.ts
	// step 6). The root layout load reads no params, so it is not re-run on
	// plain client-side navigation and the sidebar unread badge would stay
	// stale until a full reload. Invalidate the badges dependency so the
	// layout re-fetches the true count whenever the open conversation changes
	// (the component is reused across conversations, so onMount would only
	// fire once).
	$effect(() => {
		void conversation.id; // track cross-conversation navigation
		void invalidate('app:badges');
	});
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
							userId={p.userId}
							avatarFileId={p.avatarFileId}
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
							pendingParticipants = [];
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
					excludeIds={[...participantIds, ...pendingParticipants.map((p) => p.id)]}
					onSelect={onPick}
				/>
				{#if pendingParticipants.length > 0}
					<div class="mt-1 flex flex-wrap gap-1">
						{#each pendingParticipants as p (p.id)}
							<span
								class="inline-flex items-center gap-1.5 rounded bg-primary/15 pl-1 pr-1.5 py-0.5 text-xs font-medium text-primary"
							>
								<Avatar
									userId={p.id}
									avatarFileId={p.avatarFileId}
									displayName={p.displayName}
									size="xs"
								/>
								<span class="truncate max-w-[120px]">{p.displayName}</span>
								<button
									type="button"
									class="-mr-0.5 leading-none hover:opacity-70 font-bold"
									aria-label="{messageT.removeRecipient} {p.displayName}"
									onclick={() =>
										(pendingParticipants = pendingParticipants.filter((item) => item.id !== p.id))}
								>
									×
								</button>
							</span>
						{/each}
					</div>
				{/if}
				{#each pendingParticipants as p (p.id)}
					<input type="hidden" name="userId" value={p.id} />
				{/each}
				<button
					type="submit"
					class="btn btn-primary btn-sm w-full"
					disabled={pendingParticipants.length === 0 || !online.online}
				>
					{messageT.addParticipant}
				</button>
			</form>
		</div>
	</div>
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-3">
		<div class="flex items-center justify-between border-b border-base-300 pb-4">
			<h1 class="page-title truncate">{conversation.title}</h1>
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
