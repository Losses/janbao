<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditor.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { isLexicalEmpty, MAX_CONTENT_SIZE } from '$lib/utils/lexical';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const categories = $derived(data.categories);
	const defaultCategorySlug = $derived(data.defaultCategorySlug);
	const draftContent = $derived(data.draftContent);

	let title = $state('');
	let categorySlug = $state('');
	let themeName = $state('');
	let contentJson = $state('');
	let isSubmitting = $state(false);
	let isPreview = $state(false);
	let isSavingManualDraft = $state(false);
	let showSaveSuccess = $state(false);

	const currentTheme = $derived(
		themeName || categories.find((c) => c.slug === categorySlug)?.themeName || 'huoxin'
	);

	// Sync categorySlug with default when data loads
	$effect(() => {
		if (defaultCategorySlug && !categorySlug) {
			categorySlug = defaultCategorySlug;
		}
	});

	// Reactively sync contentJson with recovered draftContent
	$effect(() => {
		if (draftContent) {
			contentJson = draftContent;
		}
	});

	// Reactive Theme Preview
	$effect(() => {
		if (typeof document === 'undefined') return;
		const originalTheme = document.documentElement.getAttribute('data-theme');
		return () => {
			if (originalTheme) {
				document.documentElement.setAttribute('data-theme', originalTheme);
			} else {
				document.documentElement.removeAttribute('data-theme');
			}
		};
	});

	$effect(() => {
		if (typeof document === 'undefined') return;
		document.documentElement.setAttribute('data-theme', currentTheme);
	});

	const themesList = $derived([
		{ value: '', label: t.theme.defaultTheme },
		{ value: 'light', label: t.theme.light },
		{ value: 'dark', label: t.theme.dark },
		{ value: 'cupcake', label: t.theme.cupcake },
		{ value: 'bumblebee', label: t.theme.bumblebee },
		{ value: 'emerald', label: t.theme.emerald },
		{ value: 'corporate', label: t.theme.corporate },
		{ value: 'synthwave', label: t.theme.synthwave },
		{ value: 'retro', label: t.theme.retro },
		{ value: 'cyberpunk', label: t.theme.cyberpunk },
		{ value: 'valentine', label: t.theme.valentine },
		{ value: 'halloween', label: t.theme.halloween },
		{ value: 'garden', label: t.theme.garden },
		{ value: 'forest', label: t.theme.forest },
		{ value: 'aqua', label: t.theme.aqua },
		{ value: 'lofi', label: t.theme.lofi },
		{ value: 'pastel', label: t.theme.pastel },
		{ value: 'fantasy', label: t.theme.fantasy },
		{ value: 'wireframe', label: t.theme.wireframe },
		{ value: 'black', label: t.theme.black },
		{ value: 'luxury', label: t.theme.luxury },
		{ value: 'dracula', label: t.theme.dracula },
		{ value: 'cmyk', label: t.theme.cmyk },
		{ value: 'autumn', label: t.theme.autumn },
		{ value: 'business', label: t.theme.business },
		{ value: 'acid', label: t.theme.acid },
		{ value: 'lemonade', label: t.theme.lemonade },
		{ value: 'night', label: t.theme.night },
		{ value: 'coffee', label: t.theme.coffee },
		{ value: 'winter', label: t.theme.winter },
		{ value: 'dim', label: t.theme.dim },
		{ value: 'nord', label: t.theme.nord },
		{ value: 'sunset', label: t.theme.sunset },
		{ value: 'caramellatte', label: t.theme.caramellatte },
		{ value: 'abyss', label: t.theme.abyss },
		{ value: 'silk', label: t.theme.silk }
	]);

	async function saveDraftManual() {
		if (isLexicalEmpty(contentJson) || isSavingManualDraft) return;
		isSavingManualDraft = true;
		try {
			const res = await fetch('/api/drafts/save', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					contextType: 'discussion',
					contextId: 'new',
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
	<title>{formatTitle(t.sidebar.createDiscussion)}</title>
</svelte:head>

<DualColumnLayout {t}>
	<div class="space-y-3 py-2">
		<!-- Header -->
		<div class="border-b border-base-300 pb-4">
			<h1 class="text-3xl font-extrabold tracking-tight text-base-content">
				{t.sidebar.createDiscussion}
			</h1>
		</div>

		<!-- Main form -->
		<form
			method="POST"
			action="?/publish"
			use:enhance={() => {
				isSubmitting = true;
				return async ({ result }) => {
					isSubmitting = false;
					if (result.type === 'redirect') {
						goto(result.location);
					} else if (result.type === 'failure') {
						alert(result.data?.error || t.discussion.publishFailed);
					}
				};
			}}
			class="space-y-4"
		>
			<!-- Title Input -->
			<div class="form-control w-full">
				<label class="label" for="title-input">
					<span class="label-text font-bold text-base-content">{t.discussion.title}</span>
				</label>
				<input
					id="title-input"
					type="text"
					name="title"
					bind:value={title}
					placeholder={t.discussion.titlePlaceholder}
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
						<span class="label-text font-bold text-base-content">{t.discussion.category}</span>
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
						<span class="label-text font-bold text-base-content font-medium">
							{t.theme.customTheme}
						</span>
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
					<span class="label-text font-bold text-base-content">{t.discussion.content}</span>
				</label>
				<input type="hidden" name="contentJson" value={contentJson} />

				<div class={isPreview ? 'hidden' : ''} id="editor-block">
					{#key draftContent}
						<LexicalEditor
							contextType="discussion"
							contextId={0}
							initialContent={draftContent}
							onContentChange={(json) => (contentJson = json)}
							placeholder={t.editor.placeholder}
							{t}
						/>
					{/key}
				</div>

				{#if isPreview}
					<div
						class="border border-base-300 rounded-box p-5 bg-base-100 min-h-[200px] shadow-inner"
					>
						{#if contentJson}
							<LexicalRenderer {contentJson} />
						{:else}
							<p class="text-base-content/40 italic">{t.discussion.previewEmpty}</p>
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
							disabled={isLexicalEmpty(contentJson) ||
								contentJson.length > MAX_CONTENT_SIZE ||
								isSubmitting ||
								isSavingManualDraft}
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
						disabled={!title.trim() ||
							isLexicalEmpty(contentJson) ||
							contentJson.length > MAX_CONTENT_SIZE ||
							isSubmitting ||
							isPreview}
					>
						{#if isSubmitting}
							<span class="loading loading-spinner loading-xs"></span>
						{/if}
						{t.editor.publish}
					</button>
				</div>
			</div>
		</form>
	</div>
</DualColumnLayout>
