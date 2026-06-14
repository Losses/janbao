<script lang="ts">
	import {
		TOGGLE_LINK_COMMAND,
		$isAutoLinkNode as isAutoLinkNode,
		$isLinkNode as isLinkNode
	} from '@lexical/link';
	import { $findMatchingParent as findMatchingParent, mergeRegister } from '@lexical/utils';
	import {
		$getSelection as getSelection,
		$isRangeSelection as isRangeSelection,
		CLICK_COMMAND,
		COMMAND_PRIORITY_CRITICAL,
		COMMAND_PRIORITY_LOW,
		COMMAND_PRIORITY_HIGH,
		KEY_ESCAPE_COMMAND,
		SELECTION_CHANGE_COMMAND,
		$isLineBreakNode as isLineBreakNode,
		$isNodeSelection as isNodeSelection,
		type RangeSelection,
		type NodeSelection,
		type EditorState
	} from 'lexical';
	import { $isAtNodeEnd as isAtNodeEnd } from '@lexical/selection';
	import { writable } from 'svelte/store';
	import { onMount } from 'svelte';
	import { getEditor } from 'svelte-lexical';
	import { sanitizeUrl } from 'svelte-lexical';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiClose, mdiCheck, mdiPencil, mdiDelete } from '@mdi/js';
	import type { TranslationDict } from '$lib/types/translation';

	interface Props {
		anchorElem: HTMLElement | undefined;
		t?: TranslationDict | null;
	}

	interface UpdateListenerPayload {
		editorState: EditorState;
	}

	let { anchorElem, t = null }: Props = $props();

	const editor = getEditor();
	let activeEditor = $state(editor);
	const isLink = writable(false);
	const isEditMode = writable(false);

	let editorRef: HTMLDivElement | undefined = $state();
	let inputRef: HTMLInputElement | undefined = $state();
	let linkUrl = $state('');
	let editedLinkUrl = $state('');
	let lastSelection: RangeSelection | NodeSelection | null = null;

	function preventDefault(event: MouseEvent) {
		event.preventDefault();
	}

	// Focus input when edit mode is activated
	$effect(() => {
		if ($isEditMode && inputRef) {
			inputRef.focus();
		}
	});

	// Append floating editor element to anchor element
	$effect(() => {
		if (anchorElem && editorRef) {
			anchorElem.appendChild(editorRef);
		}
	});

	// Local implementation of getSelectedNode to avoid deep import type resolution issues
	function getSelectedNode(selection: RangeSelection) {
		const anchor = selection.anchor;
		const focus = selection.focus;
		const anchorNode = selection.anchor.getNode();
		const focusNode = selection.focus.getNode();
		if (anchorNode === focusNode) {
			return anchorNode;
		}
		const isBackward = selection.isBackward();
		if (isBackward) {
			return isAtNodeEnd(focus) ? anchorNode : focusNode;
		} else {
			return isAtNodeEnd(anchor) ? focusNode : anchorNode;
		}
	}

	// Local implementation of setFloatingElemPositionForLinkEditor to avoid deep import type resolution issues
	function setFloatingElemPositionForLinkEditor(
		targetRect: DOMRect | null,
		floatingElem: HTMLElement,
		anchorElement: HTMLElement,
		verticalGap = 6,
		horizontalOffset = 5
	) {
		const scrollerElem = anchorElement.parentElement;
		if (targetRect === null || !scrollerElem) {
			floatingElem.style.opacity = '0';
			floatingElem.style.transform = 'translate(-10000px, -10000px)';
			return;
		}
		const floatingElemRect = floatingElem.getBoundingClientRect();
		const anchorElementRect = anchorElement.getBoundingClientRect();
		const editorScrollerRect = scrollerElem.getBoundingClientRect();

		// Position below the text (往下窜一行)
		let top = targetRect.bottom + verticalGap;
		let left = targetRect.left - horizontalOffset;

		// If it overflows the bottom of the scroller, place it above the text instead
		if (top + floatingElemRect.height > editorScrollerRect.bottom) {
			const topPosition = targetRect.top - floatingElemRect.height - verticalGap;
			if (topPosition >= editorScrollerRect.top) {
				top = topPosition;
			}
		}

		// Ensure it stays horizontally within the scroller bounds
		if (left + floatingElemRect.width > editorScrollerRect.right) {
			left = editorScrollerRect.right - floatingElemRect.width - horizontalOffset;
		}
		if (left < editorScrollerRect.left) {
			left = editorScrollerRect.left + horizontalOffset;
		}

		top -= anchorElementRect.top;
		left -= anchorElementRect.left;
		floatingElem.style.opacity = '1';
		floatingElem.style.transform = `translate(${left}px, ${top}px)`;
	}

	function updateLinkEditor() {
		const selection = getSelection();
		if (isRangeSelection(selection)) {
			const focusNode = getSelectedNode(selection);
			const focusLinkNode = findMatchingParent(focusNode, isLinkNode);
			const focusAutoLinkNode = findMatchingParent(focusNode, isAutoLinkNode);

			if (!(focusLinkNode || focusAutoLinkNode)) {
				$isLink = false;
				return;
			}

			const badNode = selection
				.getNodes()
				.filter((node) => !isLineBreakNode(node))
				.find((node) => {
					const linkNode = findMatchingParent(node, isLinkNode);
					const autoLinkNode = findMatchingParent(node, isAutoLinkNode);
					return (
						(focusLinkNode && !focusLinkNode.is(linkNode)) ||
						(linkNode && !linkNode.is(focusLinkNode)) ||
						(focusAutoLinkNode && !focusAutoLinkNode.is(autoLinkNode)) ||
						(autoLinkNode && (!autoLinkNode.is(focusAutoLinkNode) || autoLinkNode.getIsUnlinked()))
					);
				});

			if (!badNode) {
				$isLink = true;
			} else {
				$isLink = false;
			}

			// Update URLs
			if (isLinkNode(focusLinkNode)) {
				linkUrl = focusLinkNode.getURL();
			} else if (isLinkNode(focusAutoLinkNode)) {
				linkUrl = focusAutoLinkNode.getURL();
			} else {
				linkUrl = '';
			}
			if ($isEditMode) {
				editedLinkUrl = linkUrl;
			}
		} else if (isNodeSelection(selection)) {
			const nodes = selection.getNodes();
			if (nodes.length === 0) {
				$isLink = false;
				return;
			}
			const node = nodes[0];
			const parent = node.getParent();
			if (isLinkNode(node)) {
				$isLink = true;
				linkUrl = node.getURL();
			} else if (parent !== null && isLinkNode(parent)) {
				$isLink = true;
				linkUrl = parent.getURL();
			} else {
				$isLink = false;
				linkUrl = '';
			}
			if ($isEditMode) {
				editedLinkUrl = linkUrl;
			}
		} else {
			$isLink = false;
		}

		const editorElem = editorRef;
		if (!editorElem) return;

		// Use the selection DOM rect to place the editor
		const nativeSelection = window.getSelection();
		const activeElement = document.activeElement;
		const rootElement = editor.getRootElement();

		if (
			$isLink &&
			selection !== null &&
			rootElement !== null &&
			editor.isEditable() &&
			rootElement.contains(nativeSelection?.anchorNode || null)
		) {
			let domRect: DOMRect | undefined;
			if (isNodeSelection(selection)) {
				const nodes = selection.getNodes();
				if (nodes.length > 0) {
					const element = editor.getElementByKey(nodes[0].getKey());
					if (element) {
						domRect = element.getBoundingClientRect();
					}
				}
			} else if (nativeSelection !== null && rootElement.contains(nativeSelection.anchorNode)) {
				domRect = nativeSelection.focusNode?.parentElement?.getBoundingClientRect();
			}

			if (domRect && anchorElem) {
				setFloatingElemPositionForLinkEditor(domRect, editorElem, anchorElem);
			}
			lastSelection = selection as RangeSelection | NodeSelection | null;
		} else if (!activeElement || activeElement.className !== 'link-input') {
			if (rootElement !== null && anchorElem) {
				setFloatingElemPositionForLinkEditor(null, editorElem, anchorElem);
			}
			lastSelection = null;
			$isEditMode = false;
			linkUrl = '';
		}
		return true;
	}

	onMount(() => {
		const scrollerElem = anchorElem?.parentElement;
		const update = () => {
			editor.getEditorState().read(() => {
				updateLinkEditor();
			});
		};

		window.addEventListener('resize', update);
		if (scrollerElem) {
			scrollerElem.addEventListener('scroll', update);
		}

		return mergeRegister(
			() => {
				window.removeEventListener('resize', update);
				if (scrollerElem) {
					scrollerElem.removeEventListener('scroll', update);
				}
			},
			editor.registerUpdateListener(({ editorState }: UpdateListenerPayload) => {
				editorState.read(() => {
					updateLinkEditor();
				});
			}),
			editor.registerCommand(
				SELECTION_CHANGE_COMMAND,
				() => {
					updateLinkEditor();
					return true;
				},
				COMMAND_PRIORITY_LOW
			),
			editor.registerCommand(
				KEY_ESCAPE_COMMAND,
				() => {
					if ($isLink) {
						$isLink = false;
						return true;
					}
					return false;
				},
				COMMAND_PRIORITY_HIGH
			),
			editor.registerCommand(
				CLICK_COMMAND,
				(payload: MouseEvent) => {
					const selection = getSelection();
					if (isRangeSelection(selection)) {
						const node = getSelectedNode(selection);
						const linkNode = findMatchingParent(node, isLinkNode);
						if (isLinkNode(linkNode) && (payload.metaKey || payload.ctrlKey)) {
							window.open(linkNode.getURL(), '_blank');
							return true;
						}
					}
					return false;
				},
				COMMAND_PRIORITY_LOW
			),
			editor.registerCommand(
				TOGGLE_LINK_COMMAND,
				(payload: string | null) => {
					if (payload === 'https://') {
						$isEditMode = true;
					}
					return false;
				},
				COMMAND_PRIORITY_CRITICAL
			)
		);
	});

	// Handle link submission when clicking check/Enter key
	function handleLinkSubmission(event: Event) {
		event.preventDefault();
		if (lastSelection !== null) {
			if (editedLinkUrl !== '') {
				activeEditor.update(() => {
					activeEditor.dispatchCommand(TOGGLE_LINK_COMMAND, sanitizeUrl(editedLinkUrl));
				});
			}
			$isEditMode = false;
		}
	}

	function monitorInputInteraction(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			handleLinkSubmission(event);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			$isEditMode = false;
		}
	}
</script>

<div
	bind:this={editorRef}
	class="absolute z-50 bg-base-100 border border-base-300 rounded-box shadow-lg p-2 flex items-center gap-2 transition-opacity duration-200"
	style="opacity: {$isLink ? 1 : 0}; pointer-events: {$isLink
		? 'auto'
		: 'none'}; top: 0; left: 0; will-change: transform;"
>
	{#if $isLink}
		{#if $isEditMode}
			<input
				bind:this={inputRef}
				class="input input-bordered input-xs max-w-xs link-input text-base-content bg-base-100"
				placeholder={t?.editor?.enterUrl ?? 'Enter URL...'}
				bind:value={editedLinkUrl}
				onkeydown={monitorInputInteraction}
			/>
			<button
				type="button"
				class="btn btn-xs btn-ghost btn-circle text-error"
				onmousedown={preventDefault}
				onclick={() => ($isEditMode = false)}
				title={t?.common?.cancel ?? 'Cancel'}
			>
				<Icon path={mdiClose} size={14} />
			</button>
			<button
				type="button"
				class="btn btn-xs btn-ghost btn-circle text-success"
				onmousedown={preventDefault}
				onclick={handleLinkSubmission}
				title={t?.common?.confirm ?? 'Confirm'}
			>
				<Icon path={mdiCheck} size={14} />
			</button>
		{:else}
			<a
				href={sanitizeUrl(linkUrl)}
				target="_blank"
				rel="noopener noreferrer"
				class="link link-primary link-hover text-xs max-w-[200px] truncate"
			>
				{linkUrl}
			</a>
			<button
				type="button"
				class="btn btn-xs btn-ghost btn-circle"
				onmousedown={preventDefault}
				onclick={(event) => {
					event.preventDefault();
					editedLinkUrl = linkUrl;
					$isEditMode = true;
				}}
				title={t?.common?.edit ?? 'Edit'}
			>
				<Icon path={mdiPencil} size={14} />
			</button>
			<button
				type="button"
				class="btn btn-xs btn-ghost btn-circle text-error"
				onmousedown={preventDefault}
				onclick={() => {
					activeEditor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
				}}
				title={t?.editor?.remove ?? 'Remove'}
			>
				<Icon path={mdiDelete} size={14} />
			</button>
		{/if}
	{/if}
</div>
