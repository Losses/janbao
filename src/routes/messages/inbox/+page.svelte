<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ProfileSidebar from '$lib/components/molecules/ProfileSidebar.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
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
	<div class="space-y-3">
		<div class="flex items-center justify-between border-b border-base-300 pb-4">
			<h1 class="text-2xl font-bold">{messageT.inbox}</h1>
			<a href="/messages/new" class="btn btn-primary btn-sm">{messageT.newMessage}</a>
		</div>

		{#if conversations.length === 0}
			<div class="card bg-base-200/40 border border-base-300 p-10 text-center text-base-content/50">
				{messageT.noConversations}
			</div>
		{:else}
			<!-- Conversation stream  - mirrors the homepage discussion list:
			avatar left, content right, divide-y rows, no card chrome. -->
			<div class="bg-base-100 overflow-hidden">
				<div class="divide-y divide-base-300">
					{#each conversations as conv (conv.id)}
						{@const authorSlug = generateSlug(conv.lastAuthorUsername || 'user')}
						{@const authorHref =
							conv.lastAuthorId !== null ? `/profile/${conv.lastAuthorId}/${authorSlug}` : null}
						<div class="flex items-start gap-4 py-4 transition-all hover:bg-base-200/20">
							<!-- Left: last author avatar → profile -->
							<div class="flex-shrink-0">
								{#if authorHref}
									<a href={authorHref}>
										<Avatar
											userId={conv.lastAuthorId}
											avatarFileId={conv.lastAuthorAvatarFileId}
											displayName={conv.lastAuthorDisplayName}
											size="md"
										/>
									</a>
								{:else}
									<Avatar displayName="?" size="md" />
								{/if}
							</div>

							<!-- Right: username, title, meta -->
							<div class="flex-1 min-w-0">
								{#if authorHref}
									<a
										href={authorHref}
										class="inline-block text-sm font-medium text-base-content/85 hover:text-primary hover:underline"
									>
										{conv.lastAuthorUsername}
									</a>
								{/if}

								<div class="flex items-center gap-2 flex-wrap">
									<a
										href="/messages/{conv.id}"
										class="font-semibold text-lg hover:text-primary transition-colors hover:underline text-base-content break-words leading-snug"
									>
										{conv.title}
										{#if conv.unreadCount > 0}
											<Badge
												variant="primary"
												class="font-bold ml-1.5 align-middle -translate-y-[2px] no-underline"
												>{conv.unreadCount}</Badge
											>
										{/if}
									</a>
								</div>

								{#if conv.lastMessagePreview}
									<a
										href="/messages/{conv.id}"
										class="block text-sm text-base-content/60 hover:text-primary line-clamp-3 break-words mt-1"
									>
										{conv.lastMessagePreview}
									</a>
								{/if}

								<div class="flex items-center gap-2 text-xs text-base-content/60 flex-wrap mt-1">
									<span>{conv.messageCount} {messageT.messages}</span>
									<span class="text-base-content/30">•</span>
									{#if conv.lastMessageAt}
										<DateComponent value={conv.lastMessageAt} {t} />
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>

			{#if data.totalPages > 1}
				<div class="flex justify-end pt-2">
					<Paginator
						currentPage={data.page}
						totalPages={data.totalPages}
						onPageChange={handlePageChange}
						{t}
					/>
				</div>
			{/if}
		{/if}
	</div>
</DualColumnLayout>
