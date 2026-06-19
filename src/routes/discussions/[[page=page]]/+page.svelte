<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import DiscussionListPage from '$lib/components/templates/DiscussionListPage.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { writeList } from '$lib/offline/passthrough';
	import type { DiscussionListItem } from '$lib/server/db/dao/discussions';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const buildPageUrl = (page: number) => (page === 1 ? '/' : `/discussions/p${page}`);

	// DV07 C04 read passthrough: writes this page's discussions to IDB when the
	// user has the feature on and is online. Best-effort, no `$effect` loops.
	function runPassthrough(items: DiscussionListItem[]): void {
		if (typeof navigator !== 'undefined' && !navigator.onLine) return;
		void writeList(items).catch((err) => {
			console.error('[offline passthrough] writeList failed', err);
		});
	}
	onMount(() => runPassthrough(data.discussions));
	afterNavigate(() => runPassthrough(data.discussions));
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
