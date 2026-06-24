// Page-Theme Store - module-level reactive override published by a page that
// carries its own theme (the discussion thread page, when the user has not
// blocked post themes). The root layout reads this alongside the user's
// interface theme in a SINGLE effect, so <html data-theme> has one owner and
// there is no ordering race between a layout effect and a deeper page effect.
//
// The discussion page sets the thread theme on mount and clears it on unmount;
// while set, it wins over the interface theme. Cleared (null) everywhere else,
// so the interface theme (or the site default, when the interface theme is
// empty) applies. Reactive: the root effect re-applies the moment a page
// publishes or clears its override, independent of component mount order.

import type { VoidHandler } from '$lib/types/handlers';

type SetThemeHandler = (theme: string | null) => void;

interface PageThemeStore {
	readonly current: string | null;
	set: SetThemeHandler;
	clear: VoidHandler;
}

let override = $state<string | null>(null);

function set(theme: string | null): void {
	override = theme;
}

function clear(): void {
	override = null;
}

export function getPageThemeStore(): PageThemeStore {
	return {
		get current() {
			return override;
		},
		set,
		clear
	};
}
