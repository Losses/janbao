/**
 * Caches the rendered HTML of the last-viewed deep page (a thread, a messages
 * conversation, ...) so the MobileTabPager can preview it during a back-swipe
 * from a tab to that deep page. Without this, the back-swipe would reveal the
 * spatially-previous TAB (the Discussions list) instead of the actual page the
 * user is returning to.
 *
 * Same pattern as ListCacheStore: a singleton $state store, written by the page
 * on navigation-away, read by the pager on gesture. The cached HTML is the
 * app's own rendered content (safe to re-inject via {@html}); it is a visual
 * snapshot only (non-interactive) replaced by the real page on commit.
 */
class DeepPageSnapshotStore {
	#html = $state<string | null>(null);
	#pathname = $state<string | null>(null);

	get html(): string | null {
		return this.#html;
	}

	get pathname(): string | null {
		return this.#pathname;
	}

	get hasSnapshot(): boolean {
		return this.#html !== null;
	}

	capture(html: string, pathname: string): void {
		this.#html = html;
		this.#pathname = pathname;
	}

	clear(): void {
		this.#html = null;
		this.#pathname = null;
	}
}

let instance: DeepPageSnapshotStore | undefined;

export function getDeepPageSnapshotStore(): DeepPageSnapshotStore {
	if (!instance) instance = new DeepPageSnapshotStore();
	return instance;
}
