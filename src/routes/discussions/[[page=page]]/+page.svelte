<script lang="ts">
	import DiscussionListPage from '$lib/components/templates/DiscussionListPage.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const buildPageUrl = (page: number) => (page === 1 ? '/' : `/discussions/p${page}`);
</script>

<svelte:head>
	<title>{formatTitle(data.t.nav.home)}</title>
</svelte:head>

<DiscussionListPage
	discussions={data.discussions}
	currentPage={data.page}
	totalPages={data.totalPages}
	t={data.t}
	user={data.user}
	{buildPageUrl}
/>
