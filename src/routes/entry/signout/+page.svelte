<script lang="ts">
	import SingleColumnLayout from '$lib/components/templates/SingleColumnLayout.svelte';
	import AlertMessage from '$lib/components/AlertMessage.svelte';
	import { goto } from '$app/navigation';
	import { formatTitle } from '$lib/utils/title';
	import type { PageData } from './$types';
	import type { ApiResponse } from '$lib/types/api';

	let { data } = $props<{ data: PageData }>();
	const t = $derived(data.t);

	let loading = $state(false);
	let errorMessage = $state('');

	async function handleLogout() {
		loading = true;
		errorMessage = '';

		try {
			const res = await fetch('/api/auth/logout', {
				method: 'POST'
			});

			const result = (await res.json()) as ApiResponse;
			if (res.ok && result.success) {
				await goto('/', { invalidateAll: true });
			} else {
				errorMessage = result.error || t.auth.logoutConfirm;
			}
		} catch {
			errorMessage = t.auth.networkError;
		} finally {
			loading = false;
		}
	}

	function handleCancel() {
		if (typeof window !== 'undefined') {
			window.history.back();
		} else {
			goto('/');
		}
	}
</script>

<svelte:head>
	<title>{formatTitle(t.nav.signout)}</title>
</svelte:head>

<SingleColumnLayout>
	<div class="text-center space-y-4">
		<h2 class="text-3xl font-bold tracking-tight text-neutral-content">{t.nav.signout}</h2>
		<p class="text-base-content/75">{t.auth.logoutPrompt}</p>
	</div>

	<AlertMessage message={errorMessage} class="mt-4" />

	<div class="mt-8 flex flex-col gap-3">
		<button
			onclick={handleLogout}
			disabled={loading}
			class="btn btn-warning w-full text-base font-semibold"
		>
			{#if loading}
				<span class="loading loading-spinner"></span>
			{/if}
			{t.auth.logoutConfirm}
		</button>

		<button
			onclick={handleCancel}
			disabled={loading}
			class="btn btn-neutral w-full text-base font-semibold"
		>
			{t.auth.logoutCancel}
		</button>
	</div>
</SingleColumnLayout>
