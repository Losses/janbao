<script lang="ts">
	import { onMount } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import SettingsSidebar from '$lib/components/molecules/SettingsSidebar.svelte';
	import SettingsToggle from '$lib/components/molecules/SettingsToggle.svelte';
	import PageTitle from '$lib/components/molecules/PageTitle.svelte';
	import SectionTitle from '$lib/components/molecules/SectionTitle.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { PageData } from './$types';
	import { getOfflinePrefsStore } from '$lib/stores/offline-prefs.svelte';
	import { getPwaInstallStore } from '$lib/stores/pwa-install.svelte';
	import type {
		OfflineCategoryToggles,
		OfflineRefreshIntervalDays,
		OfflineReplyDepth
	} from '$lib/offline/prefs';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const user = $derived(data.user);
	const profileT = $derived(t.profile);
	const offlineT = $derived(profileT.offlineReading);

	const prefsStore = getOfflinePrefsStore();
	const pwa = getPwaInstallStore();

	// Derived views over the live store so the form tracks updates made
	// elsewhere (e.g. the auto-enable-on-install hook in +layout.svelte).
	const enabled = $derived(prefsStore.prefs.enabled);
	const categories = $derived(prefsStore.prefs.categories);
	const depth = $derived(prefsStore.prefs.depth);
	const refreshIntervalDays = $derived(prefsStore.prefs.refreshIntervalDays);
	const passthrough = $derived(prefsStore.prefs.passthrough);

	const REFRESH_OPTIONS: readonly OfflineRefreshIntervalDays[] = [1, 2, 3, 5, 7];
	const DEPTHS: readonly OfflineReplyDepth[] = ['first', 'firstLast', 'all'];

	type OfflineFormMessageKind = 'synced' | 'error';
	interface OfflineFormMessage {
		kind: OfflineFormMessageKind;
		text: string;
	}

	let message = $state<OfflineFormMessage | null>(null);

	onMount(() => {
		// Optional nicety: if the user landed here with caching already on and
		// we're online, give the cache a chance to populate so the form's
		// categories reflect reality. Not on the auto-enable path; purely
		// convenience for an enabled install that hasn't synced yet.
		if (enabled && typeof navigator !== 'undefined' && navigator.onLine) {
			void import('$lib/offline/sync-orchestrator')
				.then(({ runSync }) => runSync())
				.catch((err: unknown) => console.error('[offline] sync failed:', err));
		}
	});

	function toggleCategory(key: 'latest' | 'mostViewed' | 'mostReplied'): void {
		// Build the next toggles object explicitly so the merge stays typed as
		// OfflineCategoryToggles (an inline `{ [key]: value }` widens to an
		// index signature and fails the prop-type check).
		const next: OfflineCategoryToggles = {
			latest: categories.latest,
			mostViewed: categories.mostViewed,
			mostReplied: categories.mostReplied
		};
		next[key] = !next[key];
		prefsStore.update({ categories: next });
		triggerSyncIfOnline();
	}

	function setDepth(value: OfflineReplyDepth): void {
		prefsStore.update({ depth: value });
		triggerSyncIfOnline();
	}

	function setRefreshInterval(value: OfflineRefreshIntervalDays): void {
		prefsStore.update({ refreshIntervalDays: value });
	}

	function setPassthrough(value: boolean): void {
		prefsStore.update({ passthrough: value });
	}

	function setEnabled(value: boolean): void {
		prefsStore.update({ enabled: value });
		triggerSyncIfOnline();
	}

	function triggerSyncIfOnline(): void {
		// Nicety (deliverable #6): after a pref change that could add cache
		// content, run a sync so the user sees it populate without waiting for
		// the next scheduled tick. Guarded SSR/offline. A skipped sync (offline
		// or disabled) is a no-op - not an error - so we deliberately do not
		// set a message in that path.
		if (!prefsStore.prefs.enabled || typeof navigator === 'undefined' || !navigator.onLine) {
			return;
		}
		void import('$lib/offline/sync-orchestrator')
			.then(({ runSync }) => runSync())
			.then(() => {
				message = { kind: 'synced', text: offlineT.synced };
			})
			.catch((err: unknown) => {
				console.error('[offline] sync failed:', err);
				message = { kind: 'error', text: t.common.error };
			});
	}
</script>

<svelte:head>
	<title>{formatTitle(offlineT.title)}</title>
</svelte:head>

{#snippet sidebar()}
	{#if user}
		<SettingsSidebar {user} {t} activeItem="offlineReading" />
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<div class="space-y-3">
		<PageTitle title={offlineT.title} />

		{#if message}
			<div
				class="alert {message.kind === 'error' ? 'alert-warning' : 'alert-primary'}"
				role="alert"
			>
				{message.text}
			</div>
		{/if}

		<div class="space-y-4">
			<p class="text-sm text-base-content/70">
				{offlineT.description}
			</p>

			{#if pwa.isInstalled}
				<div class="alert alert-primary" role="status">
					{offlineT.installedHint}
				</div>
			{/if}

			<!-- Master enable toggle. When off, the sub-options below are not
			     rendered at all (not greyed out). -->
			<SettingsToggle
				label={offlineT.enable}
				description={enabled ? offlineT.enableActive : offlineT.enableInactive}
				checked={enabled}
				onchange={setEnabled}
			>
				<div class="space-y-2">
					<SectionTitle
						title={offlineT.categoriesTitle}
						description={offlineT.categoriesDescription}
					/>

					<div class="form-control">
						<label class="label cursor-pointer justify-start gap-3" for="offline-cat-latest">
							<input
								id="offline-cat-latest"
								type="checkbox"
								class="checkbox checkbox-sm checkbox-primary"
								checked={categories.latest}
								onchange={() => toggleCategory('latest')}
							/>
							<div>
								<span class="label-text font-medium">{offlineT.catLatest}</span>
								<p class="text-xs text-base-content/50">{offlineT.catLatestDesc}</p>
							</div>
						</label>
					</div>

					<div class="form-control">
						<label class="label cursor-pointer justify-start gap-3" for="offline-cat-most-viewed">
							<input
								id="offline-cat-most-viewed"
								type="checkbox"
								class="checkbox checkbox-sm checkbox-primary"
								checked={categories.mostViewed}
								onchange={() => toggleCategory('mostViewed')}
							/>
							<div>
								<span class="label-text font-medium">{offlineT.catMostViewed}</span>
								<p class="text-xs text-base-content/50">{offlineT.catMostViewedDesc}</p>
							</div>
						</label>
					</div>

					<div class="form-control">
						<label class="label cursor-pointer justify-start gap-3" for="offline-cat-most-replied">
							<input
								id="offline-cat-most-replied"
								type="checkbox"
								class="checkbox checkbox-sm checkbox-primary"
								checked={categories.mostReplied}
								onchange={() => toggleCategory('mostReplied')}
							/>
							<div>
								<span class="label-text font-medium">{offlineT.catMostReplied}</span>
								<p class="text-xs text-base-content/50">{offlineT.catMostRepliedDesc}</p>
							</div>
						</label>
					</div>
				</div>

				<div class="space-y-2">
					<SectionTitle title={offlineT.depthTitle} description={offlineT.depthDescription} />

					<div class="flex flex-col gap-2">
						{#each DEPTHS as option (option)}
							<label class="label cursor-pointer justify-start gap-3" for="offline-depth-{option}">
								<input
									id="offline-depth-{option}"
									type="radio"
									name="offline-depth"
									class="radio radio-sm radio-primary"
									checked={depth === option}
									onchange={() => setDepth(option)}
								/>
								<span class="label-text font-medium">
									{offlineT[`depth_${option}`]}
								</span>
							</label>
						{/each}
					</div>
				</div>

				<div class="space-y-2">
					<SectionTitle title={offlineT.refreshTitle} description={offlineT.refreshDescription} />
					<select
						class="select select-bordered select-sm w-full max-w-xs"
						value={refreshIntervalDays}
						onchange={(e) => {
							const parsed = Number(e.currentTarget.value);
							if (parsed === 1 || parsed === 2 || parsed === 3 || parsed === 5 || parsed === 7) {
								setRefreshInterval(parsed);
							}
						}}
					>
						{#each REFRESH_OPTIONS as days (days)}
							<option value={days}>{offlineT[`refresh_${days}`]}</option>
						{/each}
					</select>
				</div>

				<SettingsToggle
					label={offlineT.passthrough}
					description={offlineT.passthroughDesc}
					checked={passthrough}
					onchange={setPassthrough}
				/>
			</SettingsToggle>
		</div>
	</div>
</DualColumnLayout>
