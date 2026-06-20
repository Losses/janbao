<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { LexicalEditor } from 'lexical';
	import {
		$getSelection as getSelection,
		$isRangeSelection as isRangeSelection,
		$isTextNode as isTextNodeFn,
		FORMAT_TEXT_COMMAND
	} from 'lexical';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import {
		toggleBold,
		toggleItalic,
		toggleUnderline,
		toggleStrikethrough,
		formatParagraph,
		formatHeading,
		formatQuote,
		formatCode,
		formatBulletList,
		formatNumberedList,
		formatCheckList,
		InsertImage
	} from 'svelte-lexical';
	import { TOGGLE_LINK_COMMAND } from '@lexical/link';
	import { sanitizeUrl } from 'svelte-lexical';
	import { TOGGLE_SPOILER_COMMAND } from '$lib/types/editor-commands';
	import {
		mdiFormatBold,
		mdiFormatItalic,
		mdiFormatUnderline,
		mdiFormatStrikethrough,
		mdiFormatParagraph,
		mdiFormatHeader1,
		mdiFormatHeader2,
		mdiFormatHeader3,
		mdiFormatHeader4,
		mdiFormatQuoteClose,
		mdiCodeBraces,
		mdiFormatListBulleted,
		mdiFormatListNumbered,
		mdiFormatListChecks,
		mdiLink,
		mdiImage,
		mdiMarker,
		mdiEyeOff,
		mdiChevronDown,
		mdiClose,
		mdiUpload,
		mdiAlertCircle
	} from '@mdi/js';
	import type { TranslationDict } from '$lib/types/translation';
	import type { EditorPreferences } from '$lib/editor/prefs';

	interface Props {
		activeEditor: LexicalEditor;
		disableHeadings?: boolean;
		features: EditorPreferences;
		t: TranslationDict;
	}

	let { activeEditor, disableHeadings = false, features, t }: Props = $props();

	// A toolbar group renders only when at least one of its buttons is enabled,
	// and a divider renders only when both adjacent groups are visible - so a
	// fully-disabled group leaves no orphan separator.
	const showBlockGroup = $derived(
		!disableHeadings && (features.headings || features.quote || features.codeBlock)
	);
	const showInlineGroup = $derived(
		features.bold ||
			features.italic ||
			features.underline ||
			features.strikethrough ||
			features.highlight ||
			features.spoiler
	);
	const showListGroup = $derived(
		features.bulletList || features.numberedList || features.checklist
	);
	const showMediaGroup = $derived(features.link || features.autolink || features.image);

	// Retrieve stores from svelte-lexical's context
	const isBold = getContext<Writable<boolean>>('isBold');
	const isItalic = getContext<Writable<boolean>>('isItalic');
	const isUnderline = getContext<Writable<boolean>>('isUnderline');
	const isStrikethrough = getContext<Writable<boolean>>('isStrikethrough');
	const isLink = getContext<Writable<boolean>>('isLink');
	const blockType = getContext<Writable<string>>('blockType');

	// Custom format state tracking for highlight and spoiler (not provided by svelte-lexical)
	let isHighlight = $state(false);
	let isSpoiler = $state(false);

	onMount(() => {
		return activeEditor.registerUpdateListener(({ editorState }) => {
			editorState.read(() => {
				const selection = getSelection();
				if (isRangeSelection(selection)) {
					isHighlight = selection.hasFormat('highlight');
					const nodes = selection.getNodes();
					isSpoiler = nodes.some((node) => {
						if (isTextNodeFn(node)) {
							return (node.getStyle() ?? '').includes('--janbao-spoiler');
						}
						return false;
					});
				} else {
					isHighlight = false;
					isSpoiler = false;
				}
			});
		});
	});

	// Local states for custom Insert Image modal
	let showImageModal = $state(false);
	let showLinkModal = $state(false);
	let imageUrl = $state('');
	let imageAltText = $state('');
	let linkUrl = $state('');

	// Image upload related states
	let imageActiveTab = $state<'upload' | 'url'>('upload');
	let uploading = $state(false);
	let uploadError = $state<string | null>(null);
	let dragOver = $state(false);
	let fileInput = $state<HTMLInputElement | undefined>(undefined);

	function openImageModal() {
		showImageModal = true;
		imageActiveTab = 'upload';
		uploadError = null;
		imageUrl = '';
		imageAltText = '';
	}

	function handleToggleLink() {
		if (!$isLink) {
			// Show modal for URL input instead of immediately applying a placeholder URL
			linkUrl = '';
			showLinkModal = true;
		} else {
			activeEditor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
		}
	}

	function handleConfirmLink() {
		if (linkUrl.trim()) {
			activeEditor.dispatchCommand(TOGGLE_LINK_COMMAND, sanitizeUrl(linkUrl.trim()));
		}
		showLinkModal = false;
		linkUrl = '';
		activeEditor.focus();
	}

	function handleToggleHighlight() {
		activeEditor.dispatchCommand(FORMAT_TEXT_COMMAND, 'highlight');
	}

	function handleToggleSpoiler() {
		activeEditor.dispatchCommand(TOGGLE_SPOILER_COMMAND, undefined);
	}

	function handleInsertImage() {
		if (imageUrl.trim()) {
			InsertImage(activeEditor, {
				src: imageUrl.trim(),
				altText: imageAltText.trim()
			});
			showImageModal = false;
			imageUrl = '';
			imageAltText = '';
			activeEditor.focus();
		}
	}

	async function handleFileUpload(file: File) {
		const MAX_ATTACHMENT = 5 * 1024 * 1024;
		if (file.size > MAX_ATTACHMENT) {
			uploadError = t.upload.fileTooLarge;
			return;
		}

		const allowedTypes = [
			'image/png',
			'image/jpeg',
			'image/webp',
			'image/gif',
			'image/avif',
			'image/bmp'
		];
		if (!allowedTypes.includes(file.type)) {
			uploadError = t.upload.invalidType;
			return;
		}

		uploading = true;
		uploadError = null;

		try {
			const res = await fetch('/upload', {
				method: 'POST',
				body: file
			});
			const result = (await res.json()) as { url?: string; error?: string };

			if (!res.ok || !result.url) {
				uploadError = result.error || t.upload.uploadFailed;
				uploading = false;
				return;
			}

			// Insert image into editor
			InsertImage(activeEditor, {
				src: result.url,
				altText: file.name
			});

			// Reset states and close modal
			showImageModal = false;
			imageUrl = '';
			imageAltText = '';
			uploadError = null;
			activeEditor.focus();
		} catch {
			uploadError = t.auth.networkError;
		} finally {
			uploading = false;
		}
	}

	function handleFileSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			handleFileUpload(target.files[0]);
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		dragOver = true;
	}

	function handleDragLeave() {
		dragOver = false;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
			handleFileUpload(e.dataTransfer.files[0]);
		}
	}
</script>

<div
	class="flex flex-wrap items-center gap-1.5 p-1.5 bg-base-200 border-b border-base-300 rounded-t-field"
>
	<!-- Block Formatting Dropdown -->
	{#if showBlockGroup}
		<div class="dropdown">
			<div tabindex="0" role="button" class="btn btn-xs btn-ghost gap-1 font-semibold text-xs">
				<span>
					{#if $blockType === 'paragraph'}{t.editor.normal}
					{:else if $blockType === 'h1'}{t.editor.heading1}
					{:else if $blockType === 'h2'}{t.editor.heading2}
					{:else if $blockType === 'h3'}{t.editor.heading3}
					{:else if $blockType === 'h4'}{t.editor.heading4}
					{:else if $blockType === 'quote'}{t.editor.quote}
					{:else if $blockType === 'code'}{t.editor.codeBlock}
					{:else if $blockType === 'bullet'}{t.editor.bulletList}
					{:else if $blockType === 'number'}{t.editor.numberedList}
					{:else if $blockType === 'check'}{t.editor.checkList}
					{:else}{t.editor.normal}
					{/if}
				</span>
				<Icon path={mdiChevronDown} size={14} />
			</div>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<ul tabindex="0" class="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52 z-50">
				<li>
					<button
						type="button"
						class:active={$blockType === 'paragraph'}
						onclick={(e) => {
							formatParagraph(activeEditor);
							(e.currentTarget as HTMLElement).blur();
						}}
					>
						<Icon path={mdiFormatParagraph} size={18} />
						<span>{t.editor.normal}</span>
					</button>
				</li>
				{#if features.headings}
					<li>
						<button
							type="button"
							class:active={$blockType === 'h1'}
							onclick={(e) => {
								formatHeading(activeEditor, $blockType, 'h1');
								(e.currentTarget as HTMLElement).blur();
							}}
						>
							<Icon path={mdiFormatHeader1} size={18} />
							<span>{t.editor.heading1}</span>
						</button>
					</li>
					<li>
						<button
							type="button"
							class:active={$blockType === 'h2'}
							onclick={(e) => {
								formatHeading(activeEditor, $blockType, 'h2');
								(e.currentTarget as HTMLElement).blur();
							}}
						>
							<Icon path={mdiFormatHeader2} size={18} />
							<span>{t.editor.heading2}</span>
						</button>
					</li>
					<li>
						<button
							type="button"
							class:active={$blockType === 'h3'}
							onclick={(e) => {
								formatHeading(activeEditor, $blockType, 'h3');
								(e.currentTarget as HTMLElement).blur();
							}}
						>
							<Icon path={mdiFormatHeader3} size={18} />
							<span>{t.editor.heading3}</span>
						</button>
					</li>
					<li>
						<button
							type="button"
							class:active={$blockType === 'h4'}
							onclick={(e) => {
								formatHeading(activeEditor, $blockType, 'h4');
								(e.currentTarget as HTMLElement).blur();
							}}
						>
							<Icon path={mdiFormatHeader4} size={18} />
							<span>{t.editor.heading4}</span>
						</button>
					</li>
				{/if}
				{#if features.quote}
					<li>
						<button
							type="button"
							class:active={$blockType === 'quote'}
							onclick={(e) => {
								formatQuote(activeEditor, $blockType);
								(e.currentTarget as HTMLElement).blur();
							}}
						>
							<Icon path={mdiFormatQuoteClose} size={18} />
							<span>{t.editor.quote}</span>
						</button>
					</li>
				{/if}
				{#if features.codeBlock}
					<li>
						<button
							type="button"
							class:active={$blockType === 'code'}
							onclick={(e) => {
								formatCode(activeEditor, $blockType);
								(e.currentTarget as HTMLElement).blur();
							}}
						>
							<Icon path={mdiCodeBraces} size={18} />
							<span>{t.editor.codeBlock}</span>
						</button>
					</li>
				{/if}
			</ul>
		</div>
	{/if}
	{#if showBlockGroup && (showInlineGroup || showListGroup || showMediaGroup)}
		<div class="divider divider-horizontal m-0 h-6"></div>
	{/if}

	<!-- Inline Styles (Bold, Italic, Underline, Strikethrough, Highlight, Spoiler) -->
	<div class="join">
		{#if features.bold}
			<button
				type="button"
				class="btn btn-xs join-item"
				class:btn-active={$isBold}
				class:btn-ghost={!$isBold}
				onclick={() => toggleBold(activeEditor)}
				title="{t.editor.bold} (Ctrl+B)"
			>
				<Icon path={mdiFormatBold} size={16} />
			</button>
		{/if}
		{#if features.italic}
			<button
				type="button"
				class="btn btn-xs join-item"
				class:btn-active={$isItalic}
				class:btn-ghost={!$isItalic}
				onclick={() => toggleItalic(activeEditor)}
				title="{t.editor.italic} (Ctrl+I)"
			>
				<Icon path={mdiFormatItalic} size={16} />
			</button>
		{/if}
		{#if features.underline}
			<button
				type="button"
				class="btn btn-xs join-item"
				class:btn-active={$isUnderline}
				class:btn-ghost={!$isUnderline}
				onclick={() => toggleUnderline(activeEditor)}
				title="{t.editor.underline} (Ctrl+U)"
			>
				<Icon path={mdiFormatUnderline} size={16} />
			</button>
		{/if}
		{#if features.strikethrough}
			<button
				type="button"
				class="btn btn-xs join-item"
				class:btn-active={$isStrikethrough}
				class:btn-ghost={!$isStrikethrough}
				onclick={() => toggleStrikethrough(activeEditor)}
				title={t.editor.strikethrough}
			>
				<Icon path={mdiFormatStrikethrough} size={16} />
			</button>
		{/if}
		{#if features.highlight}
			<button
				type="button"
				class="btn btn-xs join-item"
				class:btn-active={isHighlight}
				class:btn-ghost={!isHighlight}
				onclick={handleToggleHighlight}
				title={t.editor.highlight}
			>
				<Icon path={mdiMarker} size={16} />
			</button>
		{/if}
		{#if features.spoiler}
			<button
				type="button"
				class="btn btn-xs join-item"
				class:btn-active={isSpoiler}
				class:btn-ghost={!isSpoiler}
				onclick={handleToggleSpoiler}
				title={t.editor.spoiler}
			>
				<Icon path={mdiEyeOff} size={16} />
			</button>
		{/if}
	</div>
	{#if showInlineGroup && (showListGroup || showMediaGroup)}
		<div class="divider divider-horizontal m-0 h-6"></div>
	{/if}

	<!-- Lists -->
	<div class="join">
		{#if features.bulletList}
			<button
				type="button"
				class="btn btn-xs join-item"
				class:btn-active={$blockType === 'bullet'}
				class:btn-ghost={$blockType !== 'bullet'}
				onclick={() => formatBulletList(activeEditor, $blockType)}
				title={t.editor.bulletList}
			>
				<Icon path={mdiFormatListBulleted} size={16} />
			</button>
		{/if}
		{#if features.numberedList}
			<button
				type="button"
				class="btn btn-xs join-item"
				class:btn-active={$blockType === 'number'}
				class:btn-ghost={$blockType !== 'number'}
				onclick={() => formatNumberedList(activeEditor, $blockType)}
				title={t.editor.numberedList}
			>
				<Icon path={mdiFormatListNumbered} size={16} />
			</button>
		{/if}
		{#if features.checklist}
			<button
				type="button"
				class="btn btn-xs join-item"
				class:btn-active={$blockType === 'check'}
				class:btn-ghost={$blockType !== 'check'}
				onclick={() => formatCheckList(activeEditor, $blockType)}
				title={t.editor.checkList}
			>
				<Icon path={mdiFormatListChecks} size={16} />
			</button>
		{/if}
	</div>
	{#if showListGroup && showMediaGroup}
		<div class="divider divider-horizontal m-0 h-6"></div>
	{/if}

	<!-- Links & Images -->
	<div class="flex items-center gap-1">
		{#if features.link}
			<button
				type="button"
				class="btn btn-xs"
				class:btn-active={$isLink}
				class:btn-ghost={!$isLink}
				onclick={handleToggleLink}
				title={t.editor.link}
			>
				<Icon path={mdiLink} size={16} />
			</button>
		{/if}

		{#if features.image}
			<button
				type="button"
				class="btn btn-xs btn-ghost"
				onclick={openImageModal}
				title={t.editor.image}
			>
				<Icon path={mdiImage} size={16} />
			</button>
		{/if}
	</div>
</div>

<!-- Modal for inserting links -->
{#if showLinkModal}
	<div class="modal modal-open z-50">
		<div
			class="modal-box max-w-md bg-base-100 text-base-content border border-base-300 relative p-6"
		>
			<button
				type="button"
				class="btn btn-sm btn-circle btn-ghost absolute right-4 top-4 text-error"
				onclick={() => (showLinkModal = false)}
				title={t.editor.close}
			>
				<Icon path={mdiClose} size={18} />
			</button>

			<h3 class="text-lg font-bold mb-4">{t.editor.link}</h3>

			<div class="form-control w-full mb-3">
				<label for="editor-link-url" class="label label-text font-semibold p-1 text-base-content/70"
					>{t.editor.urlLabel}</label
				>
				<input
					id="editor-link-url"
					type="text"
					placeholder="https://example.com"
					class="input input-bordered input-sm w-full bg-base-100 text-base-content focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
					bind:value={linkUrl}
					onkeydown={(e) => {
						if (e.key === 'Enter') handleConfirmLink();
						if (e.key === 'Escape') showLinkModal = false;
					}}
				/>
			</div>

			<div class="modal-action mt-6 flex justify-end gap-2">
				<button type="button" class="btn btn-sm btn-ghost" onclick={() => (showLinkModal = false)}>
					{t.common.cancel}
				</button>
				<button
					type="button"
					class="btn btn-sm btn-primary font-semibold"
					disabled={!linkUrl.trim()}
					onclick={handleConfirmLink}
				>
					{t.common.confirm}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Custom daisyUI Modal for inserting images -->
{#if showImageModal}
	<div class="modal modal-open z-50">
		<div
			class="modal-box max-w-md bg-base-100 text-base-content border border-base-300 relative p-6"
		>
			<button
				type="button"
				class="btn btn-sm btn-circle btn-ghost absolute right-4 top-4 text-error"
				onclick={() => (showImageModal = false)}
				title={t.editor.close}
				disabled={uploading}
			>
				<Icon path={mdiClose} size={18} />
			</button>

			<h3 class="text-lg font-bold mb-4">{t.editor.image}</h3>

			<div class="tabs tabs-boxed mb-4 bg-base-200 p-1 rounded-box">
				<button
					type="button"
					class="tab tab-sm w-1/2 rounded-selector transition-all font-semibold {imageActiveTab ===
					'upload'
						? 'bg-primary text-primary-content shadow-sm'
						: 'text-base-content/70 hover:text-base-content'}"
					onclick={() => {
						if (!uploading) imageActiveTab = 'upload';
					}}
					disabled={uploading}
				>
					{t.editor.uploadImage}
				</button>
				<button
					type="button"
					class="tab tab-sm w-1/2 rounded-selector transition-all font-semibold {imageActiveTab ===
					'url'
						? 'bg-primary text-primary-content shadow-sm'
						: 'text-base-content/70 hover:text-base-content'}"
					onclick={() => {
						if (!uploading) imageActiveTab = 'url';
					}}
					disabled={uploading}
				>
					{t.editor.imageUrl}
				</button>
			</div>

			{#if imageActiveTab === 'upload'}
				<div class="flex flex-col gap-4">
					{#if uploading}
						<div
							class="flex flex-col items-center justify-center p-8 border border-base-300 rounded-field bg-base-200/30 gap-3 min-h-[160px]"
						>
							<span class="loading loading-spinner loading-md text-primary"></span>
							<span class="text-sm font-medium text-base-content/70">{t.editor.uploading}</span>
						</div>
					{:else}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							class="border-2 border-dashed rounded-field p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all duration-200 min-h-[160px]
							{dragOver
								? 'border-primary bg-primary/10 text-primary'
								: 'border-base-300 bg-base-200/20 hover:border-primary/50 hover:bg-base-200/50 text-base-content/60'}"
							onclick={() => fileInput?.click()}
							ondragover={handleDragOver}
							ondragleave={handleDragLeave}
							ondrop={handleDrop}
						>
							<Icon path={mdiUpload} size={32} class="opacity-80" />
							<p class="text-center text-sm font-medium">
								{t.editor.dragDropHint}
							</p>
							<span class="text-xs text-base-content/40 text-center">
								{t.profile.avatarRequirements.replace('1MB', '5MB').replace('1M', '5M')}
							</span>
						</div>
						<input
							type="file"
							accept="image/*"
							class="hidden"
							bind:this={fileInput}
							onchange={handleFileSelect}
						/>
					{/if}

					{#if uploadError}
						<div
							class="alert alert-error text-sm py-2 px-3 flex gap-2 rounded-box items-center text-error-content bg-error/15 border border-error/30"
						>
							<Icon path={mdiAlertCircle} size={18} />
							<span>{uploadError}</span>
						</div>
					{/if}

					<div class="modal-action mt-4 flex justify-end">
						<button
							type="button"
							class="btn btn-sm btn-ghost font-semibold"
							onclick={() => (showImageModal = false)}
							disabled={uploading}
						>
							{t.common.cancel}
						</button>
					</div>
				</div>
			{:else if imageActiveTab === 'url'}
				<div class="form-control w-full mb-3">
					<label
						for="editor-image-url"
						class="label label-text font-semibold p-1 text-base-content/70"
					>
						{t.editor.imageUrl}
					</label>
					<input
						id="editor-image-url"
						type="text"
						class="input input-bordered input-sm w-full bg-base-100 text-base-content focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
						bind:value={imageUrl}
						onkeydown={(e) => {
							if (e.key === 'Enter') handleInsertImage();
							if (e.key === 'Escape') showImageModal = false;
						}}
					/>
				</div>

				<div class="form-control w-full mb-4">
					<label
						for="editor-image-alt"
						class="label label-text font-semibold p-1 text-base-content/70"
					>
						{t.editor.altText}
					</label>
					<input
						id="editor-image-alt"
						type="text"
						class="input input-bordered input-sm w-full bg-base-100 text-base-content focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
						bind:value={imageAltText}
						onkeydown={(e) => {
							if (e.key === 'Enter') handleInsertImage();
							if (e.key === 'Escape') showImageModal = false;
						}}
					/>
				</div>

				<div class="modal-action mt-6 flex justify-end gap-2">
					<button
						type="button"
						class="btn btn-sm btn-ghost font-semibold"
						onclick={() => (showImageModal = false)}
					>
						{t.common.cancel}
					</button>
					<button
						type="button"
						class="btn btn-sm btn-primary font-semibold"
						disabled={!imageUrl.trim()}
						onclick={handleInsertImage}
					>
						{t.common.confirm}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
