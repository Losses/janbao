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
	import EditorInstanceSync from './EditorInstanceSync.svelte';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { getEditorPrefsStore } from '$lib/stores/editor-prefs.svelte';
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
		$createImageNode as createImageNode,
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
	import { MentionNode, createMentionNode } from '$lib/components/atoms/MentionNode';
	import { DeadImageNode, setDeadImageLabel } from '$lib/components/atoms/DeadImageNode';
	import {
		UploadingImageNode,
		createUploadingImageNode,
		setUploadingImageLabel
	} from '$lib/components/atoms/UploadingImageNode';
	import MentionTypeaheadPlugin from '$lib/components/molecules/MentionTypeaheadPlugin.svelte';
	import {
		COMMAND_PRIORITY_EDITOR,
		COMMAND_PRIORITY_HIGH,
		FORMAT_TEXT_COMMAND,
		PASTE_COMMAND,
		$getSelection as getSelection,
		$isRangeSelection as isRangeSelection,
		$isTextNode as isTextNodeFn,
		$getRoot as getRoot,
		$getNodeByKey as getNodeByKey,
		$isRootOrShadowRoot as isRootOrShadowRoot,
		$createParagraphNode as createParagraphNode
	} from 'lexical';
	import type { LexicalCommand, LexicalEditor, LexicalNode } from 'lexical';
	import type { VoidHandler } from '$lib/types/handlers';
	import type { TranslationDict } from '$lib/types/translation';

	/** Custom Lexical command to toggle spoiler formatting on selected text */
	import { TOGGLE_SPOILER_COMMAND } from '$lib/types/editor-commands';

	/**
	 * Sentinel embedded in a TextNode's inline style to mark spoiler formatting.
	 * MUST be valid CSS: Lexical writes the style string via `dom.style.cssText`,
	 * and the browser drops any invalid declaration during parsing - a bare
	 * `janbao-spoiler;` (no `: value`) is discarded, leaving `style=""`, so the
	 * editor's `[style*='--janbao-spoiler']` rule never matches and the live
	 * contentEditable shows no spoiler effect. A CSS custom property survives
	 * the round-trip and matches the attribute selector.
	 */
	const SPOILER_STYLE_MARKER = '--janbao-spoiler: 1;';

	type ContentChangeHandler = (json: string) => void;
	type NodeTransformFn = (node: unknown) => void;
	type RegisterNodeTransformFn = (nodeClass: unknown, transform: NodeTransformFn) => VoidHandler;
	type StringGetter = () => string;
	type ToJSONFn = () => unknown;
	type GetStyleFn = () => string;

	/** Shape of the /upload endpoint JSON response. */
	interface UploadResponse {
		url?: string;
		error?: string;
	}

	/** Minimal shape of a serialized Lexical node for placeholder stripping. */
	interface SerializedNodeLike {
		type?: string;
		children?: SerializedNodeLike[];
	}

	/** Minimal shape of a serialized editor state ({ root: { children: [] } }). */
	interface SerializedStateLike {
		root?: SerializedNodeLike;
	}
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

	export interface LexicalEditorProps {
		/** Initial Lexical JSON state string to hydrate the editor */
		initialContent?: string | null;
		/** Context for draft autosave: 'discussion', 'reply', 'message', 'activity' */
		contextType?: string;
		/** Context ID for draft autosave: categorySlug, discussionId, conversationId */
		contextId?: number;
		/** Placeholder text (overrides i18n default) */
		placeholder?: string;
		/** Disable the editor (e.g. during initial data loading) */
		disabled?: boolean;
		/** Restrict headings (for activity editor) */
		disableHeadings?: boolean;
		/** Hide image upload button (for PM editor) */
		disableImageUpload?: boolean;
		/** Max height of the scrollable editing area (CSS length); the toolbar pins above it */
		editorMaxHeight?: string;
		/** Called when content changes with serialized JSON string */
		onContentChange?: ContentChangeHandler;
		/** Called on Ctrl/Cmd+Enter so the parent can trigger its submit path */
		onSubmit?: VoidHandler;
		/** Translation dictionary for i18n strings */
		t: TranslationDict;
		/** Class override for container */
		class?: string;
		/** User IDs to exclude from @ mention suggestions */
		excludeIds?: number[];
	}

	let {
		initialContent = null,
		contextType,
		contextId,
		placeholder,
		disabled = false,
		disableHeadings = false,
		disableImageUpload = false,
		editorMaxHeight = '60vh',
		onContentChange,
		onSubmit,
		t,
		class: className = '',
		excludeIds = []
	}: LexicalEditorProps = $props();

	// Editor feature prefs come from the client store (hydrated from the session by
	// the root layout). `features` resolves the user's prefs against the plainMode
	// master and the instance-level restrictions passed as props (disableHeadings
	// on the activity editor, disableImageUpload in PMs): instance restrictions
	// always win (AND), and plainMode forces every feature off. Mentions are not a
	// preference (they drive notifications) and stay on in every mode: the typeahead
	// + chip are functional rather than formatting, so plain-text mode keeps them
	// (typing @ still surfaces suggestions and inserts a mention chip).
	const editorPrefs = getEditorPrefsStore();
	const features = $derived.by(() => {
		const p = editorPrefs.prefs;
		const off = p.plainMode;
		return {
			plainMode: p.plainMode,
			bold: !off && p.bold,
			italic: !off && p.italic,
			underline: !off && p.underline,
			strikethrough: !off && p.strikethrough,
			highlight: !off && p.highlight,
			spoiler: !off && p.spoiler,
			headings: !off && p.headings && !disableHeadings,
			quote: !off && p.quote,
			codeBlock: !off && p.codeBlock,
			bulletList: !off && p.bulletList,
			numberedList: !off && p.numberedList,
			checklist: !off && p.checklist,
			link: !off && p.link,
			autolink: !off && p.autolink,
			image: !off && p.image && !disableImageUpload,
			markdown: !off && p.markdown
		};
	});

	// Keep the dead-image placeholder label locale-aware (the Lexical node builds
	// its DOM imperatively and has no access to `t`, so it reads a module value).
	$effect(() => {
		setDeadImageLabel(t.img.deadImage);
		setUploadingImageLabel(t.editor.uploading);
	});

	// Use i18n placeholder if no override provided
	const resolvedPlaceholder = $derived(placeholder ?? t.editor.placeholder);

	// Internal state
	let editorAreaElem: HTMLDivElement | undefined = $state();
	let isSaving = $state(false);
	let lastSavedContent = $state('');
	let saveStatus = $state<'idle' | 'saving' | 'saved'>('idle');
	let autosaveTimer: ReturnType<typeof setInterval> | undefined;

	let uploadError = $state<string | null>(null);

	function setUploadError(err: string) {
		uploadError = err;
		setTimeout(() => {
			if (uploadError === err) uploadError = null;
		}, 4000);
	}

	/**
	 * Wraps a block-level node in its own paragraph when it has landed directly
	 * under the editor root, mirroring svelte-lexical's ImagePlugin so the node
	 * owns a dedicated line and the cursor can navigate past it. Inlined from
	 * @lexical/utils' $wrapNodeInElement (a 3-liner) to avoid taking a transitive
	 * dependency just for this.
	 */
	function wrapInParagraph(node: LexicalNode): void {
		const paragraph = createParagraphNode();
		node.replace(paragraph);
		paragraph.append(node);
		paragraph.selectEnd();
	}

	/**
	 * Drops the uploaded image in place of the placeholder identified by `key`.
	 */
	function replacePlaceholderWithImage(
		editor: LexicalEditor,
		key: string,
		src: string,
		altText: string
	): void {
		editor.update(() => {
			const node = getNodeByKey(key);
			// The user may have deleted the placeholder mid-upload, or the key no
			// longer points at one (already replaced) - bail in both cases.
			if (!node || node.getType() !== 'uploading-image') return;
			const imageNode = createImageNode({ src, altText });
			node.replace(imageNode);
			if (isRootOrShadowRoot(imageNode.getParentOrThrow())) {
				wrapInParagraph(imageNode);
			}
		});
	}

	/** Removes a still-pending placeholder (upload failed or was cancelled). */
	function removePlaceholder(editor: LexicalEditor, key: string): void {
		editor.update(() => {
			const node = getNodeByKey(key);
			if (node && node.getType() === 'uploading-image') {
				node.remove();
			}
		});
	}

	async function uploadAndInsertImage(editor: LexicalEditor, file: File) {
		const MAX_ATTACHMENT = 5 * 1024 * 1024;
		if (file.size > MAX_ATTACHMENT) {
			setUploadError(t.upload.fileTooLarge);
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
			setUploadError(t.upload.invalidType);
			return;
		}

		// Reserve the image's spot up front with an in-place spinner. Its stable
		// key anchors the eventual ImageNode to where the user pasted, so the
		// finished image never jumps to the (possibly moved) live selection -
		// the fix for pasting several images or typing mid-upload.
		//
		// The key is captured by the update callback writing into `placeholderKey`,
		// which we read only after `await fetch` below. That is robust to update
		// timing: the native paste path runs the callback synchronously, and even
		// the beforeinput path (which nests inside another update) runs it within
		// the same tick - long before any network await resolves.
		let placeholderKey: string | null = null;
		editor.update(() => {
			let selection = getSelection();
			if (!isRangeSelection(selection)) {
				getRoot().selectEnd();
				selection = getSelection();
			}
			if (!isRangeSelection(selection)) return;
			const placeholder = createUploadingImageNode();
			(selection as SelectionWithInsertNodes).insertNodes?.([placeholder]);
			if (isRootOrShadowRoot(placeholder.getParentOrThrow())) {
				wrapInParagraph(placeholder);
			}
			placeholderKey = placeholder.getKey();
		});

		try {
			const res = await fetch('/upload', {
				method: 'POST',
				body: file
			});
			const result = (await res.json()) as UploadResponse;

			if (!res.ok || !result.url) {
				setUploadError(result.error || t.upload.uploadFailed);
				if (placeholderKey) removePlaceholder(editor, placeholderKey);
				return;
			}

			if (placeholderKey) {
				replacePlaceholderWithImage(editor, placeholderKey, result.url, file.name);
			}
		} catch {
			setUploadError(t.auth.networkError);
			if (placeholderKey) removePlaceholder(editor, placeholderKey);
		}
	}

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

	// registerCommand overload for commands that carry a payload (FORMAT_TEXT_COMMAND,
	// PASTE_COMMAND). The void-only RegisterCommandFn above cannot describe them.
	type AnyCommandHandler = (payload: unknown) => boolean;
	type RegisterAnyCommandFn = (
		command: unknown,
		handler: AnyCommandHandler,
		priority: number
	) => VoidHandler;
	interface EditorWithAnyCommands {
		registerCommand?: RegisterAnyCommandFn;
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

	type InsertNodesFn = (nodes: unknown[]) => void;

	interface SelectionWithInsertNodes {
		insertNodes?: InsertNodesFn;
	}

	// Structural types for the spoiler toggle command. We mirror Lexical's
	// RangeSelection/TextNode/Point shapes instead of importing them directly,
	// to avoid cross-package type conflicts with svelte-lexical's bundled lexical.
	type GetTextContentSizeFn = () => number;
	type IsFlagFn = () => boolean;
	type IsNodeFn = (node: unknown) => boolean;
	type SetPointFn = (key: string, offset: number, type: string) => void;
	type SplitTextFn = (...offsets: number[]) => SpoilerTextNode[];

	interface SpoilerPointLike {
		type: string;
		offset: number;
		set: SetPointFn;
	}

	interface SpoilerSelectionLike {
		anchor: SpoilerPointLike;
		focus: SpoilerPointLike;
		isBackward: IsFlagFn;
		getNodes: GetNodesFn;
	}

	interface SpoilerTextNode {
		__key: string;
		is: IsNodeFn;
		getStyle: GetStyleFn;
		setStyle: SetStyleFn;
		getTextContentSize: GetTextContentSizeFn;
		splitText: SplitTextFn;
	}

	/**
	 * Add or remove the spoiler sentinel on a text node's inline style string.
	 * No-op when the node already matches the requested state (prevents the
	 * whole-node toggle thrash that the old per-node loop produced).
	 */
	function applySpoilerStyle(node: SpoilerTextNode, add: boolean): void {
		const style = node.getStyle() ?? '';
		const hasSpoiler = style.includes('--janbao-spoiler');
		if (add && !hasSpoiler) {
			node.setStyle(style ? `${style} ${SPOILER_STYLE_MARKER}` : SPOILER_STYLE_MARKER);
		} else if (!add && hasSpoiler) {
			// Strip the whole `--janbao-spoiler: <value>;` custom-property declaration.
			node.setStyle(style.replace(/--janbao-spoiler:\s*[^;]*;?\s*/g, '').trim());
		}
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
		// Spoiler is feature-gated: when off, don't register the command at all
		// (the toolbar button is hidden too). Reading features.spoiler re-runs
		// this effect if the user toggles it in settings.
		if (!features.spoiler) return;
		const castEditor = editorInstance as EditorWithTransform;
		if (!castEditor.registerCommand || !castEditor.update) return;

		const unregister = castEditor.registerCommand(
			TOGGLE_SPOILER_COMMAND,
			() => {
				castEditor.update!(() => {
					const selection = getSelection();
					if (!isRangeSelection(selection)) return;
					const rangeSelection = selection as SpoilerSelectionLike;
					const anchor = rangeSelection.anchor;
					const focus = rangeSelection.focus;
					const isBackward = rangeSelection.isBackward();
					const startPoint = isBackward ? focus : anchor;
					const endPoint = isBackward ? anchor : focus;

					const nodes = rangeSelection.getNodes() ?? [];
					// Filter to text nodes; style only applies to TextNodes.
					const textNodes = nodes.filter((node) =>
						isTextNodeFn(node as Parameters<typeof isTextNodeFn>[0])
					) as SpoilerTextNode[];
					if (textNodes.length === 0) return;

					let firstIndex = 0;
					let firstNode = textNodes[0];
					let startOffset = startPoint.type === 'element' ? 0 : startPoint.offset;

					// If selection begins at the very end of the first text node,
					// the first node contributes nothing - advance to the next.
					if (startPoint.type === 'text' && startOffset === firstNode.getTextContentSize()) {
						firstIndex = 1;
						firstNode = textNodes[1];
						startOffset = 0;
					}
					if (!firstNode) return;

					const lastIndex = textNodes.length - 1;
					let lastNode = textNodes[lastIndex];
					const endOffset =
						endPoint.type === 'element' ? lastNode.getTextContentSize() : endPoint.offset;

					// Toggle direction mirrors Lexical's formatText: invert based on
					// whether the first selected node already carries the marker.
					const add = !(firstNode.getStyle() ?? '').includes('--janbao-spoiler');

					if (firstNode.is(lastNode)) {
						// Single node selected. Nothing actually highlighted -> no-op
						// (also handles collapsed selections safely).
						if (startOffset === endOffset) return;
						if (startOffset === 0 && endOffset === firstNode.getTextContentSize()) {
							// Entire node is selected - style it whole.
							applySpoilerStyle(firstNode, add);
						} else {
							// Partial selection - split so only the highlighted span is styled.
							const splitNodes = firstNode.splitText(startOffset, endOffset);
							const target = startOffset === 0 ? splitNodes[0] : splitNodes[1];
							applySpoilerStyle(target, add);
						}
						return;
					}

					// Multiple nodes: trim the partially-selected head and tail, then
					// style the head remainder, every middle node, and the tail prefix.
					if (startOffset !== 0) {
						const headParts = firstNode.splitText(startOffset);
						firstNode = headParts[headParts.length - 1];
					}
					applySpoilerStyle(firstNode, add);

					if (endOffset > 0) {
						if (endOffset !== lastNode.getTextContentSize()) {
							const tailParts = lastNode.splitText(endOffset);
							lastNode = tailParts[0];
						}
						applySpoilerStyle(lastNode, add);
					}

					for (let i = firstIndex + 1; i < lastIndex; i++) {
						applySpoilerStyle(textNodes[i], add);
					}
				});
				return true;
			},
			COMMAND_PRIORITY_EDITOR
		);
		return () => unregister();
	});

	// Defense-in-depth for feature toggles + plain-text paste. High-priority
	// command handlers swallow formatting the user has disabled so it cannot be
	// applied even via keyboard (the toolbar button is already hidden):
	//  - FORMAT_TEXT_COMMAND: block bold/italic/underline/strikethrough/highlight
	//    from Ctrl+B/I/U etc. (allowed formats pass through to the default handler).
	//  - PASTE_COMMAND: in plain-text mode, strip clipboard content to text/plain
	//    and insert as raw text, preempting Lexical's rich-HTML paste; otherwise
	//    fall through to the default. Re-registers when `features` changes.
	$effect(() => {
		const f = features;
		if (!editorInstance) return;
		const castEditor = editorInstance as EditorWithAnyCommands;
		if (!castEditor.registerCommand || !castEditor.update) return;

		const allowedFormats = new Set<string>([
			...(f.bold ? ['bold'] : []),
			...(f.italic ? ['italic'] : []),
			...(f.underline ? ['underline'] : []),
			...(f.strikethrough ? ['strikethrough'] : []),
			...(f.highlight ? ['highlight'] : [])
		]);
		const unregisterFormat = castEditor.registerCommand(
			FORMAT_TEXT_COMMAND,
			(payload: unknown) =>
				typeof payload === 'string' && allowedFormats.has(payload) ? false : true,
			COMMAND_PRIORITY_HIGH
		);

		const unregisterPaste = castEditor.registerCommand(
			PASTE_COMMAND,
			(event: unknown) => {
				const clipboardEvent = event as ClipboardEvent;

				// Handle image pasting if image feature is enabled and not in plain mode
				if (!f.plainMode && f.image) {
					const files = clipboardEvent.clipboardData?.files;
					if (files && files.length > 0) {
						const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
						if (imageFiles.length > 0) {
							clipboardEvent.preventDefault();
							for (const file of imageFiles) {
								uploadAndInsertImage(editorInstance as LexicalEditor, file);
							}
							return true;
						}
					}
				}

				if (!f.plainMode) return false;

				clipboardEvent.preventDefault();
				const text = clipboardEvent.clipboardData?.getData('text/plain') ?? '';
				castEditor.update!(() => {
					const selection = getSelection();
					if (isRangeSelection(selection)) {
						selection.insertRawText(text);
					}
				});
				return true;
			},
			COMMAND_PRIORITY_HIGH
		);

		return () => {
			unregisterFormat();
			unregisterPaste();
		};
	});

	// Nodes required by the editor
	const editorNodes = [
		HeadingNode,
		QuoteNode,
		ListNode,
		ListItemNode,
		ImageNode,
		UploadingImageNode,
		AutoLinkNode,
		LinkNode,
		CodeNode,
		CodeHighlightNode,
		MentionNode,
		DeadImageNode
	];

	// Markdown transformers, filtered to only the enabled features. The master
	// `markdown` toggle empties the list entirely (MarkdownShortcutPlugin is also
	// unmounted in the template when it is off); per-feature toggles then drop
	// their own transformer so e.g. `**bold**` cannot render when bold is off.
	const markdownTransformers = $derived(
		features.markdown
			? [
					...(features.bold ? [BOLD_STAR, BOLD_UNDERSCORE] : []),
					...(features.italic ? [ITALIC_STAR, ITALIC_UNDERSCORE] : []),
					...(features.strikethrough ? [STRIKETHROUGH] : []),
					...(features.headings ? [HEADING] : []),
					...(features.link ? [LINK] : []),
					...(features.bulletList ? [UNORDERED_LIST] : []),
					...(features.numberedList ? [ORDERED_LIST] : []),
					...(features.checklist ? [CHECK_LIST] : [])
				]
			: []
	);

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
		// Strip uploading placeholders from everything that leaves the editor: the
		// parent's content model (onContentChange) and the autosave getter. They
		// are a transient visual affordance and must never be persisted - a draft
		// saved mid-upload or a post published mid-upload would otherwise capture
		// a spinner block. toJSON() returns a fresh tree each call, so the in-place
		// mutation in stripUploadingPlaceholders is safe.
		editorStateGetter = () =>
			JSON.stringify(stripUploadingPlaceholders(castEditor.getEditorState?.().toJSON() ?? {}));
		const json = JSON.stringify(stripUploadingPlaceholders(editorState.toJSON()));
		onContentChange?.(json);
	}

	/**
	 * Recursively removes every uploading-image placeholder from a serialized
	 * editor state, in place. Returns the same object for fluent use in
	 * JSON.stringify. See handleChange for why placeholders must be stripped.
	 */
	function stripUploadingPlaceholders(state: unknown): unknown {
		const typed = state as SerializedStateLike;
		if (typed.root) removeUploadingNodes(typed.root);
		return state;
	}

	function removeUploadingNodes(node: SerializedNodeLike): void {
		if (!Array.isArray(node.children)) return;
		node.children = node.children.filter((child) => child?.type !== 'uploading-image');
		for (const child of node.children) {
			removeUploadingNodes(child);
		}
	}

	// Ctrl/Cmd+Enter signals submit intent to the parent. Plain Enter is left
	// alone so line breaks, lists, and the mention typeahead keep working.
	// The parent decides whether to actually submit (empty/over-limit/in-flight).
	function handleEditorKeydown(event: KeyboardEvent) {
		if (disabled) return;
		if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
			event.preventDefault();
			onSubmit?.();
		}
	}

	$effect(() => {
		const elem = editorAreaElem;
		if (!elem) return;
		elem.addEventListener('keydown', handleEditorKeydown);
		return () => elem.removeEventListener('keydown', handleEditorKeydown);
	});

	// Autosave: POST to /api/drafts/save every 30 seconds
	function startAutosave() {
		stopAutosave();
		if (!contextType) return;

		autosaveTimer = setInterval(async () => {
			if (!editorStateGetter || !contextType || isSaving) return;
			if (!getOnlineStore().online) return;

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
						contextId,
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

	// Derived save status label - uses i18n keys. Image-upload progress is now
	// shown in-place via the UploadingImageNode spinner, so only errors and
	// autosave status surface here.
	const saveStatusLabel = $derived.by(() => {
		if (uploadError) return uploadError;
		if (saveStatus === 'saving') return t.editor.saving;
		if (saveStatus === 'saved') return t.editor.saved;
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

	/**
	 * Programmatically inserts text at the current selection.
	 * Focuses the editor first to ensure selection is active.
	 */
	export function insertText(text: string) {
		if (!editorInstance) return;
		const castEditor = editorInstance as { update: UpdateFn; focus: VoidHandler };
		castEditor.focus();
		castEditor.update(() => {
			let selection = getSelection();
			if (!isRangeSelection(selection)) {
				getRoot().selectEnd();
				selection = getSelection();
			}
			if (isRangeSelection(selection)) {
				selection.insertText(text);
			}
		});
	}

	/**
	 * Inserts a mention chip (MentionNode) at the current selection.
	 * The chip shows @displayName in the editor and exports @username for backend processing.
	 */
	export function insertMention(username: string, displayName: string) {
		if (!editorInstance) return;
		const castEditor = editorInstance as { update: UpdateFn; focus: VoidHandler };
		castEditor.focus();
		castEditor.update(() => {
			let selection = getSelection();
			if (!isRangeSelection(selection)) {
				getRoot().selectEnd();
				selection = getSelection();
			}
			if (isRangeSelection(selection)) {
				const sel = selection as SelectionWithInsertNodes;
				const mentionNode = createMentionNode(username, displayName);
				sel.insertNodes?.([mentionNode]);
				// Insert trailing space after the chip
				selection = getSelection();
				if (isRangeSelection(selection)) {
					selection.insertText(' ');
				}
			}
		});
	}
</script>

<div
	class="janbao-rich-editor relative border border-base-300 bg-base-100 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all duration-200 {features.plainMode
		? 'janbao-rich-editor--plain'
		: ''} {className}"
>
	<Composer {initialConfig}>
		<EditorInstanceSync update={(e: unknown) => (editorInstance = e)} />

		{#if !features.plainMode}
			<div class={disabled ? 'opacity-60 pointer-events-none' : ''}>
				<Toolbar>
					{#snippet children({ activeEditor })}
						<RichTextToolbar {activeEditor} {features} {disableHeadings} {t} />
					{/snippet}
				</Toolbar>
			</div>
		{/if}

		<!-- Editor Area -->
		<div
			bind:this={editorAreaElem}
			class="relative overflow-y-auto {disabled ? 'opacity-60 pointer-events-none' : ''}"
			style="max-height: {editorMaxHeight}"
		>
			<ContentEditable
				ariaLabel={resolvedPlaceholder}
				className="ContentEditable__root prose prose-sm max-w-none break-words min-h-[200px] px-3 py-2 text-base-content bg-base-100 focus:outline-none"
			/>
			<RichTextPlugin />
			<HistoryPlugin />
			{#if features.bulletList || features.numberedList || features.checklist}
				<ListPlugin />
			{/if}
			{#if features.image}
				<ImagePlugin />
			{/if}
			{#if features.link}
				<LinkPlugin {validateUrl} />
			{/if}
			{#if features.autolink}
				<AutoLinkPlugin />
			{/if}
			{#if features.link}
				<RichTextLinkEditor anchorElem={editorAreaElem} {t} />
			{/if}
			<MentionTypeaheadPlugin {excludeIds} />
			{#if features.markdown}
				<MarkdownShortcutPlugin transformers={markdownTransformers} />
			{/if}
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

	<!-- Save Status  - floating overlay (anchored to the relative root) rather
	     than in-flow. Appearing/disappearing no longer changes the editor's
	     height, so the page stops jumping on every autosave. -->
	{#if saveStatusLabel}
		<div
			class="absolute bottom-1.5 right-2 z-30 rounded-selector bg-base-200/90 px-2 py-0.5 text-xs text-base-content/50 shadow-sm backdrop-blur-sm pointer-events-none"
		>
			{saveStatusLabel}
		</div>
	{/if}

	<!-- Visual loading overlay to prevent editor unmounting and data loss -->
	{#if disabled}
		<div
			class="janbao-rich-editor-overlay absolute inset-0 z-40 flex items-center justify-center bg-base-100/50 backdrop-blur-[1px]"
		>
			<span class="loading loading-spinner loading-sm text-primary"></span>
			<span class="ml-2 text-sm text-base-content/60">{t.editor.loading}</span>
		</div>
	{/if}
</div>

<style>
	.janbao-rich-editor {
		border-radius: var(--radius-field, 0.5rem);
	}

	/* Prevent children backgrounds from bleeding over rounded corners */
	.janbao-rich-editor :global(.rounded-t-field) {
		border-top-left-radius: max(0px, calc(var(--radius-field, 0.5rem) - 1px));
		border-top-right-radius: max(0px, calc(var(--radius-field, 0.5rem) - 1px));
	}

	.janbao-rich-editor :global(.ContentEditable__root) {
		border-bottom-left-radius: max(0px, calc(var(--radius-field, 0.5rem) - 1px));
		border-bottom-right-radius: max(0px, calc(var(--radius-field, 0.5rem) - 1px));
	}

	/* Plain-text mode: the toolbar (which carries the top corner radii via
	   .rounded-t-field) is unmounted, so the content area is now the topmost
	   child and must carry the top corners too - otherwise its square top
	   corners are clipped by the outer container's rounded border. */
	.janbao-rich-editor--plain :global(.ContentEditable__root) {
		border-top-left-radius: max(0px, calc(var(--radius-field, 0.5rem) - 1px));
		border-top-right-radius: max(0px, calc(var(--radius-field, 0.5rem) - 1px));
	}

	.janbao-rich-editor-overlay {
		border-radius: max(0px, calc(var(--radius-field, 0.5rem) - 1px));
	}
</style>
