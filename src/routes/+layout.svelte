<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import type { Snippet } from 'svelte';
	import { setContext, onMount } from 'svelte';
	import { page } from '$app/state';
	import AppShell from '$lib/components/templates/AppShell.svelte';
	import type { LayoutData } from './$types';
	import { getBadgesStore } from '$lib/stores/badges.svelte';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { getPwaInstallStore } from '$lib/stores/pwa-install.svelte';
	import { getOfflinePrefsStore } from '$lib/stores/offline-prefs.svelte';
	import { DEFAULT_OFFLINE_PREFS } from '$lib/offline/prefs';
	import { getEditorPrefsStore } from '$lib/stores/editor-prefs.svelte';

	interface LayoutProps {
		data: LayoutData;
		children: Snippet;
	}

	let { data, children }: LayoutProps = $props();

	const badges = getBadgesStore();
	const editorPrefs = getEditorPrefsStore();

	// Routes that render their own standalone layout (auth, the compose-message
	// flows) and must NOT get the persistent app shell (Header / tab bar).
	function isShellRoute(pathname: string): boolean {
		return (
			!pathname.startsWith('/entry') &&
			pathname !== '/messages/new' &&
			!pathname.startsWith('/messages/add')
		);
	}
	const showShell = $derived(isShellRoute(page.url.pathname));

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

	// Seed editor feature prefs from the session. The lazy editor chunk loads
	// after this effect runs, so live editors always render with the real prefs
	// on first paint. Re-runs only if the session user changes (the layout load
	// is param-free, so that is effectively once per full page load); the
	// settings page additionally calls update() on save to refresh live editors.
	$effect(() => {
		if (data.user) {
			editorPrefs.hydrate(data.user.editorPreferences);
		}
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

	// DEV ONLY: wipe any zombie service worker left on this origin by a prior
	// `vite build && preview` / prod run. Dev never uses the SW (registration
	// below is PROD-only), but a zombie SW intercepts fetches and serves the
	// stale built app, so source edits silently don't take effect until the SW
	// is manually unregistered (notoriously aggressive in Firefox). Clearing it
	// here lets HMR win. (This code itself only runs once the zombie is already
	// gone - chicken-and-egg - so the very first clear is manual; after that
	// it self-maintains.) See [[offline-debugging-heuristics]].
	function unregisterDevServiceWorker(): void {
		if (!import.meta.env.DEV || !('serviceWorker' in navigator)) return;
		navigator.serviceWorker
			.getRegistrations()
			.then((regs) => {
				for (const reg of regs) void reg.unregister();
			})
			.catch((err: unknown) => console.error('[sw] dev unregister failed:', err));
	}

	onMount(() => {
		unregisterDevServiceWorker();
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

{#if showShell}
	<AppShell t={data.t}>
		{@render children()}
	</AppShell>
{:else}
	{@render children()}
{/if}
