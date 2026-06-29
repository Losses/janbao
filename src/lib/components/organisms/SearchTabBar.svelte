<script lang="ts">
	/**
	 * SearchTabBar - the four search-scope cells (Discussions / Activity /
	 * Messages / Users) with a stretchy bottom underline, a sibling of
	 * `MobileTabBar`. Rendered inside the Header's search layer so it continues
	 * the top bar colour (`bg-neutral`) and rides the search-exit morph.
	 *
	 * The underline is driven by the SEARCH pager store's `fractionalIndex`
	 * (active scope + fractional drag), exactly as MobileTabBar's pill is driven
	 * by the primary pager. `dragDir` is derived locally from the fractionalIndex
	 * delta (no store field). While dragging, the edge toward the drag direction
	 * (leading) races to the target while the trailing edge lags behind it,
	 * producing a stretch that grows past one cell then settles back - never
	 * contracting below one cell. Cells are equal-width so the math is closed-form
	 * (percentages of the strip, no measurement).
	 */
	import { untrack } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getSearchPagerStore } from '$lib/stores/mobile-pager.svelte';
	import { SEARCH_SCOPES, type SearchScope, type SearchSort } from '$lib/types/search';
	import { searchUnderline } from '$lib/utils/search-underline';
	import { searchScopeLabel } from '$lib/utils/search-label';
	import type { TranslationDict } from '$lib/types/translation';

	interface SearchTabBarProps {
		t: TranslationDict;
	}

	let { t }: SearchTabBarProps = $props();

	const pager = getSearchPagerStore();
	const tSearch = $derived(t.search);

	const N = SEARCH_SCOPES.length;

	const urlScope = $derived((page.url.searchParams.get('scope') ?? 'discussions') as SearchScope);
	const urlIndex = $derived(Math.max(0, SEARCH_SCOPES.indexOf(urlScope)));
	const f = $derived(pager.active ? pager.fractionalIndex : urlIndex);

	// dragDir derived from the fractionalIndex delta (sign of motion); reset to 0
	// (resting) whenever the drag ends so the underline snaps cleanly to a cell.
	let prevF = untrack(() => f);
	let dragDir = $state(0);
	$effect(() => {
		const cur = f;
		if (pager.dragging) {
			const d = cur - prevF;
			if (Math.abs(d) > 0.001) dragDir = Math.sign(d);
		} else {
			dragDir = 0;
		}
		prevF = cur;
	});

	const underline = $derived(searchUnderline(f, pager.dragging, dragDir, N));

	const underlineStyle = $derived(
		`left: ${underline.left.toFixed(2)}%; width: ${underline.width.toFixed(2)}%; transition: ${
			pager.dragging ? 'none' : 'left 200ms ease-out, width 200ms ease-out'
		};`
	);

	function switchScope(scope: SearchScope): void {
		const params = new SvelteURLSearchParams();
		const q = page.url.searchParams.get('q') ?? '';
		const sort = (page.url.searchParams.get('sort') ?? 'newest') as SearchSort;
		if (q) params.set('q', q);
		params.set('scope', scope);
		params.set('sort', sort);
		params.set('page', '1');
		void goto(`/search?${params.toString()}`, { replaceState: true, noScroll: true });
	}
</script>

<nav class="relative flex items-stretch justify-center gap-1 px-2 pb-1" aria-label={tSearch.title}>
	{#each SEARCH_SCOPES as s, i (s)}
		{@const active = Math.round(f) === i}
		<button
			type="button"
			data-scope-tab={s}
			class="flex-1 bg-transparent px-2 py-2 text-sm font-medium {active
				? 'text-accent'
				: 'text-neutral-content/70'} {pager.dragging ? '' : 'transition-colors duration-200'}"
			aria-current={active ? 'page' : undefined}
			onclick={() => switchScope(s)}
		>
			{searchScopeLabel(s, tSearch)}
		</button>
	{/each}
	<span
		class="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-accent"
		style={underlineStyle}
	>
	</span>
</nav>
