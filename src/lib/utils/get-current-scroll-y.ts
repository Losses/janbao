// src/lib/utils/get-current-scroll-y.ts
/**
 * Read the current vertical scroll position of the active scrolling
 * surface. On mobile the scroll-chrome layout uses
 * `.detail-scroll-pane` as its scroll container; on desktop the
 * window scrolls. Returns 0 during SSR (no document).
 */
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
