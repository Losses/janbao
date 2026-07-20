<script lang="ts">
	import { onMount } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import NavPipelineHost from '$lib/components/templates/NavPipelineHost.svelte';
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

	// Mobile renders the scope pager inside NavPipelineHost; desktop keeps the
	// form/select surface. `isMobile` seeds from `data.isMobile`, the UA-derived
	// value the root `+layout.server.ts` sets for every request, so SSR and the
	// first client render agree on which branch to paint (no hydration
	// mismatch); `onMount`'s matchMedia sync then refines it to the live
	// viewport. Mirrors the (tabs) layout and NavPipelineHost.svelte.
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
		<NavPipelineHost leftHref="/">
			<SearchScopePager {data} />
		</NavPipelineHost>
	{:else}
		<DesktopSearch {data} />
	{/if}
</DualColumnLayout>
