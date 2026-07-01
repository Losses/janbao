/**
 * Viewport-Lock - Module refcount for `html.fixed-viewport`, the class that locks
 * the document window (`app.css`: html/body become position:fixed; overflow:hidden;
 * the DualColumnLayout chain fills 100% height) so a route can scroll inside a
 * full-height internal panel instead of the window.
 *
 * Two route-layouts own the class: `GesturePageLayout` (deep pages) and
 * `MobileTabPager` (tab roots). They are never co-mounted at steady state, but a
 * `/`↔`/discussion` SPA swap unmounts one and mounts the other, and Svelte does
 * not guarantee mount-before-destroy across that boundary. A plain add/remove
 * pair can dip the class to absent for one painted frame (the source's release at
 * 1→0 lands before the destination's acquire at 0→1), collapsing the height chain
 * mid-swap. The refcount keeps the class present while ANY layout holds it.
 *
 * Removal at 1→0 is deferred by a microtask: if a destination's acquire lands in
 * the same microtask checkpoint (the swap's mount flushes before the microtask),
 * count returns above 0 and the class is never removed. This eliminates the
 * one-frame flicker structurally, not by Svelte ordering luck.
 *
 * Each caller tracks its own per-instance `held` flag: `GesturePageLayout`
 * toggles the class on matchMedia resize (it stays mounted across mobile↔desktop),
 * so it acquires on a `!held → mobile` transition and releases on a `held →
 * desktop` transition (and on cleanup if held), never double-counting. A
 * mobile-only caller (`MobileTabPager`) uses plain mount/destroy acquire/release.
 *
 * `import.meta.hot?.dispose` zeroes the counter and removes the class so a
 * module-only HMR re-converges on the next consumer remount/navigation.
 */
let count = 0;
let pendingRemoval = false;

function syncClass(): void {
	if (typeof document === 'undefined') return;
	if (count > 0) {
		document.documentElement.classList.add('fixed-viewport');
		// An acquire cancels any deferred removal (count returned above 0 before the
		// microtask fired): the queued microtask re-checks count and no-ops.
		pendingRemoval = false;
		return;
	}
	if (pendingRemoval) return;
	pendingRemoval = true;
	queueMicrotask(() => {
		pendingRemoval = false;
		if (count === 0 && typeof document !== 'undefined') {
			document.documentElement.classList.remove('fixed-viewport');
		}
	});
}

function acquire(): void {
	count++;
	syncClass();
}

function release(): void {
	if (count > 0) count--;
	syncClass();
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		count = 0;
		pendingRemoval = false;
		if (typeof document !== 'undefined') {
			document.documentElement.classList.remove('fixed-viewport');
		}
	});
}

export const viewportLock: { acquire: () => void; release: () => void } = {
	acquire,
	release
};
