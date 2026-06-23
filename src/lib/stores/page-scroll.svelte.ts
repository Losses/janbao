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
