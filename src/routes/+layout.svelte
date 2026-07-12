<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import type { Snippet } from 'svelte';
	import { setContext, onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { beforeNavigate, afterNavigate, goto, invalidate } from '$app/navigation';
	import AppShell from '$lib/components/templates/AppShell.svelte';
	import type { LayoutData } from './$types';
	import { getBadgesStore } from '$lib/stores/badges.svelte';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { getPwaInstallStore } from '$lib/stores/pwa-install.svelte';
	import { getOfflinePrefsStore } from '$lib/stores/offline-prefs.svelte';
	import { DEFAULT_OFFLINE_PREFS } from '$lib/offline/prefs';
	import { getEditorPrefsStore } from '$lib/stores/editor-prefs.svelte';
	import { getUiPrefsStore } from '$lib/stores/ui-prefs.svelte';
	import { SITE_DEFAULT_THEME } from '$lib/ui/prefs';
	import { getPageThemeStore } from '$lib/stores/page-theme.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { markEnterFromList, setReachedFromList } from '$lib/stores/thread-nav.svelte';
	import { initNavigationStore } from '$lib/stores/navigation.svelte';
	import { initMobilePagerStore, initSearchPagerStore } from '$lib/stores/mobile-pager.svelte';
	import { getPageCacheStore, type PageCacheStore } from '$lib/stores/page-cache.svelte';
	import { getCurrentScrollY } from '$lib/utils/get-current-scroll-y';
	import { isTabRootPath } from '$lib/utils/history-nav';
	import { isPilotTransition } from '$lib/utils/nav-pipeline-gate';
	import { getNavPipelineOrchestrator } from '$lib/stores/nav-pipeline-orchestrator.svelte';

	interface LayoutProps {
		data: LayoutData;
		children: Snippet;
	}

	/** Client-side navigation exposed to E2E (dev-only). See __e2eGoto below. */
	type E2EGotoHandler = (href: string) => Promise<void>;
	// E2E instrumentation for the page-cache staleness investigation (dev-only).
	// The page cache is the swipe-back preview's data source. It is written
	// from the root-layout effect for every tab root, and the staleness e2e
	// needs to observe each write. These hooks wrap `capture` once and record
	// every (pathname, subKey) write so the test can assert all three tab
	// entries were refreshed.
	type E2ECacheWriteKey = string;
	interface E2ECacheWrite {
		key: E2ECacheWriteKey;
		t: number;
	}
	type E2EInvalidateBadgesHandler = () => Promise<void>;
	interface E2EWindow extends Window {
		__e2eGoto?: E2EGotoHandler;
		__e2ePageCache?: PageCacheStore;
		__e2eCacheWrites?: E2ECacheWrite[];
		__e2eInvalidateBadges?: E2EInvalidateBadgesHandler;
		__e2ePageCacheHooked?: boolean;
	}

	let { data, children }: LayoutProps = $props();

	const badges = getBadgesStore();
	const pageCache = getPageCacheStore();
	const editorPrefs = getEditorPrefsStore();
	const uiPrefs = getUiPrefsStore();
	const pageTheme = getPageThemeStore();
	const navStore = initNavigationStore();
	initMobilePagerStore();
	initSearchPagerStore();

	// Hold the scroll-chrome header (and pin it visible on hash-enter) for
	// navigations where SvelteKit's scroll would otherwise make it twitch:
	// entering a hash-anchored thread (top→hash) and swiping back from a thread
	// to the list (top→restored scroll). The destination releases the hold and
	// pins the header visible once its scroll is set (thread page for enter,
	// (tabs) layout for swipe-back); a fallback timer covers the rest.
	let navFreezeTimer = 0;
	beforeNavigate((nav) => {
		const { to, from, type } = nav;
		const event = (nav as { event?: unknown }).event as
			| MouseEvent
			| TouchEvent
			| PopStateEvent
			| null
			| undefined;
		if (from && !isTabRootPath(from.url.pathname)) {
			pageCache.capture(from.url.pathname, undefined, { scrollTop: getCurrentScrollY() });
		}
		// The pilot orchestrator owns the transition when the source or
		// destination is the pilot route. When it consumes the
		// navigation (cancels + drives the slide plan via the executor),
		// the root layout's navStore hooks are skipped for this
		// navigation so they do not double-write navStore state.
		const orchestrator = getNavPipelineOrchestrator();
		if (
			orchestrator !== null &&
			isPilotTransition(from?.url.pathname ?? null, to?.url.pathname ?? null)
		) {
			const consumed = orchestrator.onSvelteKitBeforeNavigate({
				from: from ? { url: { pathname: from.url.pathname, search: from.url.search } } : null,
				to: to ? { url: { pathname: to.url.pathname, search: to.url.search } } : null,
				type,
				cancel: () => nav.cancel()
			});
			if (consumed) {
				return;
			}
		}
		if (to && from) {
			const isTabClick =
				event?.target instanceof Element && event.target.closest('[data-tab-nav]') !== null;
			if (isTabClick) {
				navStore.switchTab(to.url.pathname, to.url.search);
			} else {
				navStore.handleBeforeNavigate(to.url.pathname, from.url.pathname, type, to.url.search);
			}
		}

		const threadEnter = to?.url.hash && to.url.pathname.startsWith('/discussion');
		const swipeBack = from?.url.pathname.startsWith('/discussion') && to?.url.pathname === '/';
		// Record whether the thread was reached from the discussions list, so the
		// swipe-back gesture can pop the history entry (history.back) instead of
		// pushing a duplicate (goto). Set on every thread arrival so it reflects
		// the current entry's origin; stays false on full load (no beforeNavigate)
		// so a deep-linked thread never backs out of the site.
		if (to?.url.pathname.startsWith('/discussion')) {
			const fromList = from?.url.pathname === '/';
			if (fromList) markEnterFromList();
			setReachedFromList(fromList);
		}
		if (threadEnter || swipeBack) {
			const store = getScrollChromeStore();
			store.holdThroughNavigation(!!threadEnter);
			window.clearTimeout(navFreezeTimer);
			navFreezeTimer = window.setTimeout(() => store.releaseNavigation(), 1200);
		}
	});

	afterNavigate(() => {
		navStore.handleAfterNavigate();
		// Clear the pilot orchestrator's state on every navigation's
		// landing (the orchestrator is a no-op when not pilot-mounted).
		const orchestrator = getNavPipelineOrchestrator();
		if (orchestrator !== null) {
			orchestrator.onSvelteKitAfterNavigate();
		}
	});

	// Dev-only E2E hook: a deterministic client-side navigation that fires the
	// same beforeNavigate as a real link click. Real global routes are reached
	// via the drawer, whose open transition races in tests; goto is the exact
	// SPA path the drawer link ultimately takes, without the timing surface.
	if (import.meta.env.DEV && typeof window !== 'undefined') {
		const w = window as E2EWindow;
		w.__e2eGoto = (href) => goto(href);
		// Wrap the page-cache capture once (HMR-safe via the hooked flag) so
		// every cache write, from any caller of getPageCacheStore(), appends
		// to a log the staleness e2e reads. The wrapper is installed as an
		// instance own-property that shadows the prototype method, so the
		// shared singleton records every write regardless of caller. Each
		// (pathname, subKey) pair is the log key.
		if (!w.__e2ePageCacheHooked) {
			const store = getPageCacheStore();
			w.__e2ePageCache = store;
			const writes: E2ECacheWrite[] = [];
			w.__e2eCacheWrites = writes;
			const recordWrite = (key: E2ECacheWriteKey): void => {
				writes.push({ key, t: performance.now() });
			};
			const origCapture = store.capture.bind(store);
			store.capture = (pathname, subKey, input) => {
				recordWrite(subKey ? `${pathname}#${subKey}` : pathname);
				origCapture(pathname, subKey, input);
			};
			w.__e2eInvalidateBadges = () => invalidate('app:badges');
			w.__e2ePageCacheHooked = true;
		}
	}

	// Auth routes render their own standalone layout and must NOT get the
	// persistent app shell (Header / tab bar).
	function isShellRoute(pathname: string): boolean {
		return !pathname.startsWith('/entry');
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

	// Seed the page cache for the three tab roots from the root layout data
	// on every route. data.home/activity/messages are eager-loaded by
	// +layout.server.ts on every route and refresh whenever the root load
	// re-runs (invalidate), so a root-layout effect keeps every deep-page
	// swipe-back preview in sync with page.data. The page-data preference is
	// constrained to tab roots: elsewhere page.data.X may be a same-named but
	// semantically different field (/search results, /category/*, /profile/*)
	// that must NOT enter the shared cache, so only the eager-loaded data.*
	// fallback is written there.
	$effect(() => {
		const onTabRoot = isTabRootPath(page.url.pathname);
		const discussionsSource = onTabRoot && page.data.discussions ? page.data : data.home;
		const activitySource = onTabRoot && page.data.activities ? page.data : data.activity;
		const messagesSource = onTabRoot && page.data.conversations ? page.data : data.messages;
		// The captures merge into the cache, which reads the cache's $state
		// before writing it. Untrack the writes so this effect subscribes
		// only to page.data (re-runs on navigation) and not to the cache
		// (which would loop: effect_update_depth_exceeded).
		untrack(() => {
			if (discussionsSource?.discussions) {
				pageCache.capture('/', undefined, {
					data: {
						discussions: discussionsSource.discussions,
						page: discussionsSource.page ?? 1,
						totalPages: discussionsSource.totalPages ?? 1,
						totalCount: discussionsSource.totalCount ?? 0
					},
					source: { route: '/', page: discussionsSource.page ?? 1 }
				});
			}
			if (activitySource?.activities) {
				pageCache.capture('/activity', undefined, {
					data: {
						activities: activitySource.activities,
						page: activitySource.page ?? 1,
						totalPages: activitySource.totalPages ?? 1,
						totalCount: activitySource.totalCount ?? 0,
						activityDraft: activitySource.activityDraft,
						mentionedUsers: activitySource.mentionedUsers
					},
					source: { route: '/activity', page: activitySource.page ?? 1 }
				});
			}
			if (messagesSource?.conversations) {
				pageCache.capture('/messages/inbox', undefined, {
					data: {
						conversations: messagesSource.conversations,
						page: messagesSource.page ?? 1,
						totalPages: messagesSource.totalPages ?? 1,
						totalCount: messagesSource.totalCount ?? 0
					},
					source: { route: '/messages/inbox', page: messagesSource.page ?? 1 }
				});
			}
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

	// Seed interface prefs from the session. The layout load is param-free so it
	// does not re-run on client navigation; this hydrate fires once per full load.
	$effect(() => {
		if (data.user) {
			uiPrefs.hydrate(data.user.uiPreferences);
		}
	});
	// Single owner of <html data-theme>. Resolves the page-level override (set by
	// the discussion page while a themed thread is open and post themes are not
	// blocked) over the user's interface theme; an empty interface theme falls
	// back to the site default (SITE_DEFAULT_THEME), NOT to an unset/empty
	// attribute - removing data-theme (or setting it to '') makes daisyUI fall
	// back to its light/dark built-ins. `||` (not `??`) so the empty string that
	// represents "no interface theme" also falls through to the site default.
	// One effect avoids any ordering race between a layout effect and a deeper
	// page effect. Deriveds dedupe by value so it re-fires only on real changes.
	const interfaceTheme = $derived(uiPrefs.prefs.interfaceTheme);
	const pageThemeOverride = $derived(pageTheme.current);
	$effect(() => {
		if (typeof document === 'undefined') return;
		const resolved = (pageThemeOverride ?? interfaceTheme) || SITE_DEFAULT_THEME;
		document.documentElement.setAttribute('data-theme', resolved);
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
		navStore.init(window.location.pathname, window.location.search);
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
