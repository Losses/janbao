<script lang="ts">
	/**
	 * DiscussionListPage Template - Thin shell for the paginated
	 * `/discussions/pN` route: DualColumnLayout + DiscussionsSidebar +
	 * DiscussionsPanel. (The home route `/` renders DiscussionsPanel directly via
	 * its own page; the mobile tab pager renders all three panels itself.)
	 */
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import DiscussionsPanel from '$lib/components/panels/DiscussionsPanel.svelte';
	import DiscussionsSidebar from '$lib/components/panels/DiscussionsSidebar.svelte';
	import type { DiscussionListItem } from '$lib/server/db/dao/discussions';
	import type { PageUrlBuilder } from '$lib/types/tabs';
	import type { UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface DiscussionListPageProps {
		discussions: DiscussionListItem[];
		currentPage: number;
		totalPages: number;
		t: TranslationDict;
		user: UserInfoSummary | null;
		buildPageUrl: PageUrlBuilder;
	}

	let { discussions, currentPage, totalPages, t, user, buildPageUrl }: DiscussionListPageProps =
		$props();
</script>

{#snippet sidebar()}
	<DiscussionsSidebar {t} {user} />
{/snippet}

<DualColumnLayout {sidebar} {t} {user}>
	<DiscussionsPanel {discussions} {currentPage} {totalPages} {t} {buildPageUrl} />
</DualColumnLayout>
