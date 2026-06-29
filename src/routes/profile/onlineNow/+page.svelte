<script lang="ts">
	import GesturePageLayout from '$lib/components/templates/GesturePageLayout.svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import SettingsSidebar from '$lib/components/molecules/SettingsSidebar.svelte';
	import PageTitle from '$lib/components/molecules/PageTitle.svelte';
	import SettingsToggle from '$lib/components/molecules/SettingsToggle.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { ApiResult, FeedbackMessage } from '$lib/types/api';
	import type { PageData } from './$types';
	import { getOnlineStore } from '$lib/stores/online.svelte';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const user = $derived(data.user);
	const profileT = $derived(t.profile);
	const online = getOnlineStore();

	// svelte-ignore state_referenced_locally
	let isStealth = $state(data.isStealth);
	let saving = $state(false);
	let message = $state<FeedbackMessage | null>(null);

	async function setStealth(next: boolean) {
		saving = true;
		message = null;

		try {
			const res = await fetch('/api/profile/stealth', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isStealth: next })
			});

			const result: ApiResult = await res.json();
			if (result.success) {
				isStealth = next;
				message = { type: 'success', text: t.common.success };
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
	<title>{formatTitle(profileT.stealthSettings)}</title>
</svelte:head>

{#snippet sidebar()}
	{#if user}
		<SettingsSidebar {user} {t} activeItem="stealthSettings" />
	{/if}
{/snippet}

<DualColumnLayout {sidebar} {user} {t}>
	<GesturePageLayout fallbackRoute="/profile/settings">
		<div class="space-y-3">
			<PageTitle title={profileT.stealthSettings} />

			{#if message}
				<div
					class="alert {message.type === 'success' ? 'alert-primary' : 'alert-warning'}"
					role="alert"
				>
					{message.text}
				</div>
			{/if}

			<div class="space-y-4">
				<p class="text-sm text-base-content/70">
					{profileT.stealthDescription}
				</p>

				<SettingsToggle
					label={profileT.stealthMode}
					description={isStealth ? profileT.stealthActive : profileT.stealthInactive}
					checked={isStealth}
					disabled={saving || !online.online}
					onchange={setStealth}
				/>
			</div>
		</div>
	</GesturePageLayout>
</DualColumnLayout>
