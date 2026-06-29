<script lang="ts">
	import GesturePageLayout from '$lib/components/templates/GesturePageLayout.svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import SettingsSidebar from '$lib/components/molecules/SettingsSidebar.svelte';
	import SettingsToggle from '$lib/components/molecules/SettingsToggle.svelte';
	import PageTitle from '$lib/components/molecules/PageTitle.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { buildThemeOptions, SITE_DEFAULT_THEME } from '$lib/ui/prefs';
	import type { ApiResult, FeedbackMessage } from '$lib/types/api';
	import type { PageData } from './$types';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { getUiPrefsStore } from '$lib/stores/ui-prefs.svelte';
	import type { UiPreferences } from '$lib/ui/prefs';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const profileT = $derived(t.profile);
	const appearanceT = $derived(profileT.appearanceSettings);
	const user = $derived(data.user);
	const online = getOnlineStore();
	const uiPrefsStore = getUiPrefsStore();

	// Local editable copy of the saved prefs. Bound to the controls; submitted
	// as a whole on Save. state_referenced_locally: seeded from server data.
	// svelte-ignore state_referenced_locally
	let prefs = $state<UiPreferences>({ ...data.uiPreferences });
	let saving = $state(false);
	let message = $state<FeedbackMessage | null>(null);

	const themesList = $derived(buildThemeOptions(t));

	// Live theme preview while on this page. The apply effect below shadows the
	// root layout's <html data-theme> with the local (uncommitted) selection so
	// the user sees each option immediately. On unmount the first effect
	// re-asserts the *committed* interface theme from the app-wide store: the
	// root layout's single-owner effect does not re-fire on client-side
	// navigation, so something has to put data-theme back to the saved value
	// (which a save during this visit may have just changed) when this page leaves.
	$effect(() => {
		if (typeof document === 'undefined') return;
		return () => {
			document.documentElement.setAttribute(
				'data-theme',
				uiPrefsStore.prefs.interfaceTheme || SITE_DEFAULT_THEME
			);
		};
	});

	$effect(() => {
		if (typeof document === 'undefined') return;
		document.documentElement.setAttribute('data-theme', prefs.interfaceTheme || SITE_DEFAULT_THEME);
	});

	async function handleSave() {
		saving = true;
		message = null;

		try {
			const res = await fetch('/api/profile/ui-preferences', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(prefs)
			});

			const result: ApiResult = await res.json();
			if (result.success) {
				message = { type: 'success', text: t.common.success };
				// Propagate the saved prefs to the app-wide store so the root
				// layout's theme effect re-applies them without a reload.
				uiPrefsStore.update({ ...prefs });
			} else {
				message = { type: 'error', text: result.error || t.common.error };
			}
		} catch {
			message = { type: 'error', text: t.auth.networkError };
		}

		saving = false;
	}
</script>

<svelte:head>
	<title>{formatTitle(appearanceT.title)}</title>
</svelte:head>

{#snippet sidebar()}
	{#if user}
		<SettingsSidebar {user} {t} activeItem="appearanceSettings" />
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<GesturePageLayout fallbackRoute="/profile/settings">
		<div class="space-y-6">
			<PageTitle title={appearanceT.title} />

			{#if message}
				<div
					class="alert {message.type === 'success' ? 'alert-primary' : 'alert-warning'}"
					role="alert"
				>
					{message.text}
				</div>
			{/if}

			<fieldset disabled={!online.online}>
				<div class="space-y-6">
					<!-- Interface theme selector. Empty value = follow the site default;
					     any other value is applied as <html data-theme> site-wide. -->
					<div class="form-control w-full">
						<label class="label" for="interface-theme-select">
							<span class="label-text font-bold text-base-content">
								{appearanceT.interfaceTheme}
							</span>
						</label>
						<select
							id="interface-theme-select"
							class="select select-bordered w-full"
							bind:value={prefs.interfaceTheme}
							disabled={saving}
						>
							{#each themesList as th (th.value)}
								<option value={th.value}>{th.label}</option>
							{/each}
						</select>
					</div>

					<SettingsToggle
						label={appearanceT.blockPostTheme}
						description={appearanceT.blockPostThemeDesc}
						checked={prefs.blockPostTheme}
						disabled={saving}
						onchange={(v) => (prefs.blockPostTheme = v)}
					/>
				</div>
			</fieldset>

			<div class="pt-2">
				<button class="btn btn-primary" onclick={handleSave} disabled={saving}>
					{saving ? t.common.saving : t.common.submit}
				</button>
			</div>
		</div>
	</GesturePageLayout>
</DualColumnLayout>
