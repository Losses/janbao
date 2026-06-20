<script lang="ts">
	/**
	 * AppShell - The persistent app chrome (just the Header, which carries the
	 * MobileTabBar). Rendered once by the root layout so the Header - and thus
	 * the tab bar and its CSS transitions - survives navigation across the
	 * `(tabs)` branch and standalone pages (discussion thread, search, profile,
	 * ...). Without this, each page's DualColumnLayout would re-mount its own
	 * Header and the tab-switch animation would be lost on cross-branch nav.
	 *
	 * The drawer itself stays in DualColumnLayout (it owns the per-page sidebar);
	 * the hamburger here toggles the shared drawer store, and the drawer is
	 * closed on every navigation so a stale-open drawer never carries over.
	 */
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import Header from '$lib/components/organisms/Header.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { getDrawerStore } from '$lib/stores/drawer.svelte';
	import type { TranslationDict } from '$lib/types/translation';

	interface AppShellProps {
		children: Snippet;
		t: TranslationDict;
	}

	let { children, t }: AppShellProps = $props();

	const drawer = getDrawerStore();

	// Attach the (idempotent, mobile-gated) scroll listener that drives the
	// hide-on-scroll Header. start() is guarded so re-mounting never
	// double-attaches.
	onMount(() => {
		getScrollChromeStore().start();
	});

	// Close the drawer on every navigation: the drawer lives in the per-page
	// DualColumnLayout and shows that page's sidebar, so an open drawer must not
	// persist across a page change.
	afterNavigate(() => {
		drawer.close();
	});
</script>

<div class="flex min-h-screen flex-col">
	<Header {t} onToggleDrawer={drawer.toggle} />
	<div class="min-w-0 flex-1">{@render children()}</div>
</div>
