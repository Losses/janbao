<script lang="ts">
	// src/lib/components/templates/NavPipelineTabHost.svelte
	//
	// The pipeline tab host. Renders the three primary tab panels in a
	// 3-panel track and drives the swipe via the NavPipelineOrchestrator
	// (no CSS transition; synchronous per pointermove during a drag, via
	// the rAF channels during a commit/settle/scrub) on the (tabs) layout.
	// The orchestrator handles both rightward (previous tab / back-target) and leftward
	// (next tab) gestures; tab taps are pipeline commits intercepted by
	// `onSvelteKitBeforeNavigate`.

	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { getRouteData } from '$lib/utils/route-data';
	import { MOBILE_TABS, getCurrentTabIndex, getPreviewPanel } from '$lib/utils/route-config';
	import { isTabRootPath } from '$lib/utils/history-nav';
	import { viewportLock } from '$lib/stores/viewport-lock.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { getPageCacheStore } from '$lib/stores/page-cache.svelte';
	import {
		getGlobalNavPipelineOrchestrator,
		setNavPipelineOrchestrator,
		releaseNavPipelineOrchestrator
	} from '$lib/stores/nav-pipeline-orchestrator.svelte';
	import { navPipelinePointer } from '$lib/actions/nav-pipeline-pointer';
	import { writeList, passthroughEnabledFor } from '$lib/offline/passthrough';
	import DiscussionsPanel from '$lib/components/panels/DiscussionsPanel.svelte';
	import ActivityPanel from '$lib/components/panels/ActivityPanel.svelte';
	import MessagesPanel from '$lib/components/panels/MessagesPanel.svelte';
	import DeepPreviewSkeleton from '$lib/components/panels/DeepPreviewSkeleton.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { DiscussionListItem } from '$lib/server/db/dao/discussions';
	import type { PageUrlBuilder, TabsLayoutData } from '$lib/types/tabs';
	import type { TranslationDict } from '$lib/types/translation';
	import type { UserInfoSummary } from '$lib/types/api';
	import type { Component } from 'svelte';

	interface NavPipelineTabHostProps {
		data: TabsLayoutData;
		t: TranslationDict;
		user: UserInfoSummary | null;
	}

	let { data, t, user }: NavPipelineTabHostProps = $props();

	const STEP_PERCENT = 100 / MOBILE_TABS.length;

	function initialIndex(): number {
		const idx = getCurrentTabIndex(page.url.pathname);
		return idx < 0 ? 0 : idx;
	}

	let activeIndex = $state(initialIndex());

	// Active-tab document title. The (tabs) layout's mobile branch renders this
	// host instead of `{@render children()}`, so the child route's
	// `<svelte:head><title>` (set by each (tabs)/+page.svelte) never applies on
	// mobile. Publish the equivalent title here so mobile SSR + swipes between
	// tabs keep the document title in sync. `/discussions/pN` resolves to tab 0
	// (the home title), matching `(tabs)/discussions/+page.svelte`.
	const activeTitle = $derived(
		activeIndex === 0
			? formatTitle(t.nav.home)
			: activeIndex === 1
				? formatTitle(t.nav.activity)
				: formatTitle(t.message.inbox)
	);

	// The shared singleton orchestrator. Every mobile host reaches the same
	// instance via `getGlobalNavPipelineOrchestrator`; the host calls
	// `configure` on mount and `releaseInputs` on destroy so the
	// singleton's executor + driver + rAF persist across the route swap.
	const orchestrator = getGlobalNavPipelineOrchestrator();
	const scrollChrome = getScrollChromeStore();
	const pageCache = getPageCacheStore();

	let viewportEl: HTMLElement | null = $state(null);
	let trackEl: HTMLElement | null = $state(null);
	let section0El: HTMLElement | null = $state(null);
	let section1El: HTMLElement | null = $state(null);
	let section2El: HTMLElement | null = $state(null);

	const publication = $derived(orchestrator.publication);
	const publicationPlan = $derived(publication.plan);
	const publicationInFlight = $derived(publication.inFlight);
	const panelCount = MOBILE_TABS.length;

	// Backward-to-deep-page deep-snapshot overlay. When a backward gesture
	// on the tab host targets a deep page (the history entry behind the
	// current tab per macro §6), the slide reveals the panel at
	// `activeIndex - 1`. Without this overlay that panel shows the previous
	// TAB's content (a visual proxy for the deep destination). The overlay
	// covers the revealed panel with the deep target's preview panel (or a
	// skeleton), so the slide's visual matches the deep page the user will
	// land on. On commit, `history.back()` lands on the deep page and the
	// real content mounts. When `activeIndex === 0` the orchestrator's
	// `suppressSlide` branch sets `distance = 0` (no slide); the overlay
	// mounts at `left: -33.33%` (`deepSnapshotPanelIndex * (100 /
	// panelCount)` = `-1 * 33.33%`) and stays offscreen, never revealed -
	// panel 0 has no left neighbour to slide into view.
	const deepSnapshotTarget = $derived.by<string | null>(() => {
		const target = publication.inFlight ? publication.toPathname : null;
		if (target === null) return null;
		if (isTabRootPath(target)) {
			// Backward-to-higher-indexed tab (e.g. the user is on tab 0 but
			// history's previous entry is tab 2, so a back-swipe pops to
			// tab 2): the resolver returns axis 'right' and a one-panel
			// slide, revealing the panel at activeIndex-1. Without this
			// overlay that panel shows the previous tab's content (a visual
			// proxy for the destination). Fire the overlay so the slide
			// shows the destination tab's content instead. Forward and
			// backward-to-lower tab-root cases keep returning null: their
			// slide either does not happen (tap) or reveals the real
			// destination panel content directly (multi-panel backward).
			if (publication.direction === 'backward') {
				const targetIdx = getCurrentTabIndex(target);
				if (targetIdx > activeIndex) return target;
			}
			return null;
		}
		return target;
	});
	const deepSnapshotTabTargetIdx = $derived(
		deepSnapshotTarget !== null && isTabRootPath(deepSnapshotTarget)
			? getCurrentTabIndex(deepSnapshotTarget)
			: -1
	);
	const deepSnapshotPanelIndex = $derived(activeIndex - 1);
	const deepSnapshotOverlayLeft = $derived(`${deepSnapshotPanelIndex * (100 / panelCount)}%`);
	const deepSnapshotOverlayWidth = $derived(`${100 / panelCount}%`);
	const deepSnapshotPreviewPanel = $derived.by<Component | null>(() => {
		const target = deepSnapshotTarget;
		if (target === null) return null;
		return getPreviewPanel(target);
	});

	// Per-panel scroll restore + scroll-chrome registration.
	$effect(() => {
		const el = activeIndex === 0 ? section0El : activeIndex === 1 ? section1El : section2El;
		if (!el) return;
		const saved = pageCache.get(MOBILE_TABS[activeIndex].href)?.scrollTop ?? 0;
		if (saved > 0) {
			el.scrollTop = saved;
			requestAnimationFrame(() => {
				const current =
					activeIndex === 0 ? section0El : activeIndex === 1 ? section1El : section2El;
				if (current === el) el.scrollTop = saved;
			});
		}
		scrollChrome.setScrollContainer(el);
	});

	// Sync activeIndex from the URL.
	let lastPathname = page.url.pathname;
	$effect(() => {
		const pathname = page.url.pathname;
		if (pathname !== lastPathname) {
			lastPathname = pathname;
			const idx = getCurrentTabIndex(pathname);
			if (idx >= 0 && idx !== activeIndex) {
				activeIndex = idx;
			}
		}
	});

	// Keep the orchestrator's from-pathname + resting translate in sync
	// with the active tab.
	$effect(() => {
		if (orchestratorMounted && !publicationInFlight) {
			const pathname = page.url.pathname;
			orchestrator.updateFromPathname(pathname);
			const idx = getCurrentTabIndex(pathname);
			if (idx >= 0 && viewportEl) {
				orchestrator.updateViewport(viewportEl.clientWidth, -idx * viewportEl.clientWidth);
			}
		}
	});

	// When the orchestrator lands (publication.plan goes null), reset the
	// pager store to the at-rest state.
	$effect(() => {
		if (publicationPlan !== null) return;
		orchestrator.resetPagerStore();
		if (viewportEl) {
			const idx = activeIndex;
			orchestrator.updateViewport(viewportEl.clientWidth, -idx * viewportEl.clientWidth);
		}
		// Re-apply the resting transform as a PERCENTAGE so it scales with
		// the viewport width.
		if (trackEl) {
			trackEl.style.transform = `translateX(-${activeIndex * STEP_PERCENT}%)`;
		}
	});

	const discussionsBuildPageUrl: PageUrlBuilder = (p) => (p === 1 ? '/' : `/discussions/p${p}`);

	// Active tab data resolution: the active tab reads its own page-load
	// data (reflects ?page); other tabs read the eager layout page-1 data.
	const settled = $derived(activeIndex === getCurrentTabIndex(page.url.pathname));
	const home = $derived(
		settled && activeIndex === 0
			? {
					discussions: page.data.discussions ?? data.home.discussions,
					page: page.data.page ?? data.home.page,
					totalPages: page.data.totalPages ?? data.home.totalPages,
					totalCount: page.data.totalCount ?? data.home.totalCount
				}
			: data.home
	);
	const activity = $derived(
		settled && activeIndex === 1
			? {
					activities: page.data.activities ?? data.activity.activities,
					page: page.data.page ?? data.activity.page,
					totalPages: page.data.totalPages ?? data.activity.totalPages,
					totalCount: page.data.totalCount ?? data.activity.totalCount,
					activityDraft: page.data.activityDraft ?? data.activity.activityDraft,
					mentionedUsers: page.data.mentionedUsers ?? data.activity.mentionedUsers
				}
			: data.activity
	);
	const messages = $derived(
		settled && activeIndex === 2
			? {
					conversations: page.data.conversations ?? data.messages.conversations,
					page: page.data.page ?? data.messages.page,
					totalPages: page.data.totalPages ?? data.messages.totalPages,
					totalCount: page.data.totalCount ?? data.messages.totalCount
				}
			: data.messages
	);

	const viewportStyle =
		'touch-action: pan-y pinch-zoom; height: 100%; overflow: clip; position: relative; width: 100%; flex: 1 1 auto;';
	const trackStyle = $derived(
		`width: ${panelCount * 100}%; display: flex; height: 100%; position: relative;`
	);
	const sectionStyle =
		'overflow-y: auto; overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y pinch-zoom;';

	const initialTrackTransform = $derived(`transform: translateX(-${activeIndex * STEP_PERCENT}%);`);

	let orchestratorMounted = $state(false);
	const MOBILE_BREAKPOINT = '(max-width: 767px)';
	onMount(() => {
		const fromPathname = page.url.pathname;
		const fromData = getRouteData(fromPathname);
		const w = viewportEl?.clientWidth ?? 0;
		orchestrator.configure({
			resolveElements: () => ({ pageTrack: trackEl, fab: null, header: null }),
			viewportWidth: w,
			restingTranslate: -activeIndex * w,
			backTarget: fromPathname,
			fromPathname,
			fromTag: fromData.tag,
			toTag: fromData.tag,
			fromTabIndex: activeIndex,
			toTabIndex: activeIndex,
			bidirectional: true
		});
		setNavPipelineOrchestrator(orchestrator);
		orchestratorMounted = true;
		viewportLock.acquire();
		held = true;
		const initialEl = activeIndex === 0 ? section0El : activeIndex === 1 ? section1El : section2El;
		if (initialEl) scrollChrome.setScrollContainer(initialEl);

		const ro = new ResizeObserver(() => {
			if (!viewportEl) return;
			const newW = viewportEl.clientWidth;
			orchestrator.updateViewport(newW, -activeIndex * newW);
			if (trackEl && publication.plan === null) {
				trackEl.style.transform = `translateX(-${activeIndex * STEP_PERCENT}%)`;
			}
		});
		if (viewportEl) ro.observe(viewportEl);

		// Mobile -> desktop breakpoint handler. Matches NavPipelineHost: on
		// the flip, land an in-flight committed transition
		// (`recoverDesktopFlipNav`) then full-teardown the orchestrator
		// (`unmount`) so the settle + tap-scrub rAFs are cancelled and do
		// not keep ticking into the desktop view. The `(tabs)` layout's own
		// mq handler flips `isMobile` which destroys this host in the next
		// microtask; this handler runs synchronously in the same mq event
		// (child onMount registers before parent onMount) so the full
		// teardown lands before the destroy. The desktop -> mobile flip
		// back re-creates this host; its `onMount.configure` reconstructs
		// the executor + driver (`if (this.#driver === null)`) on the
		// persisted singleton.
		const mq = window.matchMedia(MOBILE_BREAKPOINT);
		const handleBreakpoint = (): void => {
			if (!mq.matches && orchestratorMounted) {
				orchestrator.recoverDesktopFlipNav();
				orchestrator.unmount();
				releaseNavPipelineOrchestrator(orchestrator);
				orchestratorMounted = false;
				if (trackEl) trackEl.style.transform = '';
			}
		};
		mq.addEventListener('change', handleBreakpoint);

		return () => {
			mq.removeEventListener('change', handleBreakpoint);
			ro.disconnect();
			// Route-away destroy: light teardown. The singleton's executor
			// + driver persist for the next mobile host's configure.
			releaseOrchestrator();
			if (held) {
				viewportLock.release();
				held = false;
			}
		};
	});

	// DV07 C04 read passthrough on mobile. This host renders only in the
	// (tabs) layout's `{#if isMobile}` branch, which does not call
	// `{@render children()}` - so the route's own `+page.svelte` (where the
	// desktop `runPassthrough` call sites live) never mounts on mobile. Fire
	// the write here so mobile browsing of the discussions list populates the
	// offline cache. Gated on `getCurrentTabIndex(page.url.pathname) === 0`
	// so we write only the list the user is viewing (the discussions tab),
	// matching the desktop behaviour where `/activity` and `/messages/inbox`
	// do not trigger a write. Mirrors the desktop `onMount` + `afterNavigate`
	// pattern; best-effort (IDB failures are swallowed), no `$effect` loop
	// (per [[svelte-effect-fetch-loop]]).
	//
	// IMPORTANT: read `page.data.discussions ?? data.home.discussions` here,
	// NOT the reactive `home.discussions`. The reactive `home` derivation
	// resolves to `data.home` (the layout's eager page-1 snapshot) unless
	// `settled` is true, and `settled = (activeIndex ===
	// getCurrentTabIndex(page.url.pathname))`. The `activeIndex`-sync
	// `$effect` (synced from `page.url.pathname`) flushes AFTER
	// `afterNavigate` fires, so at the afterNavigate instant on a cross-tab
	// paginated nav (e.g. `/activity` -> `/discussions/p2`) `activeIndex`
	// still holds the source tab index (1), `settled = (1 === 0) = false`,
	// and `home.discussions` captures page-1 data instead of page-N. The
	// route's loaded PageData (`page.data.discussions`) is fresh at the
	// afterNavigate instant, so read it directly and fall back to the layout
	// snapshot when the active route does not provide discussions (e.g. `/`
	// itself, where the route's load returns `{ discussions, page: 1, ... }`
	// and `page.data.discussions` is also present, so the fallback is a
	// safety net rather than the common path). `onMount` reads the same
	// source for consistency; it is not defective (activeIndex is seeded
	// from the URL at host init, so `settled` is true at mount), but using
	// one source for both callbacks keeps the reasoning single.
	//
	// The writeList call is deferred to `requestIdleCallback` (with a
	// `setTimeout(0)` fallback for runtimes without it) so the IDB write's
	// synchronous prep (data mapping, transaction open) does not contend with
	// the orchestrator's gesture-animation rAF on this same host. The write
	// is best-effort and survives host destroy (the data is the same regardless
	// of host lifecycle), so a long idle wait is acceptable.
	function runPassthrough(items: DiscussionListItem[]): void {
		if (typeof navigator !== 'undefined' && !navigator.onLine) return;
		if (!passthroughEnabledFor(user)) return;
		const run = (): void => {
			void writeList(items).catch((err) => {
				console.error('[offline passthrough] writeList failed', err);
			});
		};
		if (typeof requestIdleCallback === 'function') {
			requestIdleCallback(() => run());
		} else {
			setTimeout(run, 0);
		}
	}
	onMount(() => {
		// Read the route's loaded data directly, not the reactive
		// `home.discussions` (see the long note above `runPassthrough`).
		// `onMount` is not defective here, but using one source for both
		// lifecycle callbacks keeps the reasoning single.
		if (getCurrentTabIndex(page.url.pathname) === 0) {
			runPassthrough(page.data.discussions ?? data.home.discussions);
		}
	});
	afterNavigate(() => {
		// Gate on the route directly, not the reactive `activeIndex`: the
		// activeIndex `$effect` (synced from `page.url.pathname`) flushes
		// AFTER afterNavigate fires, so the reactive gate would see a stale
		// tab index and skip (or redundantly re-run) the passthrough write.
		// `/` and `/discussions/pN` both resolve to tab 0. Read the route's
		// loaded data directly for the same reason - the reactive
		// `home.discussions` is stale at this instant (see the long note
		// above `runPassthrough`).
		if (getCurrentTabIndex(page.url.pathname) === 0) {
			runPassthrough(page.data.discussions ?? data.home.discussions);
		}
	});

	let held = false;
	const releaseOrchestrator = (): void => {
		if (!orchestratorMounted) return;
		orchestrator.releaseInputs();
		releaseNavPipelineOrchestrator(orchestrator);
		orchestratorMounted = false;
	};

	onDestroy(() => {
		if (!browser) return;
		scrollChrome.setScrollContainer(null);
		// Idempotent with the onMount cleanup; either path runs once.
		releaseOrchestrator();
		if (held) {
			viewportLock.release();
			held = false;
		}
	});

	const pointerDisabled = (): boolean => trackEl === null;
</script>

<svelte:head>
	<title>{activeTitle}</title>
</svelte:head>

<div
	bind:this={viewportEl}
	class="overflow-clip h-full w-full"
	style={viewportStyle}
	use:navPipelinePointer={{ orchestrator, disabled: pointerDisabled }}
>
	<div
		bind:this={trackEl}
		data-testid="nav-pipeline-tab-track"
		class="flex items-start h-full w-full"
		style={trackStyle + ' ' + initialTrackTransform}
	>
		<section
			class="scroll-pane h-full shrink-0"
			data-tab-panel={MOBILE_TABS[0].labelKey}
			style={`width: ${100 / panelCount}%; ${sectionStyle}`}
			bind:this={section0El}
			onscroll={(e) =>
				pageCache.capture(MOBILE_TABS[0].href, undefined, {
					scrollTop: e.currentTarget.scrollTop
				})}
		>
			<div class="gpl-card">
				<DiscussionsPanel
					discussions={home.discussions}
					currentPage={home.page}
					totalPages={home.totalPages}
					{t}
					buildPageUrl={discussionsBuildPageUrl}
					paginate={true}
				/>
			</div>
		</section>
		<section
			class="scroll-pane h-full shrink-0"
			data-tab-panel={MOBILE_TABS[1].labelKey}
			style={`width: ${100 / panelCount}%; ${sectionStyle}`}
			bind:this={section1El}
			onscroll={(e) =>
				pageCache.capture(MOBILE_TABS[1].href, undefined, {
					scrollTop: e.currentTarget.scrollTop
				})}
		>
			<div class="gpl-card">
				<ActivityPanel
					activities={activity.activities}
					currentPage={activity.page}
					totalPages={activity.totalPages}
					activityDraft={activity.activityDraft}
					mentionedUsers={activity.mentionedUsers}
					{t}
					{user}
					paginate={true}
				/>
			</div>
		</section>
		<section
			class="scroll-pane h-full shrink-0"
			data-tab-panel={MOBILE_TABS[2].labelKey}
			style={`width: ${100 / panelCount}%; ${sectionStyle}`}
			bind:this={section2El}
			onscroll={(e) =>
				pageCache.capture(MOBILE_TABS[2].href, undefined, {
					scrollTop: e.currentTarget.scrollTop
				})}
		>
			<div class="gpl-card">
				<MessagesPanel
					conversations={messages.conversations}
					currentPage={messages.page}
					totalPages={messages.totalPages}
					{t}
					paginate={true}
				/>
			</div>
		</section>
		{#if deepSnapshotTarget !== null}
			{@const DeepPreview = deepSnapshotPreviewPanel}
			<!-- Deep-snapshot overlay: covers the revealed panel (at
			     deepSnapshotPanelIndex) with the deep target's preview
			     panel, a tab panel for a backward-to-higher tab target,
			     or a skeleton, so the slide shows the destination's
			     content instead of the previous tab's panel. -->
			<div
				class="deep-snapshot-overlay"
				data-deep-preview={deepSnapshotTarget}
				style={`position: absolute; top: 0; left: ${deepSnapshotOverlayLeft}; width: ${deepSnapshotOverlayWidth}; height: 100%;`}
			>
				<div class="gpl-card" style={sectionStyle}>
					{#if deepSnapshotTabTargetIdx === 0}
						<DiscussionsPanel
							discussions={data.home.discussions}
							currentPage={data.home.page}
							totalPages={data.home.totalPages}
							{t}
							buildPageUrl={discussionsBuildPageUrl}
							paginate={true}
						/>
					{:else if deepSnapshotTabTargetIdx === 1}
						<ActivityPanel
							activities={data.activity.activities}
							currentPage={data.activity.page}
							totalPages={data.activity.totalPages}
							activityDraft={data.activity.activityDraft}
							mentionedUsers={data.activity.mentionedUsers}
							{t}
							{user}
							paginate={true}
						/>
					{:else if deepSnapshotTabTargetIdx === 2}
						<MessagesPanel
							conversations={data.messages.conversations}
							currentPage={data.messages.page}
							totalPages={data.messages.totalPages}
							{t}
							paginate={true}
						/>
					{:else if DeepPreview}
						<DeepPreview />
					{:else}
						<DeepPreviewSkeleton />
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
