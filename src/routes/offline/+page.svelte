<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateAtom from '$lib/components/atoms/Date.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import type { PageProps } from './$types';
	import type { OfflineDiscussionView } from '$lib/offline/types';

	let { data }: PageProps = $props();

	function displayName(d: OfflineDiscussionView): string {
		return d.author.displayName ?? data.t.offline.reader.unknownUser;
	}
</script>

<svelte:head>
	<title>Janbao</title>
</svelte:head>

{#snippet sidebar()}
	<div class="space-y-4">
		{#if data.user}
			<UserInfoBlock user={data.user} t={data.t} />
			<div class="flex flex-col gap-2">
				<a
					class="btn btn-outline btn-sm w-full"
					href="/profile/discussions/{data.user.id}/{generateSlug(data.user.username)}"
				>
					{data.t.sidebar.myDiscussions}
				</a>
				<a class="btn btn-outline btn-sm w-full" href="/drafts">
					{data.t.sidebar.myDrafts}
				</a>
			</div>
		{:else}
			<div class="space-y-2">
				<h3 class="font-semibold text-sm text-base-content/70">{data.t.home.welcomeTo}</h3>
			</div>
		{/if}
	</div>
{/snippet}

<DualColumnLayout t={data.t} user={data.user} {sidebar}>
	<div class="space-y-4">
		{#if data.discussions.length === 0}
			<p class="text-sm text-base-content/60">{data.t.offline.reader.empty}</p>
		{:else}
			<ul class="divide-y divide-base-300">
				{#each data.discussions as d (d.id)}
					<li>
						<a
							class="flex items-center gap-4 pl-1 pr-2 py-4 transition-all hover:bg-base-200/20 rounded"
							href={`/offline/${d.id}`}
						>
							<span class="flex-shrink-0">
								<Avatar
									userId={d.authorId}
									avatarFileId={d.author.avatarFileId}
									displayName={displayName(d)}
									size="md"
								/>
							</span>
							<span class="flex-1 min-w-0">
								<span
									class="block font-semibold text-base text-base-content break-words leading-snug"
								>
									{d.title}
								</span>
								<span
									class="flex items-center gap-x-4 gap-y-1 text-xs text-base-content/60 flex-wrap mt-1"
								>
									{#if d.isPinned}
										<span
											class="bg-base-content text-base-100 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider text-[10px]"
										>
											{data.t.forum.pinned}
										</span>
									{/if}
									<span class="font-medium">{displayName(d)}</span>
									<span>{d.commentCount} {data.t.offline.reader.replies}</span>
									{#if d.lastReplyAt}
										<DateAtom value={d.lastReplyAt * 1000} t={data.t} />
									{/if}
								</span>
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</DualColumnLayout>
