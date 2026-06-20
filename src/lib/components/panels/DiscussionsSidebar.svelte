<script lang="ts">
	/**
	 * DiscussionsSidebar - The home/discussions drawer+inline sidebar: user block
	 * + action buttons (or guest auth), category list, active users. Shared by
	 * the desktop home/paginated routes and the mobile pager drawer.
	 */
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import ActiveUsersWall from '$lib/components/molecules/ActiveUsersWall.svelte';
	import CategoryListWidget from '$lib/components/molecules/CategoryListWidget.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import type { UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface DiscussionsSidebarProps {
		t: TranslationDict;
		user: UserInfoSummary | null;
	}

	let { t, user }: DiscussionsSidebarProps = $props();

	const myDiscussionsHref = $derived(
		user ? `/profile/discussions/${user.id}/${generateSlug(user.username)}` : null
	);
</script>

<div class="space-y-4">
	{#if user}
		<UserInfoBlock {user} {t} />
		<div class="flex flex-col gap-2">
			<a href="/post/discussion" class="btn btn-primary btn-sm w-full">
				{t.sidebar.createDiscussion}
			</a>
			{#if myDiscussionsHref}
				<a href={myDiscussionsHref} class="btn btn-outline btn-sm w-full">
					{t.sidebar.myDiscussions}
				</a>
			{/if}
			<a href="/drafts" class="btn btn-outline btn-sm w-full">
				{t.sidebar.myDrafts}
			</a>
		</div>
	{:else}
		<div class="space-y-2">
			<h3 class="text-sm font-semibold text-base-content/70">{t.home.welcomeTo}</h3>
			<div class="flex gap-2">
				<a href="/entry/signin" class="btn btn-sm btn-primary flex-1">{t.nav.signin}</a>
				<a href="/entry/register" class="btn btn-sm btn-outline flex-1">{t.nav.register}</a>
			</div>
		</div>
	{/if}
	<CategoryListWidget {t} />
	<ActiveUsersWall {t} />
</div>
