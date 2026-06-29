<script lang="ts">
	import { onMount } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import GesturePageLayout from '$lib/components/templates/GesturePageLayout.svelte';
	import SearchScopePager from '$lib/components/templates/SearchScopePager.svelte';
	import DesktopSearch from '$lib/components/templates/DesktopSearch.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const tSearch = $derived(t.search);

	// Mobile renders the scope pager inside GesturePageLayout; desktop keeps the
	// pre-DV08 form/select surface. SSR defaults to desktop (isMobile false);
	// the client flips on mount (a normal reactive update, not a hydration
	// mismatch), mirroring the (tabs) layout.
	const MOBILE_BREAKPOINT = '(max-width: 767px)';
	// svelte-ignore state_referenced_locally
	let isMobile = $state(data.isMobile ?? false);
	onMount(() => {
		const mq = window.matchMedia(MOBILE_BREAKPOINT);
		const sync = () => {
			isMobile = mq.matches;
		};
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});
</script>

<svelte:head>
	<title>{formatTitle(tSearch.title)}</title>
</svelte:head>

{#snippet sidebar()}
	<!-- empty -->
{/snippet}

<DualColumnLayout {sidebar} {t} user={data.user}>
	{#if isMobile}
		<GesturePageLayout fallbackRoute="/">
			<SearchScopePager {data} />
		</GesturePageLayout>
	{:else}
		<DesktopSearch {data} />
	{/if}
</DualColumnLayout>
