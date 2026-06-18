/**
 * Online Store - module-level reactive flag for whether the browser currently
 * reports a network connection (`navigator.onLine`). Seeded/updated by the root
 * layout's `online`/`offline` listeners; consumed anywhere a server-dependent
 * affordance needs to grey out while offline (C03 disable sweep).
 *
 * Defaults to `true` (online): SSR has no `navigator`, and the disabled state
 * only matters client-side when actually offline.
 */
type SetOnlineFn = (value: boolean) => void;

interface OnlineStore {
	readonly online: boolean;
	setOnline: SetOnlineFn;
}

let online = $state(true);

function setOnline(value: boolean): void {
	online = value;
}

export function getOnlineStore(): OnlineStore {
	return {
		get online() {
			return online;
		},
		setOnline
	};
}
