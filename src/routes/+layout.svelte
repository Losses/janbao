<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import type { Snippet } from 'svelte';
	import { setContext, onMount } from 'svelte';
	import type { LayoutData } from './$types';
	import { getBadgesStore } from '$lib/stores/badges.svelte';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { getPwaInstallStore } from '$lib/stores/pwa-install.svelte';
	import { getOfflinePrefsStore } from '$lib/stores/offline-prefs.svelte';
	import { DEFAULT_OFFLINE_PREFS } from '$lib/offline/prefs';

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

	// Online/offline status drives the delta-sync trigger and (via the shared
	// store) the C03 disable sweep across server-dependent UI. SW registration
	// is production-only so dev assets are never cached.
	const online = getOnlineStore();

	function triggerSync(): void {
		void import('$lib/offline/sync-orchestrator')
			.then(({ runSync }) => runSync())
			.catch((err: unknown) => console.error('[offline] sync failed:', err));
	}

	// One-time guard flag in localStorage. Once set, the auto-enable path never
	// re-evaluates the prefs comparison, so a user who later turns caching back
	// off is never silently re-enabled by a future installed-PWA launch.
	const AUTO_ENABLE_GUARD_KEY = 'janbao:offline-autoenabled';

	function prefsAreDefaults(): boolean {
		const current = getOfflinePrefsStore().prefs;
		const defaults = DEFAULT_OFFLINE_PREFS;
		return (
			current.enabled === defaults.enabled &&
			current.depth === defaults.depth &&
			current.refreshIntervalDays === defaults.refreshIntervalDays &&
			current.passthrough === defaults.passthrough &&
			current.categories.latest === defaults.categories.latest &&
			current.categories.mostViewed === defaults.categories.mostViewed &&
			current.categories.mostReplied === defaults.categories.mostReplied
		);
	}

	function maybeAutoEnableOnInstall(): void {
		const pwa = getPwaInstallStore();
		if (!pwa.isInstalled) return;
		try {
			if (localStorage.getItem(AUTO_ENABLE_GUARD_KEY) === '1') return;
		} catch {
			// localStorage unavailable / blocked: bail without enabling so we
			// don't flip a pref we can't durably mark as auto-set.
			return;
		}
		// Only enable when prefs are byte-for-byte the defaults - this is what
		// makes the hook respect a user's explicit prior choice. A user who
		// has ever toggled any field will have a non-default prefs object and
		// is skipped permanently (the guard then sticks on the first launch
		// that DID match, sealing the window).
		if (!prefsAreDefaults()) {
			try {
				localStorage.setItem(AUTO_ENABLE_GUARD_KEY, '1');
			} catch {
				/* ignore - best-effort */
			}
			return;
		}
		getOfflinePrefsStore().update({ enabled: true });
		try {
			localStorage.setItem(AUTO_ENABLE_GUARD_KEY, '1');
		} catch {
			/* ignore - best-effort */
		}
	}

	onMount(() => {
		online.setOnline(navigator.onLine);
		// Decision #5: guests have no power to enable caching and the curated
		// sync API 401s for them, so skip the sync fetch entirely when there
		// is no authed user. Avoids firing a guaranteed-401 on every reconnect.
		const markOnline = () => {
			online.setOnline(true);
			if (data.user) triggerSync();
		};
		const markOffline = () => online.setOnline(false);
		window.addEventListener('online', markOnline);
		window.addEventListener('offline', markOffline);
		// Keep the offline cache fresh on load when already online.
		if (navigator.onLine && data.user) triggerSync();
		// DV07 C03 - auto-enable offline caching once on the first launch as an
		// installed PWA, but ONLY when the prefs are still exactly the defaults
		// (the user has not manually configured) AND a one-time guard flag is
		// not set. Idempotent: setting the guard + persisting the pref on the
		// same pass means subsequent launches short-circuit on the guard before
		// the prefs comparison ever runs. Runs in onMount, not a bare `$effect`,
		// so it never re-fires on tracked-state changes ([[svelte-effect-fetch-loop]]).
		maybeAutoEnableOnInstall();
		// `sw` is the service-worker container in production (undefined in dev, or
		// when the browser lacks SW support). Registration is production-only so
		// dev assets are never cached.
		const sw =
			import.meta.env.PROD && 'serviceWorker' in navigator ? navigator.serviceWorker : undefined;
		// Reload the page the moment a freshly built service worker takes over, so
		// the user never sees a stale app shell / offline layout after a rebuild.
		// `hadController` guards the very first install (controller goes null→set)
		// so a tab that just loaded fresh content from the network is not reloaded.
		const hadController = !!sw?.controller;
		let refreshing = false;
		const onControllerChange = () => {
			if (!hadController || refreshing) return;
			refreshing = true;
			location.reload();
		};
		sw?.addEventListener('controllerchange', onControllerChange);
		sw?.register('/service-worker.js').catch((err: unknown) => {
			console.error('[sw] registration failed:', err);
		});
		return () => {
			window.removeEventListener('online', markOnline);
			window.removeEventListener('offline', markOffline);
			sw?.removeEventListener('controllerchange', onControllerChange);
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
