// DV07 C03 - PWA install detection store. Singleton matching `online.svelte.ts`:
// module-level `$state`, getter-based API. SSR-safe (no `window`/`navigator`
// at module load); the listeners attach on first access from a browser.
//
// Two signals matter for the offline-reading flow:
//  - `isInstalled`: drives the "auto-enable caching once on first installed-PWA
//    launch" guard in `+layout.svelte`. Computed from the standard
//    `(display-mode: standalone)` media query plus iOS Safari's legacy
//    `navigator.standalone` flag.
//  - `canPrompt` / `promptInstall()`: a future "Add to Home Screen" button can
//    surface the stashed `beforeinstallprompt` event (Chrome/Edge only). Stored
//    but not currently rendered in C03 - the auto-enable path keys off
//    `isInstalled` alone.

type PromptInstallFn = () => Promise<boolean>;

interface PwaInstallStore {
	readonly isInstalled: boolean;
	readonly canPrompt: boolean;
	promptInstall: PromptInstallFn;
}

// Minimal shape of the `beforeinstallprompt` event we actually use. Defining
// our own interface avoids the `as any` eslint ban (no DOM lib typings ship for
// BeforeInstallPromptEvent).
type PromptFn = () => Promise<void>;

type InstallPromptOutcome = 'accepted' | 'dismissed';

interface InstallPromptUserChoice {
	outcome: InstallPromptOutcome;
}

interface BeforeInstallPromptEvent extends Event {
	prompt: PromptFn;
	userChoice: Promise<InstallPromptUserChoice>;
}

interface NavigatorStandalone {
	standalone?: boolean;
}

interface DeferredPrompt {
	readonly event: BeforeInstallPromptEvent;
}

let isInstalled = $state(false);
let deferred: DeferredPrompt | undefined = $state(undefined);
let listenersBound = false;

function readNavigatorStandalone(): boolean {
	// iOS Safari exposes `navigator.standalone` (boolean) outside the DOM lib
	// typings. Read via a structural cast on the navigator itself - not `as
	// any` (banned by eslint). Returns false on any non-iOS / unsupported
	// browser, including SSR (typeof navigator guard).
	if (typeof navigator === 'undefined') return false;
	const standalone = (navigator as Navigator & NavigatorStandalone).standalone;
	return standalone === true;
}

function computeIsInstalled(): boolean {
	if (typeof window === 'undefined') return false;
	const media = window.matchMedia?.('(display-mode: standalone)');
	if (media?.matches) return true;
	return readNavigatorStandalone();
}

function bindListenersOnce(): void {
	if (listenersBound || typeof window === 'undefined') return;
	listenersBound = true;

	// Seed from the live environment now (covers a tab that was launched
	// already in standalone mode before this module was imported).
	isInstalled = computeIsInstalled();

	// `display-mode` changes when the user installs / uninstalls the PWA while
	// the tab is open. Query the media list inside the listener so a missing
	// matchMedia (very old browser) is tolerated.
	const mq = window.matchMedia?.('(display-mode: standalone)');
	mq?.addEventListener('change', () => {
		isInstalled = computeIsInstalled();
	});

	window.addEventListener('appinstalled', () => {
		isInstalled = true;
	});

	window.addEventListener('beforeinstallprompt', (raw: Event) => {
		// The event only fires on Chromium; on other browsers `canPrompt` stays
		// false and the install affordance is simply never offered.
		const evt = raw as BeforeInstallPromptEvent;
		if (typeof evt.prompt === 'function' && evt.userChoice instanceof Promise) {
			deferred = { event: evt };
			// Clear the stashed event after the user resolves the prompt so a
			// second `promptInstall()` call is a no-op rather than a rejection.
			void evt.userChoice.then(() => {
				deferred = undefined;
			});
		}
	});
}

async function promptInstall(): Promise<boolean> {
	if (typeof window === 'undefined' || deferred === undefined) return false;
	try {
		await deferred.event.prompt();
		const choice = await deferred.event.userChoice;
		return choice.outcome === 'accepted';
	} catch {
		return false;
	} finally {
		// The browser invalidates the event after `prompt()` resolves; drop our
		// reference regardless of outcome.
		deferred = undefined;
	}
}

export function getPwaInstallStore(): PwaInstallStore {
	// Bind listeners on first browser access. Calling this from a component
	// init or `onMount` is safe in SSR (the typeof-window guard short-circuits).
	bindListenersOnce();
	return {
		get isInstalled() {
			return isInstalled;
		},
		get canPrompt() {
			return deferred !== undefined;
		},
		promptInstall
	};
}
