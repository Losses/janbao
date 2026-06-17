<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import type { Snippet } from 'svelte';
	import { setContext } from 'svelte';
	import type { LayoutData } from './$types';
	import { getBadgesStore } from '$lib/stores/badges.svelte';

	interface LayoutProps {
		data: LayoutData;
		children: Snippet;
	}

	let { data, children }: LayoutProps = $props();

	const badges = getBadgesStore();

	// Publish the resolved app locale ('en' | 'zh-CN') so locale-aware atoms
	// (e.g. <Date>'s absolute-timestamp tooltip) can format in the user's
	// language rather than the browser locale. Exposed as a getter so it stays
	// current if the layout load re-runs with a different locale.
	setContext('app:lang', () => data.lang);

	// Reactively update the <html> tag's lang attribute
	$effect(() => {
		if (typeof document !== 'undefined') {
			document.documentElement.lang = data.lang;
		}
	});

	// Seed the sidebar icon unread counts from the layout server load. Re-runs
	// on every navigation (load result changes), giving per-navigation badge
	// freshness without polling. The notification tooltip may clear its own
	// count optimistically between navigations.
	$effect(() => {
		badges.seed({
			unreadNotifications: data.unreadNotificationCount,
			unreadMessages: data.unreadMessageCount
		});
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
