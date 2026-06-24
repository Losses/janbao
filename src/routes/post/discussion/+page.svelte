<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import LexicalEditor from '$lib/components/organisms/LexicalEditorLazy.svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { isLexicalEmpty, MAX_CONTENT_SIZE } from '$lib/utils/lexical';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { getPageThemeStore } from '$lib/stores/page-theme.svelte';
	import { buildThemeOptions, SITE_DEFAULT_THEME } from '$lib/ui/prefs';
	import type { PageData } from './$types';

	const online = getOnlineStore();
	const pageTheme = getPageThemeStore();

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const categories = $derived(data.categories);
	const defaultCategorySlug = $derived(data.defaultCategorySlug);
	const draftContent = $derived(data.draftContent);
	// When the user blocks post themes, the theme selector is hidden and the
	// category selector goes full-width; the preview effect is also skipped.
	const blockPostTheme = $derived(data.user?.uiPreferences.blockPostTheme === true);

	let title = $state('');
	let categorySlug = $state('');
	let themeName = $state('');
	let contentJson = $state('');
	let isSubmitting = $state(false);
	let isPreview = $state(false);
	let isSavingManualDraft = $state(false);
	let showSaveSuccess = $state(false);
	let publishForm: HTMLFormElement | undefined = $state();

	const currentTheme = $derived(
		themeName || categories.find((c) => c.slug === categorySlug)?.themeName || SITE_DEFAULT_THEME
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

	// Reactive Theme Preview. Publishes the form's current theme as a page-level
	// override so the root layout (the single owner of <html data-theme>) applies
	// it - no capture/restore needed, clearing the override on unmount resumes the
	// interface theme. Gated on blockPostTheme: a blocking user never previews a
	// per-thread theme (the interface theme carries through the compose page).
	$effect(() => {
		if (blockPostTheme) return;
		pageTheme.set(currentTheme);
		return () => pageTheme.clear();
	});

	const themesList = $derived(buildThemeOptions(t));

	async function saveDraftManual() {
		if (!online.online) return;
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
			<h1 class="page-title">
				{t.sidebar.createDiscussion}
			</h1>
		</div>

		<!-- Main form -->
		{#if categories.length > 0}
			<form
				method="POST"
				action="?/publish"
				bind:this={publishForm}
				use:enhance={({ cancel }) => {
					if (isSubmitting) {
						cancel();
						return;
					}
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
							alert(result.data.error || t.discussion.publishFailed);
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

				<!-- Selectors row. When post themes are blocked the theme selector
				     disappears and the category selector spans the full row. -->
				<div class="grid grid-cols-1 {blockPostTheme ? '' : 'md:grid-cols-2'} gap-4">
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

					{#if !blockPostTheme}
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
					{/if}
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
								onSubmit={() => {
									if (!isSubmitting && online.online) publishForm?.requestSubmit();
								}}
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
								<LexicalRenderer {contentJson} {t} />
							{:else}
								<p class="text-base-content/40 italic">{t.discussion.previewEmpty}</p>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Bottom Actions Row -->
				<div
					class="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-base-300"
				>
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
									isSavingManualDraft ||
									!online.online}
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
								isPreview ||
								!online.online}
						>
							{#if isSubmitting}
								<span class="loading loading-spinner loading-xs"></span>
							{/if}
							{t.editor.publish}
						</button>
					</div>
				</div>
			</form>
		{:else}
			<div class="bg-base-200 p-6 text-center text-base-content/70 rounded-box">
				{t.discussion.noPermission}
			</div>
		{/if}
	</div>
</DualColumnLayout>
