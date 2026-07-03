/**
 * forward-edge - the pure (runes-free) resolver for the MobileTabPager forward
 * edge's commit target. The forward edge is a general mechanism: at any tab it
 * resolves to the next primary tab, OR to the current tab's declared deep
 * neighbour, OR to nothing (the edge rubber-bands). The existing Discussions ->
 * Activity and Activity -> Messages forward swipes resolve to a tab target
 * through this same function, so the deep target (Messages -> /search) is a peer
 * outcome rather than a last-tab special case. Only the data (`forwardDeepNeighbour`
 * on `TabDef`) decides which tab resolves to a deep target; no route literal
 * lives here.
 *
 * Pure so it is unit-testable under bun:test (memory `bun-test-no-runes-loader`:
 * no `$state` under bun:test).
 */
import { MOBILE_TAB_DEFS } from './tab-config';

/** Forward edge advances to the next primary tab. */
export interface ForwardTabTarget {
	readonly kind: 'tab';
	readonly index: number;
}

/** Forward edge commits to the current tab's declared deep neighbour route. */
export interface ForwardDeepTarget {
	readonly kind: 'deep';
	readonly href: string;
}

/** The forward edge's commit target, or null when the edge has no destination. */
export type ForwardTarget = ForwardTabTarget | ForwardDeepTarget;

/**
 * Resolve the forward edge's commit target at `activeIndex`: the next primary
 * tab when one exists, otherwise the current tab's `forwardDeepNeighbour` when
 * declared, otherwise null (the edge rubber-bands).
 */
export function resolveForwardTarget(activeIndex: number): ForwardTarget | null {
	if (activeIndex < MOBILE_TAB_DEFS.length - 1) {
		return { kind: 'tab', index: activeIndex + 1 };
	}
	const href = MOBILE_TAB_DEFS[activeIndex]?.forwardDeepNeighbour;
	return href ? { kind: 'deep', href } : null;
}
