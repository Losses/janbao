<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import type { Snippet } from 'svelte';
	import { setContext, onMount } from 'svelte';
	import type { LayoutData } from './$types';
	import { getBadgesStore } from '$lib/stores/badges.svelte';
	import { getOnlineStore } from '$lib/stores/online.svelte';

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

	// Online/offline status drives the offline banner, the delta-sync trigger, and
	// (via the shared store) the C03 disable sweep across server-dependent UI. SW
	// registration is production-only so dev assets are never cached.
	const online = getOnlineStore();

	function triggerSync(): void {
		void import('$lib/offline/sync-orchestrator')
			.then(({ runSync }) => runSync())
			.catch((err: unknown) => console.error('[offline] sync failed:', err));
	}

	onMount(() => {
		online.setOnline(navigator.onLine);
		const markOnline = () => {
			online.setOnline(true);
			triggerSync();
		};
		const markOffline = () => online.setOnline(false);
		window.addEventListener('online', markOnline);
		window.addEventListener('offline', markOffline);
		// Keep the offline cache fresh on load when already online.
		if (navigator.onLine) triggerSync();
		if (import.meta.env.PROD && 'serviceWorker' in navigator) {
			navigator.serviceWorker.register('/service-worker.js').catch((err: unknown) => {
				console.error('[sw] registration failed:', err);
			});
		}
		return () => {
			window.removeEventListener('online', markOnline);
			window.removeEventListener('offline', markOffline);
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if !online.online}
	<div
		role="status"
		aria-live="polite"
		class="flex w-full items-center gap-3 bg-neutral px-4 py-2 text-sm text-neutral-content"
	>
		<span class="font-medium">{data.t.offline.status}</span>
		<span class="opacity-80">{data.t.offline.hint}</span>
		<a class="link link-hover ml-auto" href="/offline">{data.t.offline.openReader}</a>
		<button type="button" class="btn btn-ghost btn-xs" onclick={() => location.reload()}>
			{data.t.offline.retry}
		</button>
	</div>
{/if}

{@render children()}
