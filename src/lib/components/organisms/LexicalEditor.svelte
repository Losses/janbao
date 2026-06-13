<script lang="ts">
	/**
	 * LexicalEditor Organism - Svelte-Lexical editor wrapper with:
	 * - Markdown shortcut parsers (H1-H4, bold, italic, underline, strikethrough)
	 * - Protocol-level URL validation (only http:// https:// allowed, blocking XSS)
	 * - Context-aware autosave (POST to /api/drafts/save every 30s)
	 * - Editor locking during initial loading
	 * - AutoLink plugin for automatic URL linkification
	 * - Marker Highlight and Spoiler inline text formatting
	 */
	import {
		Composer,
		ContentEditable,
		RichTextPlugin,
		HistoryPlugin,
		ListPlugin,
		ImagePlugin,
		LinkPlugin,
		AutoLinkPlugin,
		PlaceHolder,
		MarkdownShortcutPlugin,
		OnChangePlugin,
		Toolbar,
		HeadingNode,
		QuoteNode,
		ListNode,
		ListItemNode,
		ImageNode,
		AutoLinkNode,
		LinkNode,
		ITALIC_STAR,
		ITALIC_UNDERSCORE,
		BOLD_STAR,
		BOLD_UNDERSCORE,
		STRIKETHROUGH,
		HEADING,
		LINK,
		UNORDERED_LIST,
		ORDERED_LIST,
		CHECK_LIST
	} from 'svelte-lexical';
	import RichTextToolbar from '$lib/components/molecules/RichTextToolbar.svelte';
	import RichTextLinkEditor from '$lib/components/molecules/RichTextLinkEditor.svelte';
	import { CodeNode, CodeHighlightNode } from '@lexical/code';
	import {
		COMMAND_PRIORITY_EDITOR,
		$getSelection as getSelection,
		$isRangeSelection as isRangeSelection,
		$isTextNode as isTextNodeFn
	} from 'lexical';
	import type { LexicalCommand } from 'lexical';
	import type { VoidHandler } from '$lib/types/handlers';
	import type { TranslationDict } from '$lib/types/translation';

	/** Custom Lexical command to toggle spoiler formatting on selected text */
	import { TOGGLE_SPOILER_COMMAND } from '$lib/types/editor-commands';

	/** Sentinel string embedded in TextNode style to mark spoiler formatting */
	const SPOILER_STYLE_MARKER = 'janbao-spoiler;';

	type ContentChangeHandler = (json: string) => void;
	type NodeTransformFn = (node: unknown) => void;
	type RegisterNodeTransformFn = (nodeClass: unknown, transform: NodeTransformFn) => VoidHandler;
	type StringGetter = () => string;
	type ToJSONFn = () => unknown;
	type GetStyleFn = () => string;
	type SetStyleFn = (style: string) => void;
	type GetNodesFn = () => NodeWithStyle[];
	type UpdateFn = (fn: VoidHandler) => void;
	type CommandHandlerFn = () => boolean;
	type RegisterCommandFn = (
		command: LexicalCommand<void>,
		handler: CommandHandlerFn,
		priority: number
	) => VoidHandler;

	interface EditorStateLike {
		toJSON: ToJSONFn;
	}

	type GetEditorStateFn = () => EditorStateLike;

	interface EditorWithGetState {
		getEditorState?: GetEditorStateFn;
	}

	interface LexicalEditorProps {
		/** Initial Lexical JSON state string to hydrate the editor */
		initialContent?: string | null;
		/** Context for draft autosave: 'discussion', 'reply', 'message', 'activity' */
		contextType?: string;
		/** Context ID for draft autosave: categorySlug, discussionId, conversationId */
		contextId?: string;
		/** Placeholder text (overrides i18n default) */
		placeholder?: string;
		/** Disable the editor (e.g. during initial data loading) */
		disabled?: boolean;
		/** Restrict headings (for activity editor) */
		disableHeadings?: boolean;
		/** Hide image upload button (for PM editor) */
		disableImageUpload?: boolean;
		/** Called when content changes with serialized JSON string */
		onContentChange?: ContentChangeHandler;
		/** Translation dictionary for i18n strings */
		t?: TranslationDict | null;
		/** Class override for container */
		class?: string;
	}

	let {
		initialContent = null,
		contextType,
		contextId,
		placeholder,
		disabled = false,
		disableHeadings = false,
		disableImageUpload = false,
		onContentChange,
		t = null,
		class: className = ''
	}: LexicalEditorProps = $props();

	const tEditor = $derived((t?.editor ?? {}) as Record<string, string>);

	// Use i18n placeholder if no override provided
	const resolvedPlaceholder = $derived(
		placeholder ?? tEditor['placeholder'] ?? 'Write something...'
	);

	// Internal state
	let editorAreaElem: HTMLDivElement | undefined = $state();
	let isSaving = $state(false);
	let lastSavedContent = $state('');
	let saveStatus = $state<'idle' | 'saving' | 'saved'>('idle');
	let autosaveTimer: ReturnType<typeof setInterval> | undefined;

	type EditorStateGetter = () => string;

	// Track editor instance for autosave - store JSON getter, not typed editor ref
	// to avoid cross-version type mismatches from svelte-lexical's lexical dependency
	let editorStateGetter: EditorStateGetter | undefined = $state();

	let editorInstance: unknown = $state();

	// Dynamic registration of ImageNode protocol-level XSS validation transform
	interface EditorWithTransform {
		registerNodeTransform?: RegisterNodeTransformFn;
		registerCommand?: RegisterCommandFn;
		update?: UpdateFn;
	}

	interface ImageNodeWithSrc {
		getSrc?: StringGetter;
	}

	interface NodeWithRemove {
		remove?: VoidHandler;
	}

	interface NodeWithStyle {
		getStyle?: GetStyleFn;
		setStyle?: SetStyleFn;
	}

	interface SelectionWithNodes {
		getNodes?: GetNodesFn;
	}

	$effect(() => {
		if (!editorInstance) return;
		const castEditor = editorInstance as EditorWithTransform;
		if (!castEditor.registerNodeTransform) return;
		const unregister = castEditor.registerNodeTransform(ImageNode, (node) => {
			const src = (node as ImageNodeWithSrc).getSrc?.() ?? '';
			if (!validateUrl(src)) {
				(node as NodeWithRemove).remove?.();
			}
		});
		return () => unregister();
	});

	// Register spoiler toggle command on the editor instance
	$effect(() => {
		if (!editorInstance) return;
		const castEditor = editorInstance as EditorWithTransform;
		if (!castEditor.registerCommand || !castEditor.update) return;

		const unregister = castEditor.registerCommand(
			TOGGLE_SPOILER_COMMAND,
			() => {
				castEditor.update!(() => {
					const selection = getSelection();
					if (isRangeSelection(selection)) {
						const nodes = (selection as SelectionWithNodes).getNodes?.() ?? [];
						for (const node of nodes) {
							if (isTextNodeFn(node as Parameters<typeof isTextNodeFn>[0])) {
								const textNode = node as NodeWithStyle;
								const currentStyle = textNode.getStyle?.() ?? '';
								if (currentStyle.includes('janbao-spoiler')) {
									textNode.setStyle?.(currentStyle.replace(/janbao-spoiler;?\s*/g, '').trim());
								} else {
									textNode.setStyle?.(
										currentStyle ? `${currentStyle} ${SPOILER_STYLE_MARKER}` : SPOILER_STYLE_MARKER
									);
								}
							}
						}
					}
				});
				return true;
			},
			COMMAND_PRIORITY_EDITOR
		);
		return () => unregister();
	});

	// Nodes required by the editor
	const editorNodes = [
		HeadingNode,
		QuoteNode,
		ListNode,
		ListItemNode,
		ImageNode,
		AutoLinkNode,
		LinkNode,
		CodeNode,
		CodeHighlightNode
	];

	// Markdown transformers we support
	const markdownTransformers = $derived([
		BOLD_STAR,
		BOLD_UNDERSCORE,
		ITALIC_STAR,
		ITALIC_UNDERSCORE,
		STRIKETHROUGH,
		...(!disableHeadings ? [HEADING] : []),
		LINK,
		UNORDERED_LIST,
		ORDERED_LIST,
		CHECK_LIST
	]);

	// Protocol-level URL validation - only http://, https://, and relative paths (starting with /, ., #) allowed
	function validateUrl(src: string): boolean {
		const lower = src.trim().toLowerCase();
		if (lower.startsWith('http://') || lower.startsWith('https://')) {
			return true;
		}
		if (
			lower.startsWith('/') ||
			lower.startsWith('./') ||
			lower.startsWith('../') ||
			lower.startsWith('#')
		) {
			return true;
		}
		return false;
	}

	// Handle content changes - OnChangePlugin signature: (editorState, editor, tags)
	// We use structural types to avoid cross-package EditorState type conflicts
	// between our direct lexical dependency and svelte-lexical's internal version.
	function handleChange(editorState: EditorStateLike, editor: unknown) {
		editorInstance = editor;
		const castEditor = editor as EditorWithGetState;
		editorStateGetter = () => JSON.stringify(castEditor.getEditorState?.().toJSON() ?? {});
		const json = JSON.stringify(editorState.toJSON());
		onContentChange?.(json);
	}

	// Autosave: POST to /api/drafts/save every 30 seconds
	function startAutosave() {
		stopAutosave();
		if (!contextType) return;

		autosaveTimer = setInterval(async () => {
			if (!editorStateGetter || !contextType || isSaving) return;

			const json = editorStateGetter();
			if (json === lastSavedContent) return; // No changes

			isSaving = true;
			saveStatus = 'saving';

			try {
				const response = await fetch('/api/drafts/save', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						contextType,
						contextId: contextId ?? '',
						contentJson: json
					})
				});

				if (response.ok) {
					lastSavedContent = json;
					saveStatus = 'saved';
					// Clear "saved" indicator after 3 seconds
					setTimeout(() => {
						if (saveStatus === 'saved') saveStatus = 'idle';
					}, 3000);
				}
			} catch {
				saveStatus = 'idle';
			} finally {
				isSaving = false;
			}
		}, 30000);
	}

	function stopAutosave() {
		if (autosaveTimer) {
			clearInterval(autosaveTimer);
			autosaveTimer = undefined;
		}
	}

	// Synchronize initial content with parent on mount.
	// When a draft is loaded from the backend, the parent page's contentJson
	// state remains '' until the first keystroke. This effect fires immediately
	// so that submit buttons ("Publish", "Send") are enabled without requiring
	// the user to type.
	$effect(() => {
		if (initialContent && onContentChange) {
			onContentChange(initialContent);
		}
	});

	$effect(() => {
		startAutosave();
		return () => stopAutosave();
	});

	// Derived save status label - uses i18n keys
	const saveStatusLabel = $derived.by(() => {
		if (saveStatus === 'saving') return tEditor['saving'] ?? 'Saving...';
		if (saveStatus === 'saved') return tEditor['saved'] ?? 'Draft saved';
		return '';
	});

	// Build Composer initialConfig object - recompute when initialContent changes
	const initialConfig = $derived({
		namespace: 'JanbaoEditor',
		theme: {
			paragraph: 'mb-1',
			heading: {
				h1: 'text-2xl font-bold mb-2',
				h2: 'text-xl font-bold mb-2',
				h3: 'text-lg font-bold mb-1',
				h4: 'text-base font-bold mb-1'
			},
			list: {
				ul: 'list-disc ml-4 mb-1',
				ol: 'list-decimal ml-4 mb-1',
				listitem: 'mb-0.5'
			},
			text: {
				bold: 'font-bold',
				italic: 'italic',
				underline: 'underline',
				strikethrough: 'line-through',
				highlight: 'bg-yellow-200/60 dark:bg-yellow-400/30 rounded px-0.5'
			},
			link: 'text-primary underline',
			image: 'max-w-full my-2'
		},
		nodes: editorNodes,
		onError: (error: Error) => {
			console.error('Lexical Editor Error:', error);
		},
		editorState: initialContent ?? undefined
	});
</script>

<div
	class="janbao-rich-editor relative rounded-lg border border-base-300 bg-base-100 shadow-xs focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all duration-200 {className}"
>
	<Composer {initialConfig}>
		<div class={disabled ? 'opacity-60 pointer-events-none' : ''}>
			<Toolbar>
				{#snippet children({ activeEditor })}
					<RichTextToolbar {activeEditor} {disableHeadings} {disableImageUpload} />
				{/snippet}
			</Toolbar>
		</div>

		<!-- Editor Area -->
		<div
			bind:this={editorAreaElem}
			class="relative {disabled ? 'opacity-60 pointer-events-none' : ''}"
		>
			<ContentEditable
				ariaLabel={resolvedPlaceholder}
				className="ContentEditable__root prose prose-sm max-w-none min-h-[200px] px-3 py-2 text-base-content bg-base-100 focus:outline-none"
			/>
			<RichTextPlugin />
			<HistoryPlugin />
			<ListPlugin />
			<ImagePlugin />
			<LinkPlugin {validateUrl} />
			<AutoLinkPlugin />
			<RichTextLinkEditor anchorElem={editorAreaElem} />
			<MarkdownShortcutPlugin transformers={markdownTransformers} />
			<OnChangePlugin
				ignoreHistoryMergeTagChange={true}
				ignoreSelectionChange={false}
				onChange={handleChange}
			/>
			<PlaceHolder>
				{resolvedPlaceholder}
			</PlaceHolder>
		</div>
	</Composer>

	<!-- Save Status Footer -->
	{#if saveStatusLabel}
		<div
			class="border-t border-base-300 px-3 py-1 text-right text-xs text-base-content/40 bg-base-200 rounded-b-lg"
		>
			{saveStatusLabel}
		</div>
	{/if}

	<!-- Visual loading overlay to prevent editor unmounting and data loss -->
	{#if disabled}
		<div
			class="absolute inset-0 z-40 flex items-center justify-center bg-base-100/50 backdrop-blur-[1px] rounded-lg"
		>
			<span class="loading loading-spinner loading-sm text-primary"></span>
			<span class="ml-2 text-sm text-base-content/60">{tEditor['loading'] ?? 'Loading...'}</span>
		</div>
	{/if}
</div>
