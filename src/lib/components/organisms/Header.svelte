<script lang="ts">
	/**
	 * Header Organism - the global sticky App Bar (rendered once in AppShell).
	 *
	 * Desktop: logo + navigation links (Activity / Messages / Search).
	 *
	 * Mobile: a 2-panel horizontal track (root panel + search panel, mirrors the
	 * MobileTabPager pattern). The search button is a SINGLE absolutely-positioned
	 * `<a>` that slides from the right edge to the left edge via a `left` CSS
	 * transition: one icon, no duplicate. Entering search slides the track left
	 * (root content exits left, search content pushes in from the right) while the
	 * search button independently travels right-to-left, stopping at the
	 * hamburger's position.
	 *
	 * The root↔deep vertical morph (BurgerArrowIcon + title) lives INSIDE panel 0
	 * but is FROZEN during a search transition (the tabs must exit horizontally
	 * with the track, never float up vertically).
	 *
	 * The SearchTabBar row clip-expands (max-height 0 → auto) rather than jumping.
	 */
	import { untrack, tick, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import Logo from '$lib/components/atoms/Logo.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import BurgerArrowIcon from '$lib/components/atoms/BurgerArrowIcon.svelte';
	import MobileTabBar from '$lib/components/organisms/MobileTabBar.svelte';
	import SearchTabBar from '$lib/components/organisms/SearchTabBar.svelte';
	import SearchSortSheet from '$lib/components/molecules/SearchSortSheet.svelte';
	import { isNavActive } from '$lib/utils/nav-active';
	import { resolveDeepHeaderTitle } from '$lib/utils/deep-header-config';
	import { resolveHeaderMode } from '$lib/utils/header-mode';
	import { getCurrentTabIndex } from '$lib/utils/mobile-tabs';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';
	import { getNavigationStore, backHandler } from '$lib/stores/navigation.svelte';
	import { hopForHref } from '$lib/utils/history-nav';
	import {
		HEADER_MORPH_THRESHOLD,
		TITLE_CROSSFADE_MS,
		GESTURE_MORPH_EPSILON
	} from '$lib/utils/gesture-constants';
	import { mdiMagnify, mdiFilterVariant } from '@mdi/js';
	import type { SearchSort, SearchScope } from '$lib/types/search';
	import type { VoidHandler } from '$lib/types/handlers';
	import type { TranslationDict } from '$lib/types/translation';

	interface HeaderProps {
		t: TranslationDict;
		onToggleDrawer: VoidHandler;
	}

	let { t, onToggleDrawer }: HeaderProps = $props();

	const scrollChrome = getScrollChromeStore();
	const pager = getMobilePagerStore();
	const navStore = getNavigationStore();
	const tNav = $derived(t.nav);
	const currentPath = $derived(page.url.pathname);
	const translateY = $derived(scrollChrome.translateY);
	const scrolling = $derived(scrollChrome.scrolling);

	const currentHasTabs = $derived(getCurrentTabIndex(currentPath) >= 0);
	const targetHasTabs = $derived(
		navStore.backTarget ? getCurrentTabIndex(navStore.backTarget) >= 0 : false
	);
	const isDeepToDeep = $derived(!currentHasTabs && !targetHasTabs);

	const mode = $derived(resolveHeaderMode(currentPath));
	const isSearch = $derived(mode === 'search');
	const isDeep = $derived(mode === 'deep');
	const dragging = $derived(pager.dragging);
	const title = $derived(page.data.headerTitle ?? resolveDeepHeaderTitle(currentPath, t) ?? '');

	type TitleDirection = 'forward' | 'back';

	// Unified title state machine. The deep-title layer renders from ONE model
	// (`titleView` below): a single (outgoing, incoming, progress, transition,
	// direction) tuple that is continuous across the gesture→event handoff: the
	// in-flight crossfade holds through release and navigation landing, so the
	// incoming title stays visible the whole way (no mid-transition vanish).
	// svelte-ignore state_referenced_locally
	let restTitle = $state(title); // title shown at rest; updated to the arrived title at settle-end
	let settling = $state(false); // any non-gesture crossfade (commit / cancel / click)
	let latchedOutgoing = $state('');
	let latchedIncoming = $state('');
	let settleProgress = $state(1); // 0..1, CSS-transitioned during settling
	let settleTarget = $state<0 | 1>(1); // commit / non-gesture → 1; cancel → 0
	let settleAwaitTitle = $state(false); // commit holds settling until the nav lands (title === latchedIncoming); cancel/non-gesture end on the visual transition
	let titleDirection = $state<TitleDirection>('forward');
	let lastGestureMorph = $state(0); // per-frame latch while dragging (pager.backMorph has already jumped to 1/0 by the time dragging flips false)
	// Idempotency flag for Effect B's CLEAR branch. The CLEAR branch (m ≤ epsilon)
	// zeroes lastGestureMorph; a same-flush re-run of Effect B then reads m=0 and
	// would re-enter CLEAR and undo the settle that the commit/cancel branch of
	// this same release just started (collapse-then-replay). releaseConsumed marks
	// a release already consumed by the commit/cancel branch so the CLEAR branch
	// skips the undo on a same-flush re-run; the genuine no-gesture release (m=0 on
	// the first run, flag never set) still clears. Reset on the next drag (Effect A)
	// and in endSettle.
	let releaseConsumed = $state(false);

	// Root<->search tap transition: scrub `morph` continuously so the piecewise
	// search consumers (tabProgress over morph [0,0.2], searchProgress over
	// [0.2,1]) play as slide-then-expand on enter and collapse-then-slide on
	// exit, mirroring the gesture's backMorph scrub. A root<->search tap has no
	// title change (Effect C stays idle) and no gesture, so `morph` would
	// otherwise jump between its rest values and the two consumers would fire
	// their CSS transitions in parallel. While scrubbing, the search consumers
	// drop their CSS transition (slideT / trackStyle / tabBarStyle /
	// searchButtonStyle) so `morph` drives them 1:1, as a drag does.
	let searchScrubbing = $state(false);
	let searchScrubProgress = $state(0);
	let searchScrubFrom = $state(0);
	let searchScrubTo = $state(0);
	let searchScrubRafId: number | undefined;
	let prevHadTabs: boolean | null = null;
	let prevSearchTitle: string | null = null;
	let prevIsSearch: boolean | null = null;
	let prevPath = $state('');
	let lastPath = '';
	$effect.pre(() => {
		const path = currentPath;
		prevPath = lastPath;
		lastPath = path;
	});
	const prevHasTabs = $derived(prevPath ? getCurrentTabIndex(prevPath) >= 0 : currentHasTabs);

	const isSettleMode = $derived.by(() => {
		if (settling) return true;
		// Transition frame for gesture release:
		if (!dragging && lastGestureMorph > GESTURE_MORPH_EPSILON && !releaseConsumed) {
			return true;
		}
		return false;
	});

	const morph = $derived.by(() => {
		const res = (() => {
			// 1. Gesture dragging: follow finger progress directly (unless it is deep-to-deep transition, which has no morph)
			if (dragging) {
				return isDeepToDeep ? 0 : (pager.backMorph ?? (currentHasTabs ? 1 : 0));
			}

			// 1b. Root<->search tap scrub: interpolate morph between the two rest
			// values over ~200ms so the piecewise search consumers sequence. Without
			// it they all fire their CSS transitions at once. See startSearchScrub.
			if (searchScrubbing) {
				const eased = 1 - (1 - searchScrubProgress) ** 3;
				return searchScrubFrom + (searchScrubTo - searchScrubFrom) * eased;
			}

			// 2. Non-dragging animation settling phase (commit, cancel, or click transitions)
			if (isSettleMode) {
				const current = currentHasTabs ? 1 : 0;
				const target = targetHasTabs ? 1 : 0;
				const prev = prevHasTabs ? 1 : 0;

				const progress = settling ? settleProgress : lastGestureMorph;
				const isGesture = settling
					? settleAwaitTitle || settleTarget === 0
					: lastGestureMorph > GESTURE_MORPH_EPSILON;

				const awaitTitle = settling ? settleAwaitTitle : isGesture && navStore.pendingNav !== null;
				const targetZero = settling
					? settleTarget === 0
					: isGesture && navStore.pendingNav === null;

				if (awaitTitle) {
					// Committed navigation in flight: transition from current page to target page
					return current * (1 - progress) + target * progress;
				}
				if (targetZero) {
					// Cancelled transition: slide the preview target page back to current page
					return target * progress + current * (1 - progress);
				}
				// Regular click/popstate transitions: slide from previous page to current page
				return prev * (1 - progress) + current * progress;
			}

			// 3. Resting idle state: determined solely by whether the current path has tabs (1 = tabs, 0 = deep page)
			return currentHasTabs ? 1 : 0;
		})();

		return res;
	});

	// Freeze the icon morph during a search transition so the hamburger does not
	// morph into an arrow while it is sliding off-screen.
	const iconProgress = $derived(isSearch ? 0 : 1 - morph);
	const slideT = $derived(
		dragging || searchScrubbing || (navStore.navInFlight && !settling)
			? 'none'
			: 'transform 200ms ease-out, opacity 200ms ease-out'
	);
	let settleRafId: number | undefined;
	let settleTimeoutId: ReturnType<typeof setTimeout> | undefined;
	let active = true; // HMR/destroy guard (onDestroy sets false)

	// A. Gesture morph latch. `$effect.pre` so the write is visible to the render
	// in the same flush. `morph` is read OUTSIDE untrack so the effect tracks it
	// and runs every drag frame; on the release flush `dragging` is already false
	// so `if (dragging)` skips the write and the last in-drag value M survives.
	$effect.pre(() => {
		const m = pager.backMorph ?? 0;
		if (dragging)
			untrack(() => {
				lastGestureMorph = m;
				releaseConsumed = false;
			});
	});

	// B. Release → settle. `$effect.pre` runs before the DOM update, so
	// `settling=true` is visible to the render in the same flush. `lastGestureMorph
	// > 0` is the "just gestured" witness; `navStore.pendingNav !== null`
	// distinguishes commit (GPL setPendingNav) from cancel.
	//
	// The CLEAR branch (m ≤ epsilon) skips the undo when this same release was
	// already consumed by the commit/cancel branch: see releaseConsumed above. A
	// same-flush re-run after CLEAR zeroed lastGestureMorph would otherwise undo
	// the settle just started (collapse-then-replay).
	$effect.pre(() => {
		if (dragging) return;
		if (untrack(() => releaseConsumed)) return;
		const pending = navStore.pendingNav;
		const m = untrack(() => lastGestureMorph);
		const hasPending = pending !== null;

		if (m <= GESTURE_MORPH_EPSILON && !hasPending) {
			// No preceding gesture / cancelled near origin: clear any stale settle so
			// it can't stick. Skip the undo if this release was already consumed by
			// the commit/cancel branch (the in-flight settle is owned by Effect D /
			// Effect C / the span transitionend).
			untrack(() => {
				if (settling && !releaseConsumed) {
					settling = false;
					restTitle = title;
				}
				lastGestureMorph = 0;
			});
			return;
		}
		const committed = hasPending;
		untrack(() => {
			const out = title;
			const inc = navStore.backTarget ? (resolveDeepHeaderTitle(navStore.backTarget, t) ?? '') : '';
			if (!navStore.backTarget) {
				lastGestureMorph = 0;
				releaseConsumed = true;
				return;
			}
			if (committed) {
				latchedOutgoing = out;
				latchedIncoming = inc;
				settleTarget = 1;
				settleAwaitTitle = true; // hold the crossfade until the nav lands (title → inc)
			} else {
				// Cancel: the revealed title retreats, the current title stays.
				latchedOutgoing = out;
				latchedIncoming = inc;
				settleTarget = 0;
				settleAwaitTitle = false; // no nav: end on the visual transition
			}
			settleProgress = m; // continuity: begin the settle at the finger's release position
			titleDirection = 'back';
			settling = true;
			lastGestureMorph = 0;
			releaseConsumed = true;
		});
		runSettleDriver();
	});

	// C. Title change. `$effect.pre` so the latch is visible to the render in the
	// same flush. Absorb a title change that matches the in-flight settle (the
	// committed nav landing); interrupt + re-arm toward a new title so a rapid
	// back-to-back nav can't strand the header on a stale title.
	$effect.pre(() => {
		const newTitle = title;
		if (untrack(() => dragging)) return;
		if (untrack(() => settling)) {
			if (untrack(() => newTitle === latchedIncoming)) {
				// The awaited navigation landed. For a commit (`settleAwaitTitle`) this
				// is the real end of the settle (the visual crossfade has been holding
				// the incoming title centred); end it now so restTitle adopts the live
				// title. Cancel / non-gesture settle end on the visual transition instead.
				if (untrack(() => settleAwaitTitle)) endSettle();
				return;
			}
			// A different title arrived mid-settle: interrupt + re-arm toward it so a
			// rapid back-to-back nav can't strand the header on a stale title.
			let rearmed = false;
			untrack(() => {
				if (newTitle && newTitle !== latchedIncoming && newTitle !== latchedOutgoing) {
					latchedOutgoing = latchedIncoming;
					latchedIncoming = newTitle;
					settleTarget = 1;
					settleProgress = 0;
					settleAwaitTitle = false; // the new title is already current; end on the visual transition
					titleDirection = navStore.direction === 'backward' ? 'back' : 'forward';
					rearmed = true;
				}
			});
			if (rearmed) runSettleDriver();
			return;
		}
		// idle: non-gesture title change (forward click / back button / popstate)
		untrack(() => {
			if (newTitle && newTitle !== restTitle) {
				latchedOutgoing = restTitle;
				latchedIncoming = newTitle;
				settleTarget = 1;
				settleProgress = 0;
				settleAwaitTitle = false; // title is already current; end on the visual transition
				titleDirection = navStore.direction === 'backward' ? 'back' : 'forward';
				settling = true;
			} else if (!newTitle && !isDeep) {
				restTitle = '';
			} else if (newTitle && restTitle === '') {
				restTitle = newTitle;
			}
		});
		if (untrack(() => settling)) runSettleDriver();
	});

	// D. Commit settle ends on nav-done. `$effect.pre` so endSettle's writes
	// (settling=false, restTitle=title) are visible to the render in the same
	// flush. Both `navStore.pendingNav` and `navStore.navInFlight` are read OUTSIDE
	// untrack so this effect re-runs the moment either flips.
	//
	// pendingNav===null means executePendingNav already ran (it clears pendingNav
	// before setting navInFlight). !navInFlight means the navigation completed
	// (afterNavigate clears navInFlight, or goto.reject's .catch does). Both
	// together = the dispatch happened AND the navigation landed, on any device
	// speed. No latch, no wall-clock, no microtask-order dependency.
	//
	// settleAwaitTitle restricts this to commit settles; cancel / non-gesture
	// (settleAwaitTitle=false) end on the span transitionend + the CSS-derived
	// backstop in runSettleDriver and never enter this branch. navigateBackward
	// is cancel-class here: it sets no pendingNav so Effect B's
	// `committed = pendingNav !== null` is false -> settleAwaitTitle stays false.
	//
	// Load-bearing premise: a gesture-committed history.back() always has a real
	// previous entry to pop (gestures route through hopForHref and dispatch via
	// 'link', never a bare history.back() against a single-entry stack), so
	// afterNavigate ALWAYS fires on a commit. If a future non-hop gesture path
	// dispatches history.back() against a one-entry history, afterNavigate would
	// not fire, navInFlight would stay true, and this effect would never end the
	// settle; such a path must keep history.back() out of single-entry stacks.
	$effect.pre(() => {
		const pending = navStore.pendingNav;
		const inFlight = navStore.navInFlight;
		if (
			untrack(() => settling) &&
			untrack(() => settleAwaitTitle) &&
			pending === null &&
			!inFlight
		) {
			endSettle();
		}
	});

	// E. Root<->search tap scrub trigger. Scrub `morph` between its two rest
	// values only on a root<->search tap: currentHasTabs flips, isSearch flips
	// (one side is /search), the title does not change (so Effect C's settle
	// stays idle), and no gesture is in flight (a gesture scrubs via backMorph).
	// Other currentHasTabs flips are left alone: root<->deep leaves isSearch
	// unchanged, and search<->deep has no morph delta (startSearchScrub no-ops).
	$effect.pre(() => {
		const curTabs = currentHasTabs;
		const curTitle = title;
		const curIsSearch = isSearch;
		if (prevHadTabs === null) {
			prevHadTabs = curTabs;
			prevSearchTitle = curTitle;
			prevIsSearch = curIsSearch;
			return;
		}
		const prevTabs = prevHadTabs;
		const prevT = prevSearchTitle;
		const prevS = prevIsSearch;
		prevHadTabs = curTabs;
		prevSearchTitle = curTitle;
		prevIsSearch = curIsSearch;
		if (curTabs === prevTabs) return;
		if (curIsSearch === prevS) return; // only root<->search; root<->deep is unchanged
		if (!browser) return;
		if (curTitle !== prevT) return; // Effect C settle animates morph
		if (untrack(() => dragging)) return; // gesture owns morph via backMorph
		if (untrack(() => settling)) return; // a settle is in flight
		if (untrack(() => lastGestureMorph) > GESTURE_MORPH_EPSILON) return;
		startSearchScrub(prevTabs ? 1 : 0, curTabs ? 1 : 0);
	});

	function startSearchScrub(from: number, to: number): void {
		if (searchScrubRafId !== undefined) {
			cancelAnimationFrame(searchScrubRafId);
			searchScrubRafId = undefined;
		}
		if (from === to) return; // no morph delta (search<->deep) -> nothing to scrub
		searchScrubFrom = from;
		searchScrubTo = to;
		searchScrubProgress = 0;
		searchScrubbing = true;
		const startT = performance.now();
		const tick = (): void => {
			if (!searchScrubbing) return; // cancelled or interrupted
			const t = Math.min(1, (performance.now() - startT) / TITLE_CROSSFADE_MS);
			searchScrubProgress = t;
			if (t >= 1) {
				searchScrubbing = false;
				searchScrubRafId = undefined;
				return;
			}
			searchScrubRafId = requestAnimationFrame(tick);
		};
		searchScrubRafId = requestAnimationFrame(tick);
	}

	function runSettleDriver(): void {
		if (settleRafId) cancelAnimationFrame(settleRafId);
		if (settleTimeoutId) clearTimeout(settleTimeoutId);
		void tick().then(() => {
			if (!active) return;
			if (typeof document !== 'undefined') void document.body.offsetHeight;
			settleRafId = requestAnimationFrame(() => {
				if (!active) return;
				settleProgress = settleTarget;
			});
		});
		// Cancel / non-gesture settle backstop only. A commit settle
		// (settleAwaitTitle) ends via Effect D on nav-done (pendingNav cleared AND
		// navInFlight false) with NO timer: a device-dependent navigation-delay
		// timer would race slow-device landings (timer fires first -> STATIC
		// collapse -> landing re-triggers the crossfade = the replay bug). Cancel /
		// non-gesture do not navigate, so no navigation-delay race exists; this
		// timer is bound to the known CSS span duration and only covers a dropped
		// span transitionend on those non-navigating branches.
		if (!settleAwaitTitle) {
			settleTimeoutId = setTimeout(() => {
				if (active) endSettle();
			}, TITLE_CROSSFADE_MS * 2);
		}
	}

	function endSettle(): void {
		if (!untrack(() => settling)) return; // idempotent
		settling = false;
		settleAwaitTitle = false;
		releaseConsumed = false;
		restTitle = untrack(() => title) || untrack(() => latchedIncoming);
		if (settleRafId) {
			cancelAnimationFrame(settleRafId);
			settleRafId = undefined;
		}
		if (settleTimeoutId) {
			clearTimeout(settleTimeoutId);
			settleTimeoutId = undefined;
		}
	}

	function onTitleSpanTransitionEnd(): void {
		// A commit settle ignores the visual transitionend and waits for the
		// navigation to land (Effect C absorb); cancel / non-gesture end here.
		if (!untrack(() => settleAwaitTitle)) endSettle();
	}

	onDestroy(() => {
		active = false;
		if (browser) {
			if (settleRafId) cancelAnimationFrame(settleRafId);
			if (settleTimeoutId) clearTimeout(settleTimeoutId);
			searchScrubbing = false;
			if (searchScrubRafId !== undefined) {
				cancelAnimationFrame(searchScrubRafId);
				searchScrubRafId = undefined;
			}
		}
	});

	// Derived tab status and direction are declared at the top of script to satisfy dependency order.

	interface TitleView {
		outgoing: string;
		incoming: string;
		progress: number;
		transition: string;
		direction: TitleDirection;
	}

	const currentTitle = $derived(title);
	const backTitle = $derived(
		navStore.backTarget ? (resolveDeepHeaderTitle(navStore.backTarget, t) ?? '') : ''
	);
	// One render model for every phase. The drag branch hardcodes direction
	// 'back' (a back-swipe always slides the current title down and brings the
	// back target in from above) so it never inherits a stale module titleDirection.
	const titleView = $derived<TitleView>(
		dragging && backTitle && currentTitle
			? {
					outgoing: currentTitle,
					incoming: backTitle,
					progress: pager.backMorph ?? 0,
					transition: 'none',
					direction: 'back'
				}
			: settling
				? {
						outgoing: latchedOutgoing,
						incoming: latchedIncoming,
						progress: settleProgress,
						transition: `transform ${TITLE_CROSSFADE_MS}ms ease-out`,
						direction: titleDirection
					}
				: {
						outgoing: restTitle,
						incoming: restTitle,
						progress: 1,
						transition: 'none',
						direction: titleDirection
					}
	);

	// Root↔deep vertical morph: FROZEN in search mode so the tabs exit
	// horizontally with the track, never float up.
	const rootLayerStyle = $derived(
		isSearch
			? 'transform: none; opacity: 1;'
			: `transform: translateY(${
					!(currentHasTabs || targetHasTabs) ? -100 : -(1 - morph) * 100
				}%); transition: ${slideT}; pointer-events: ${
					morph > 0.5 && targetHasTabs ? 'auto' : 'none'
				}`
	);
	const layerDownStyle = $derived(
		`transform: translateY(${(isDeepToDeep ? 0 : morph) * 100}%); transition: ${slideT}; pointer-events: ${
			morph < 0.5 ? 'auto' : 'none'
		}`
	);

	// Root↔search horizontal track.
	const searchProgress = $derived(
		isSearch
			? 1 -
					(morph <= HEADER_MORPH_THRESHOLD
						? 0
						: (morph - HEADER_MORPH_THRESHOLD) / (1 - HEADER_MORPH_THRESHOLD))
			: 0
	);
	const tabProgress = $derived(isSearch ? 1 - Math.min(1, morph / HEADER_MORPH_THRESHOLD) : 0);

	const trackStyle = $derived(
		`transform: translateX(${-(searchProgress * 50).toFixed(2)}%); transition: ${
			dragging || searchScrubbing || navStore.navInFlight ? 'none' : 'transform 200ms ease-out'
		};`
	);

	// The SINGLE search button: absolute, slides from right to left. Driven by
	// the SAME searchProgress as the track so it is gesture-synced (1:1 with the
	// finger during a back-swipe). `left` is a linear interp from calc(100% -
	// 3rem) at progress 0 to 0.5rem at progress 1.
	const searchButtonLeft = $derived(
		`calc(${((1 - searchProgress) * 100).toFixed(2)}% - ${((1 - searchProgress) * 3).toFixed(2)}rem + ${(searchProgress * 0.5).toFixed(2)}rem)`
	);
	const searchButtonStyle = $derived(
		`left: ${searchButtonLeft}; transition: ${dragging || searchScrubbing || navStore.navInFlight ? 'none' : 'left 200ms ease-out'};`
	);

	// SearchTabBar row: clip-expand (max-height) driven by tabProgress so it
	// gesture-syncs with the track and the search button.
	const tabBarStyle = $derived(
		`max-height: ${(tabProgress * 3).toFixed(2)}rem; transition: ${
			dragging || searchScrubbing || navStore.navInFlight ? 'none' : 'max-height 200ms ease-out'
		};`
	);

	// Search query input (bind:value + composition gating + debounce + keepFocus).
	const urlQ = $derived(page.url.searchParams.get('q') ?? '');
	let inputValue = $state(untrack(() => urlQ));
	let lastUrlQ = untrack(() => urlQ);
	let composing = $state(false);
	let debounceId: ReturnType<typeof setTimeout> | 0 = 0;
	$effect(() => {
		if (composing) return;
		if (urlQ !== lastUrlQ && urlQ !== inputValue) {
			lastUrlQ = urlQ;
			inputValue = urlQ;
		}
	});
	function commitQuery(q: string): void {
		if (composing) return;
		const params = new SvelteURLSearchParams();
		if (q) params.set('q', q);
		params.set('scope', page.url.searchParams.get('scope') ?? 'discussions');
		params.set('sort', page.url.searchParams.get('sort') ?? 'newest');
		params.set('page', '1');
		void goto(`/search?${params.toString()}`, {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}
	function scheduleCommit(): void {
		if (composing) return;
		if (debounceId) clearTimeout(debounceId);
		debounceId = setTimeout(() => commitQuery(inputValue), 400);
	}
	function onInput(): void {
		scheduleCommit();
	}
	function onCompositionStart(): void {
		composing = true;
	}
	function onCompositionEnd(event: CompositionEvent): void {
		composing = false;
		inputValue = (event.currentTarget as HTMLInputElement).value;
		scheduleCommit();
	}
	function onInputKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && !composing) {
			if (debounceId) clearTimeout(debounceId);
			commitQuery(inputValue);
		}
	}

	let filterOpen = $state(false);
	const activeScope = $derived(
		(page.url.searchParams.get('scope') ?? 'discussions') as SearchScope
	);
	const activeSort = $derived((page.url.searchParams.get('sort') ?? 'newest') as SearchSort);
	function onSelectSort(sort: SearchSort): void {
		const params = new SvelteURLSearchParams();
		if (page.url.searchParams.get('q')) params.set('q', page.url.searchParams.get('q') as string);
		params.set('scope', activeScope);
		params.set('sort', sort);
		params.set('page', '1');
		void goto(`/search?${params.toString()}`, { replaceState: true, noScroll: true });
	}

	let headerEl: HTMLElement | null = $state(null);
	$effect(() => {
		if (!headerEl) return;
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
				scrollChrome.setHeaderHeight(height);
				document.documentElement.style.setProperty('--header-height', `${height}px`);
			}
		});
		observer.observe(headerEl);
		return () => observer.disconnect();
	});

	function onBack(): void {
		if (backHandler.dispatch()) return;
		const target = navStore.backTarget;
		if (navStore.activeStack.length > 1) {
			if (hopForHref(target) === 'back') {
				history.back();
			} else {
				void goto(target, { replaceState: true });
			}
		} else {
			void goto('/', { replaceState: true });
		}
	}
	function onLeftButton(): void {
		if (isDeep) onBack();
		else onToggleDrawer();
	}

	let inputEl: HTMLInputElement | null = $state(null);
	$effect(() => {
		if (browser && isSearch && inputEl) inputEl.focus();
	});
</script>

<header
	bind:this={headerEl}
	class="sticky top-0 z-40 mx-auto w-full max-w-[960px] px-0 transition-transform duration-200 md:mt-6 md:px-6"
	class:scroll-chrome-scrolling={scrolling}
	style:transform="translateY({translateY}px)"
>
	<div class="bg-neutral text-neutral-content shadow-md md:shadow-none">
		<!-- Desktop nav -->
		<nav class="hidden items-end gap-6 px-6 pt-3 pb-2.5 md:flex">
			<Logo {t} class="text-neutral-content" />
			<div class="flex items-end gap-4">
				<a
					href="/activity"
					class="text-sm font-medium text-neutral-content/70 hover:text-neutral-content hover:underline"
					class:text-accent={isNavActive(currentPath, '/activity')}
					aria-current={isNavActive(currentPath, '/activity') ? 'page' : undefined}
				>
					{tNav['activity']}
				</a>
				<a
					href="/messages/inbox"
					class="text-sm font-medium text-neutral-content/70 hover:text-neutral-content hover:underline"
					class:text-accent={isNavActive(currentPath, '/messages')}
					aria-current={isNavActive(currentPath, '/messages') ? 'page' : undefined}
				>
					{tNav['messages']}
				</a>
				<a
					href="/search"
					class="text-sm font-medium text-neutral-content/70 hover:text-neutral-content hover:underline"
					class:text-accent={isNavActive(currentPath, '/search')}
					aria-current={isNavActive(currentPath, '/search') ? 'page' : undefined}
				>
					{tNav['search']}
				</a>
			</div>
		</nav>

		<!-- Mobile nav: 2-panel track + single absolute search button. -->
		<div class="relative overflow-clip md:hidden">
			<div class="flex w-[200%]" style={trackStyle}>
				<!-- Panel 0: root/deep content (no search button here; the absolute
				     <a> below covers the right area in root mode). -->
				<div class="flex w-1/2 shrink-0 items-center px-2 py-2">
					<button
						type="button"
						class="flex size-10 shrink-0 items-center justify-center text-neutral-content/80 hover:bg-neutral-content/10 hover:text-neutral-content"
						onclick={onLeftButton}
						aria-label={isDeep ? tNav['back'] : tNav['menu']}
					>
						<BurgerArrowIcon progress={iconProgress} {dragging} />
					</button>
					<div class="relative h-10 flex-1">
						<div class="absolute inset-0 flex items-center justify-center" style={rootLayerStyle}>
							<MobileTabBar {t} />
						</div>
						<div
							class="absolute inset-0 flex items-center justify-center px-2 overflow-hidden"
							style={layerDownStyle}
						>
							{#if titleView.outgoing === titleView.incoming}
								<!-- Static title (at rest) -->
								<div class="absolute inset-0 flex items-center justify-center px-2">
									<span class="w-full truncate text-center font-medium text-neutral-content">
										{titleView.incoming}
									</span>
								</div>
							{:else}
								{@const fwd = titleView.direction === 'forward'}
								<!-- Outgoing title -->
								<div
									class="absolute inset-0 flex items-center justify-center px-2"
									style="transform: translateY({(fwd ? -titleView.progress : titleView.progress) *
										100}%); transition: {titleView.transition};"
									ontransitionend={onTitleSpanTransitionEnd}
								>
									<span class="w-full truncate text-center font-medium text-neutral-content">
										{titleView.outgoing}
									</span>
								</div>

								<!-- Incoming title -->
								<div
									class="absolute inset-0 flex items-center justify-center px-2"
									style="transform: translateY({(fwd
										? 1 - titleView.progress
										: -(1 - titleView.progress)) * 100}%); transition: {titleView.transition};"
								>
									<span class="w-full truncate text-center font-medium text-neutral-content">
										{titleView.incoming}
									</span>
								</div>
							{/if}
						</div>
					</div>
				</div>

				<!-- Panel 1: search content. pl-14 leaves room for the search button
				     (absolute, at left in search mode). -->
				<div class="flex w-1/2 shrink-0 items-center gap-2 py-2 pr-2 pl-14">
					<input
						bind:this={inputEl}
						bind:value={inputValue}
						type="text"
						oninput={onInput}
						oncompositionstart={onCompositionStart}
						oncompositionend={onCompositionEnd}
						onkeydown={onInputKeydown}
						placeholder={t.search.placeholder}
						class="input input-sm h-9 flex-1 border-0 bg-neutral-content/10 text-neutral-content placeholder:text-neutral-content/50 focus:outline-none"
						autocomplete="off"
					/>
					<button
						type="button"
						class="flex size-10 shrink-0 items-center justify-center text-neutral-content/80 hover:bg-neutral-content/10 hover:text-neutral-content"
						onclick={() => (filterOpen = true)}
						aria-label={t.search.sortBy}
					>
						<Icon path={mdiFilterVariant} size={22} />
					</button>
				</div>
			</div>

			<!-- Single search button: slides from right (root) to left (search =
			     hamburger position) via `left` transition. Always rendered; ONE icon. -->
			<a
				href="/search"
				class="absolute top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center text-neutral-content/80 hover:bg-neutral-content/10 hover:text-neutral-content"
				style={searchButtonStyle}
				aria-label={tNav['search']}
				aria-current={isNavActive(currentPath, '/search') ? 'page' : undefined}
			>
				<Icon path={mdiMagnify} size={22} />
			</a>
		</div>

		<!-- SearchTabBar row: clip-expand via max-height (no mount jump). -->
		<div class="overflow-hidden md:hidden" style={tabBarStyle}>
			<SearchTabBar {t} />
		</div>
	</div>
</header>

<SearchSortSheet
	open={filterOpen}
	{t}
	scope={activeScope}
	sort={activeSort}
	onSelect={onSelectSort}
	onClose={() => (filterOpen = false)}
/>
