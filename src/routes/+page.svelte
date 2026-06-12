<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';

	import type { PageData } from './$types';

	let { data } = $props<{
		data: PageData;
	}>();

	const t = $derived(data.t);
	const user = $derived(data.user);

	let isDrawerOpen = $state(false);
</script>

<svelte:head>
	<title>Home - Janbao</title>
</svelte:head>

{#snippet sidebar()}
	<div class="card bg-base-200 border border-base-300 shadow-sm p-4 space-y-4">
		{#if user}
			<div class="flex items-center gap-3">
				<div class="avatar placeholder">
					<div class="bg-neutral text-neutral-content rounded-full w-12">
						<span class="text-xl">{user.displayName[0].toUpperCase()}</span>
					</div>
				</div>
				<div>
					<h3 class="font-bold text-base">{user.displayName}</h3>
					<span class="badge badge-sm badge-outline">{user.groupSlug}</span>
				</div>
			</div>
			<div class="divider my-1"></div>
			<div class="flex flex-col gap-2">
				<a href="/entry/signout" class="btn btn-sm btn-outline btn-warning w-full"
					>{t.nav.signout}</a
				>
			</div>
		{:else}
			<div class="space-y-2">
				<h3 class="font-semibold text-sm text-base-content/70">Welcome to Janbao</h3>
				<div class="flex gap-2">
					<a href="/entry/signin" class="btn btn-sm btn-primary flex-1">{t.nav.signin}</a>
					<a href="/entry/register" class="btn btn-sm btn-outline flex-1">{t.nav.register}</a>
				</div>
			</div>
		{/if}
	</div>
{/snippet}

<DualColumnLayout {sidebar} bind:isDrawerOpen>
	<div class="space-y-6">
		<!-- Mobile Header Toolbar -->
		<div
			class="flex items-center justify-between md:hidden bg-base-200 border border-base-300 p-3 rounded-lg"
		>
			<span class="font-bold text-lg">Janbao</span>
			<button onclick={() => (isDrawerOpen = true)} class="btn btn-sm btn-ghost avatar placeholder">
				<div class="bg-neutral text-neutral-content rounded-full w-8">
					{#if user}
						<span>{user.displayName[0].toUpperCase()}</span>
					{:else}
						<span>G</span>
					{/if}
				</div>
			</button>
		</div>

		<div class="hero bg-base-200 border border-base-300 rounded-xl p-8 shadow-sm">
			<div class="hero-content text-center">
				<div class="max-w-md">
					<h1 class="text-4xl font-extrabold text-neutral-content">{t.common.welcome}</h1>
					<p class="py-6 text-base-content/85">
						{#if user}
							Logged in as <strong class="text-primary">{user.displayName}</strong> ({user.email}).
							Last active: {new Date(user.lastActiveTime).toLocaleTimeString()}.
						{:else}
							Welcome to the Janbao Forum System. Please sign in or register to participate in
							discussions.
						{/if}
					</p>
				</div>
			</div>
		</div>
	</div>
</DualColumnLayout>
