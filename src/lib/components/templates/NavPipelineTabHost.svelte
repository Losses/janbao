<script lang="ts">
	// src/lib/components/templates/NavPipelineTabHost.svelte
	//
	// The pipeline tab host. Renders the three primary tab panels in a
	// 3-panel track and drives the swipe via the NavPipelineOrchestrator
	// (rAF, no CSS transition). Replaces MobileTabPager on the (tabs)
	// layout. The orchestrator handles both rightward (previous tab /
	// back-target) and leftward (next tab) gestures; tab taps are
	// pipeline commits intercepted by `onSvelteKitBeforeNavigate`.

	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
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
	import DiscussionsPanel from '$lib/components/panels/DiscussionsPanel.svelte';
	import ActivityPanel from '$lib/components/panels/ActivityPanel.svelte';
	import MessagesPanel from '$lib/components/panels/MessagesPanel.svelte';
	import DeepPreviewSkeleton from '$lib/components/panels/DeepPreviewSkeleton.svelte';
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
	// real content mounts.
	const deepSnapshotTarget = $derived.by<string | null>(() => {
		const target = publication.inFlight ? publication.toPathname : null;
		if (target === null) return null;
		if (isTabRootPath(target)) return null;
		return target;
	});
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

	let held = false;
	const releaseOrchestrator = (): void => {
		if (!orchestratorMounted) return;
		releaseNavPipelineOrchestrator(orchestrator);
		orchestrator.releaseInputs();
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
			     panel or a skeleton, so the slide shows the destination's
			     content instead of the previous tab's panel. -->
			<div
				class="deep-snapshot-overlay"
				data-deep-preview={deepSnapshotTarget}
				style={`position: absolute; top: 0; left: ${deepSnapshotOverlayLeft}; width: ${deepSnapshotOverlayWidth}; height: 100%;`}
			>
				<div class="gpl-card" style={sectionStyle}>
					{#if DeepPreview}
						<DeepPreview />
					{:else}
						<DeepPreviewSkeleton />
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
