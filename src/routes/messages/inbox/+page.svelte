<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import Badge from '$lib/components/atoms/Badge.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { goto } from '$app/navigation';
	import type { ConversationListItem } from '$lib/types/api';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const messageT = $derived(t.message);
	const user = $derived(data.user);
	const conversations = $derived(data.conversations as ConversationListItem[]);
	const userSlug = $derived(generateSlug(user?.username || ''));

	function handlePageChange(newPage: number) {
		goto(`?page=${newPage}`);
	}
</script>

<svelte:head>
	<title>{formatTitle(messageT.inbox)}</title>
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
		<div class="flex items-center justify-between border-b border-base-300 pb-4">
			<h1 class="text-2xl font-bold">{messageT.inbox}</h1>
			<a href="/messages/new" class="btn btn-primary btn-sm">{messageT.newMessage}</a>
		</div>

		{#if conversations.length === 0}
			<div
				class="card bg-base-200/40 border border-base-200 p-10 text-center text-base-content/50 rounded-xl"
			>
				{messageT.noConversations}
			</div>
		{:else}
			<div class="card bg-base-100 border border-base-200 rounded-xl shadow-sm overflow-hidden">
				{#each conversations as conv (conv.id)}
					<a
						href="/messages/{conv.id}"
						class="flex items-center gap-3 p-4 border-b border-base-200 last:border-b-0 hover:bg-base-200/40 transition-colors {conv.unreadCount >
						0
							? ''
							: 'opacity-70'}"
					>
						<div class="min-w-0 flex-1">
							<div class="flex items-center justify-between gap-2">
								<h3 class="font-semibold text-base-content truncate">{conv.title}</h3>
								{#if conv.lastMessageAt}
									<DateComponent
										value={conv.lastMessageAt}
										{t}
										class="text-xs text-base-content/40 flex-shrink-0"
									/>
								{/if}
							</div>
							{#if conv.lastMessagePreview}
								<p class="text-sm text-base-content/60 truncate mt-0.5">
									{#if conv.lastAuthorDisplayName}
										<span class="font-medium">{conv.lastAuthorDisplayName}: </span>
									{/if}
									{conv.lastMessagePreview}
								</p>
							{/if}
						</div>
						{#if conv.unreadCount > 0}
							<Badge variant="primary">{conv.unreadCount}</Badge>
						{/if}
					</a>
				{/each}
			</div>

			<div class="flex justify-end pt-2">
				<Paginator
					currentPage={data.page}
					totalPages={data.totalPages}
					onPageChange={handlePageChange}
					{t}
				/>
			</div>
		{/if}
	</div>
</DualColumnLayout>
