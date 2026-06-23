// src/lib/stores/page-scroll.svelte.ts
class PageScrollStore {
	#scrolls = $state<Record<string, number>>({});

	capture(pathname: string, y: number) {
		this.#scrolls[pathname] = y;
	}

	get(pathname: string): number {
		return this.#scrolls[pathname] || 0;
	}
}

let pageScrollStoreInstance: PageScrollStore;

export function getPageScrollStore(): PageScrollStore {
	if (!pageScrollStoreInstance) {
		pageScrollStoreInstance = new PageScrollStore();
	}
	return pageScrollStoreInstance;
}

export function getCurrentScrollY(): number {
	if (typeof document !== 'undefined') {
		const isMobile = window.matchMedia('(max-width: 767px)').matches;
		if (isMobile) {
			const pane = document.querySelector('.detail-scroll-pane');
			if (pane) return pane.scrollTop;
		}
	}
	return typeof window !== 'undefined' ? window.scrollY : 0;
}
