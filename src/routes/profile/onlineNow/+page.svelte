<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import SettingsSidebar from '$lib/components/molecules/SettingsSidebar.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { ApiResult, FeedbackMessage } from '$lib/types/api';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const user = $derived(data.user);
	const profileT = $derived(t.profile);

	// svelte-ignore state_referenced_locally
	let isStealth = $state(data.isStealth);
	let saving = $state(false);
	let message = $state<FeedbackMessage | null>(null);

	async function toggleStealth() {
		saving = true;
		message = null;

		try {
			const res = await fetch('/api/profile/stealth', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isStealth: !isStealth })
			});

			const result: ApiResult = await res.json();
			if (result.success) {
				isStealth = !isStealth;
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
	<div class="space-y-6">
		<h1 class="text-2xl font-bold border-b border-base-300 pb-4">
			{profileT.stealthSettings}
		</h1>

		{#if message}
			<div
				class="alert {message.type === 'success' ? 'alert-primary' : 'alert-warning'}"
				role="alert"
			>
				{message.text}
			</div>
		{/if}

		<div class="card bg-base-100 border border-base-200 rounded-xl p-6 shadow-sm space-y-4">
			<p class="text-sm text-base-content/70">
				{profileT.stealthDescription}
			</p>

			<div class="flex items-center justify-between p-4 bg-base-200/50 rounded-lg">
				<div>
					<p class="font-medium text-base-content">
						{profileT.stealthMode}
					</p>
					<p class="text-sm text-base-content/60">
						{isStealth ? profileT.stealthActive : profileT.stealthInactive}
					</p>
				</div>
				<button
					class="btn btn-sm {isStealth ? 'btn-warning' : 'btn-primary'}"
					onclick={toggleStealth}
					disabled={saving}
				>
					{isStealth ? profileT.disableStealth : profileT.enableStealth}
				</button>
			</div>
		</div>
	</div>
</DualColumnLayout>
