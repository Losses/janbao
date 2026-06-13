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
		undo,
		redo,
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
		mdiUndo,
		mdiRedo,
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
		mdiClose
	} from '@mdi/js';

	interface Props {
		activeEditor: LexicalEditor;
		disableHeadings?: boolean;
		disableImageUpload?: boolean;
	}

	let { activeEditor, disableHeadings = false, disableImageUpload = false }: Props = $props();

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
							return (node.getStyle() ?? '').includes('janbao-spoiler');
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
</script>

<div
	class="flex flex-wrap items-center gap-1.5 p-1.5 bg-base-200 border-b border-base-300 rounded-t-lg"
>
	<!-- Undo / Redo -->
	<div class="join">
		<button
			type="button"
			class="btn btn-xs btn-ghost join-item"
			onclick={() => undo(activeEditor)}
			title="Undo"
		>
			<Icon path={mdiUndo} size={16} />
		</button>
		<button
			type="button"
			class="btn btn-xs btn-ghost join-item"
			onclick={() => redo(activeEditor)}
			title="Redo"
		>
			<Icon path={mdiRedo} size={16} />
		</button>
	</div>

	<div class="divider divider-horizontal m-0 h-6"></div>

	<!-- Block Formatting Dropdown -->
	{#if !disableHeadings}
		<div class="dropdown">
			<div tabindex="0" role="button" class="btn btn-xs btn-ghost gap-1 font-semibold text-xs">
				<span>
					{#if $blockType === 'paragraph'}Normal
					{:else if $blockType === 'h1'}H1
					{:else if $blockType === 'h2'}H2
					{:else if $blockType === 'h3'}H3
					{:else if $blockType === 'h4'}H4
					{:else if $blockType === 'quote'}Quote
					{:else if $blockType === 'code'}Code
					{:else if $blockType === 'bullet'}Bulleted List
					{:else if $blockType === 'number'}Numbered List
					{:else if $blockType === 'check'}Check List
					{:else}Normal
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
						<span>Normal</span>
					</button>
				</li>
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
						<span>Heading 1</span>
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
						<span>Heading 2</span>
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
						<span>Heading 3</span>
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
						<span>Heading 4</span>
					</button>
				</li>
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
						<span>Quote</span>
					</button>
				</li>
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
						<span>Code Block</span>
					</button>
				</li>
			</ul>
		</div>

		<div class="divider divider-horizontal m-0 h-6"></div>
	{/if}

	<!-- Inline Styles (Bold, Italic, Underline, Strikethrough, Highlight, Spoiler) -->
	<div class="join">
		<button
			type="button"
			class="btn btn-xs join-item"
			class:btn-active={$isBold}
			class:btn-ghost={!$isBold}
			onclick={() => toggleBold(activeEditor)}
			title="Bold (Ctrl+B)"
		>
			<Icon path={mdiFormatBold} size={16} />
		</button>
		<button
			type="button"
			class="btn btn-xs join-item"
			class:btn-active={$isItalic}
			class:btn-ghost={!$isItalic}
			onclick={() => toggleItalic(activeEditor)}
			title="Italic (Ctrl+I)"
		>
			<Icon path={mdiFormatItalic} size={16} />
		</button>
		<button
			type="button"
			class="btn btn-xs join-item"
			class:btn-active={$isUnderline}
			class:btn-ghost={!$isUnderline}
			onclick={() => toggleUnderline(activeEditor)}
			title="Underline (Ctrl+U)"
		>
			<Icon path={mdiFormatUnderline} size={16} />
		</button>
		<button
			type="button"
			class="btn btn-xs join-item"
			class:btn-active={$isStrikethrough}
			class:btn-ghost={!$isStrikethrough}
			onclick={() => toggleStrikethrough(activeEditor)}
			title="Strikethrough"
		>
			<Icon path={mdiFormatStrikethrough} size={16} />
		</button>
		<button
			type="button"
			class="btn btn-xs join-item"
			class:btn-active={isHighlight}
			class:btn-ghost={!isHighlight}
			onclick={handleToggleHighlight}
			title="Marker Highlight"
		>
			<Icon path={mdiMarker} size={16} />
		</button>
		<button
			type="button"
			class="btn btn-xs join-item"
			class:btn-active={isSpoiler}
			class:btn-ghost={!isSpoiler}
			onclick={handleToggleSpoiler}
			title="Spoiler"
		>
			<Icon path={mdiEyeOff} size={16} />
		</button>
	</div>

	<div class="divider divider-horizontal m-0 h-6"></div>

	<!-- Lists -->
	<div class="join">
		<button
			type="button"
			class="btn btn-xs join-item"
			class:btn-active={$blockType === 'bullet'}
			class:btn-ghost={$blockType !== 'bullet'}
			onclick={() => formatBulletList(activeEditor, $blockType)}
			title="Bulleted List"
		>
			<Icon path={mdiFormatListBulleted} size={16} />
		</button>
		<button
			type="button"
			class="btn btn-xs join-item"
			class:btn-active={$blockType === 'number'}
			class:btn-ghost={$blockType !== 'number'}
			onclick={() => formatNumberedList(activeEditor, $blockType)}
			title="Numbered List"
		>
			<Icon path={mdiFormatListNumbered} size={16} />
		</button>
		<button
			type="button"
			class="btn btn-xs join-item"
			class:btn-active={$blockType === 'check'}
			class:btn-ghost={$blockType !== 'check'}
			onclick={() => formatCheckList(activeEditor, $blockType)}
			title="Check List"
		>
			<Icon path={mdiFormatListChecks} size={16} />
		</button>
	</div>

	<div class="divider divider-horizontal m-0 h-6"></div>

	<!-- Links & Images -->
	<div class="flex items-center gap-1">
		<button
			type="button"
			class="btn btn-xs"
			class:btn-active={$isLink}
			class:btn-ghost={!$isLink}
			onclick={handleToggleLink}
			title="Insert Link"
		>
			<Icon path={mdiLink} size={16} />
		</button>

		{#if !disableImageUpload}
			<button
				type="button"
				class="btn btn-xs btn-ghost"
				onclick={() => {
					showImageModal = true;
				}}
				title="Insert Image"
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
				title="Close"
			>
				<Icon path={mdiClose} size={18} />
			</button>

			<h3 class="text-lg font-bold mb-4">Insert Link</h3>

			<div class="form-control w-full mb-3">
				<label for="editor-link-url" class="label label-text font-semibold p-1 text-base-content/70"
					>URL</label
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
					Cancel
				</button>
				<button
					type="button"
					class="btn btn-sm btn-primary font-semibold"
					disabled={!linkUrl.trim()}
					onclick={handleConfirmLink}
				>
					Confirm
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
				title="Close"
			>
				<Icon path={mdiClose} size={18} />
			</button>

			<h3 class="text-lg font-bold mb-4">Insert Image</h3>

			<div class="form-control w-full mb-3">
				<label
					for="editor-image-url"
					class="label label-text font-semibold p-1 text-base-content/70">Image URL</label
				>
				<input
					id="editor-image-url"
					type="text"
					placeholder="i.e. https://source.unsplash.com/random"
					class="input input-bordered input-sm w-full bg-base-100 text-base-content focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
					bind:value={imageUrl}
				/>
			</div>

			<div class="form-control w-full mb-4">
				<label
					for="editor-image-alt"
					class="label label-text font-semibold p-1 text-base-content/70">Alt Text</label
				>
				<input
					id="editor-image-alt"
					type="text"
					placeholder="Random unsplash image"
					class="input input-bordered input-sm w-full bg-base-100 text-base-content focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
					bind:value={imageAltText}
				/>
			</div>

			<div class="modal-action mt-6 flex justify-end gap-2">
				<button type="button" class="btn btn-sm btn-ghost" onclick={() => (showImageModal = false)}>
					Cancel
				</button>
				<button
					type="button"
					class="btn btn-sm btn-primary font-semibold"
					disabled={!imageUrl.trim()}
					onclick={handleInsertImage}
				>
					Confirm
				</button>
			</div>
		</div>
	</div>
{/if}
