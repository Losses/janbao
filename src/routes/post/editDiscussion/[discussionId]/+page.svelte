<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditor.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const discussion = $derived(data.discussion);
	const opContentJson = $derived(data.opContentJson);
	const categories = $derived(data.categories);
	const draftContent = $derived(data.draftContent);

	let title = $state('');
	let categorySlug = $state('');
	let themeName = $state('');
	let contentJson = $state('');
	let isSubmitting = $state(false);
	let isPreview = $state(false);
	let isSavingManualDraft = $state(false);
	let showSaveSuccess = $state(false);
	let loadedDiscussionId = $state<string | null>(null);

	$effect(() => {
		if (data.discussion && data.discussion.id !== loadedDiscussionId) {
			title = data.discussion.title;
			categorySlug = data.discussion.categorySlug;
			themeName = data.discussion.themeName || '';
			contentJson = '';
			loadedDiscussionId = data.discussion.id;
		}
	});

	const themesList = [
		{ value: '', label: 'Default theme' },
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' },
		{ value: 'cupcake', label: 'Cupcake' },
		{ value: 'bumblebee', label: 'Bumblebee' },
		{ value: 'emerald', label: 'Emerald' },
		{ value: 'synthwave', label: 'Synthwave' },
		{ value: 'cyberpunk', label: 'Cyberpunk' },
		{ value: 'valentine', label: 'Valentine' },
		{ value: 'aqua', label: 'Aqua' },
		{ value: 'luxury', label: 'Luxury' },
		{ value: 'dracula', label: 'Dracula' },
		{ value: 'business', label: 'Business' },
		{ value: 'night', label: 'Night' },
		{ value: 'coffee', label: 'Coffee' },
		{ value: 'winter', label: 'Winter' }
	];

	async function saveDraftManual() {
		if (!contentJson || isSavingManualDraft) return;
		isSavingManualDraft = true;
		try {
			const res = await fetch('/api/drafts/save', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					contextType: 'discussion',
					contextId: discussion.id,
					contentJson
				})
			});
			if (res.ok) {
				showSaveSuccess = true;
				setTimeout(() => {
					showSaveSuccess = false;
				}, 3000);
			}
		} catch (err) {
			console.error('Failed to save manual draft:', err);
		} finally {
			isSavingManualDraft = false;
		}
	}
</script>

<svelte:head>
	<title>{formatTitle(t.discussion.editDiscussion)}</title>
</svelte:head>

<DualColumnLayout {t}>
	<div class="space-y-6 py-2">
		<!-- Header -->
		<div class="border-b border-base-300 pb-4">
			<h1 class="text-3xl font-extrabold tracking-tight text-base-content">
				{t.discussion.editDiscussion}
			</h1>
		</div>

		<!-- Main form -->
		<form
			method="POST"
			action="?/update"
			use:enhance={() => {
				isSubmitting = true;
				return async ({ result }) => {
					isSubmitting = false;
					if (result.type === 'redirect') {
						goto(result.location);
					} else if (
						result.type === 'success' &&
						result.data &&
						'success' in result.data &&
						result.data.success === false
					) {
						alert(result.data.error || 'Failed to update discussion');
					} else if (result.type === 'failure') {
						alert(result.data?.error || 'Failed to update discussion');
					}
				};
			}}
			class="space-y-4"
		>
			<!-- Title Input -->
			<div class="form-control w-full">
				<label class="label" for="title-input">
					<span class="label-text font-bold text-base-content">Title</span>
				</label>
				<input
					id="title-input"
					type="text"
					name="title"
					bind:value={title}
					placeholder="Enter discussion title..."
					class="input input-bordered w-full text-lg focus:input-primary"
					required
					disabled={isSubmitting || isPreview}
				/>
			</div>

			<!-- Selectors row -->
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<!-- Category Selector -->
				<div class="form-control w-full">
					<label class="label" for="category-select">
						<span class="label-text font-bold text-base-content">Category</span>
					</label>
					<select
						id="category-select"
						name="categorySlug"
						bind:value={categorySlug}
						class="select select-bordered w-full"
						disabled={isSubmitting || isPreview}
						required
					>
						{#each categories as category (category.slug)}
							<option value={category.slug}>{category.title}</option>
						{/each}
					</select>
				</div>

				<!-- Theme Selector -->
				<div class="form-control w-full">
					<label class="label" for="theme-select">
						<span class="label-text font-bold text-base-content font-medium">Custom Theme</span>
					</label>
					<select
						id="theme-select"
						name="themeName"
						bind:value={themeName}
						class="select select-bordered w-full"
						disabled={isSubmitting || isPreview}
					>
						{#each themesList as th (th.value)}
							<option value={th.value}>{th.label}</option>
						{/each}
					</select>
				</div>
			</div>

			<!-- Content Editor -->
			<div class="form-control w-full">
				<label class="label" for="editor-block">
					<span class="label-text font-bold text-base-content">Content</span>
				</label>
				<input type="hidden" name="contentJson" value={contentJson} />

				<div class={isPreview ? 'hidden' : ''} id="editor-block">
					{#key loadedDiscussionId || discussion.id}
						<LexicalEditor
							contextType="discussion"
							contextId={discussion.id}
							initialContent={draftContent || opContentJson}
							onContentChange={(json) => (contentJson = json)}
							placeholder={t.editor.placeholder}
							{t}
						/>
					{/key}
				</div>

				{#if isPreview}
					<div class="border border-base-300 rounded-lg p-5 bg-base-100 min-h-[200px] shadow-inner">
						{#if contentJson}
							<LexicalRenderer {contentJson} />
						{:else}
							<p class="text-base-content/40 italic">Nothing to preview yet.</p>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Bottom Actions Row -->
			<div class="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-base-200">
				<!-- Left utilities -->
				<div class="flex items-center gap-2">
					<button
						type="button"
						onclick={() => (isPreview = !isPreview)}
						class="btn btn-sm {isPreview ? 'btn-active' : 'btn-outline'}"
						disabled={isSubmitting}
					>
						{t.editor.preview}
					</button>

					{#if !isPreview}
						<button
							type="button"
							onclick={saveDraftManual}
							class="btn btn-sm btn-ghost gap-2"
							disabled={!contentJson || isSubmitting || isSavingManualDraft}
						>
							{#if isSavingManualDraft}
								<span class="loading loading-spinner loading-xs"></span>
							{/if}
							{t.editor.saveDraft}
						</button>
						{#if showSaveSuccess}
							<span class="text-xs text-success font-medium transition-opacity duration-300">
								{t.editor.saved}
							</span>
						{/if}
					{/if}
				</div>

				<!-- Right submit -->
				<div class="flex items-center gap-2">
					<button
						type="submit"
						class="btn btn-primary"
						disabled={!title || !contentJson || isSubmitting || isPreview}
					>
						{#if isSubmitting}
							<span class="loading loading-spinner loading-xs"></span>
						{/if}
						{t.common.submit}
					</button>
				</div>
			</div>
		</form>
	</div>
</DualColumnLayout>
