<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';
	import { getBadgesStore } from '$lib/stores/badges.svelte';

	interface LayoutProps {
		data: LayoutData;
		children: Snippet;
	}

	let { data, children }: LayoutProps = $props();

	const badges = getBadgesStore();

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
