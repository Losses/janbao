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
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import Header from '$lib/components/organisms/Header.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { getDrawerStore } from '$lib/stores/drawer.svelte';
	import { resolveDeepHeaderTitle } from '$lib/utils/deep-header-config';
	import type { TranslationDict } from '$lib/types/translation';

	interface AppShellProps {
		children: Snippet;
		t: TranslationDict;
	}

	let { children, t }: AppShellProps = $props();

	const drawer = getDrawerStore();
	// True when the App Bar is showing the page title (a deep page with a
	// resolvable title). Stamped on the root div so CSS can hide the duplicate
	// in-page title on mobile (where the bar carries it); desktop keeps the
	// in-page title because the bar shows the logo + nav there. SSR-derived, so
	// the class is in the first paint (no flash of the duplicate title).
	const appbarHasTitle = $derived(
		Boolean(page.data.headerTitle ?? resolveDeepHeaderTitle(page.url.pathname, t))
	);

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

<div class="flex min-h-screen flex-col" class:appbar-title={appbarHasTitle}>
	<Header {t} onToggleDrawer={drawer.toggle} />
	<div class="flex min-w-0 flex-1 flex-col app-shell-content">{@render children()}</div>
</div>
