<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import DiscussionsPanel from '$lib/components/panels/DiscussionsPanel.svelte';
	import DiscussionsSidebar from '$lib/components/panels/DiscussionsSidebar.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { writeList, passthroughEnabledFor } from '$lib/offline/passthrough';
	import type { DiscussionListItem } from '$lib/server/db/dao/discussions';
	import type { PageUrlBuilder } from '$lib/types/tabs';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const buildPageUrl: PageUrlBuilder = (page) => (page === 1 ? '/' : `/discussions/p${page}`);

	// DV07 C04 read passthrough: writes this list page's discussions to IDB
	// tagged with reason 'read' when the user has the feature on and is online.
	// Decision #5: gated on `data.user` so guests on an installed PWA never
	// populate a cache (passthroughEnabledFor centralizes that check). No bare
	// `$effect` (per [[svelte-effect-fetch-loop]]); onMount + afterNavigate read
	// the snapshot at the right lifecycle points. Best-effort: an IDB hiccup is
	// swallowed so it never breaks the online list view.
	function runPassthrough(items: DiscussionListItem[]): void {
		if (typeof navigator !== 'undefined' && !navigator.onLine) return;
		if (!passthroughEnabledFor(data.user)) return;
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

<DualColumnLayout t={data.t} user={data.user}>
	{#snippet sidebar()}
		<DiscussionsSidebar t={data.t} user={data.user} />
	{/snippet}

	<DiscussionsPanel
		discussions={data.discussions}
		currentPage={data.page}
		totalPages={data.totalPages}
		t={data.t}
		{buildPageUrl}
	/>
</DualColumnLayout>
