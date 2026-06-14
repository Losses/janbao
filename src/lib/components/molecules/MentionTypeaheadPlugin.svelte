<script lang="ts">
	/**
	 * MentionTypeaheadPlugin - Lexical plugin that shows a user autocomplete
	 * dropdown when typing @ followed by username characters in the editor.
	 *
	 * Must be rendered inside a <Composer> block (uses getEditor() context).
	 * Built from scratch because svelte-lexical's TypeAheadMenu is not exported
	 * from the package's `exports` field. Follows the same pattern as RichTextLinkEditor.
	 */
	import {
		$getSelection as getSelection,
		$isRangeSelection as isRangeSelection,
		$isTextNode as isTextNodeFn,
		COMMAND_PRIORITY_LOW,
		KEY_ARROW_DOWN_COMMAND,
		KEY_ARROW_UP_COMMAND,
		KEY_ENTER_COMMAND,
		KEY_ESCAPE_COMMAND,
		KEY_TAB_COMMAND
	} from 'lexical';
	import type { TextNode } from 'lexical';

	import { getEditor } from 'svelte-lexical';
	import { onMount } from 'svelte';
	import { createMentionNode } from '$lib/components/atoms/MentionNode';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import type { UserSearchResult } from '$lib/types/api';

	interface MentionTypeaheadPluginProps {
		/** User IDs to exclude from suggestions */
		excludeIds?: number[];
	}

	let { excludeIds = [] }: MentionTypeaheadPluginProps = $props();

	const editor = getEditor();

	// --- State ---
	let menuRef: HTMLDivElement | undefined = $state();
	let anchorElem: HTMLElement | undefined = $state();
	let isVisible = $state(false);
	let results = $state<UserSearchResult[]>([]);
	let selectedIndex = $state(0);

	// Track the text node containing @query and its offset so we can replace it
	let matchedTextNode: TextNode | null = null;
	let matchedOffset = 0;
	let matchedLength = 0;
	// Cursor rect captured when @ is typed; reused to position the menu after
	// the results list renders (menuRef only binds once results arrive).
	let lastTargetRect: DOMRect | null = null;

	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let unregisterFns: (() => void)[] = [];

	// --- Trigger regex ---
	const MENTION_TRIGGER_REGEX = /(^|\s)(@([\p{L}\p{N}_-]{0,30}))$/u;

	type KeyboardCommandHandler = (event: KeyboardEvent) => boolean;

	/**
	 * Select the highlighted suggestion. preventDefault is essential: Lexical
	 * dispatches KEY_ENTER_COMMAND without preventing the native Enter, so without
	 * this the browser still fires a beforeinput "insertParagraph" and inserts a
	 * blank line even after our handler returns true.
	 */
	function selectHighlighted(event: KeyboardEvent): boolean {
		if (!isVisible || results.length === 0) return false;
		event.preventDefault();
		const user = results[selectedIndex];
		if (user) insertMention(user);
		return true;
	}

	// --- Positioning ---
	function positionMenu(targetRect: DOMRect | null) {
		if (!menuRef || !anchorElem) return;
		if (!targetRect) {
			menuRef.style.opacity = '0';
			return;
		}

		const anchorRect = anchorElem.getBoundingClientRect();
		const menuRect = menuRef.getBoundingClientRect();
		const viewportHeight = window.innerHeight;
		const viewportWidth = window.innerWidth;

		// top/left are offsets from the anchor's top-left corner. The menu is
		// position:absolute inside the anchor, so these place it directly (NOT
		// relative to its flow position, which is why transform was wrong).
		let top = targetRect.bottom + 4 - anchorRect.top;
		let left = targetRect.left - anchorRect.left;

		// Flip above the cursor if it would overflow the viewport bottom
		if (targetRect.bottom + menuRect.height + 4 > viewportHeight) {
			const topAbove = targetRect.top - menuRect.height - 4 - anchorRect.top;
			if (topAbove + anchorRect.top > 0) {
				top = topAbove;
			}
		}

		// Clamp horizontally to the viewport
		if (left + anchorRect.left + menuRect.width > viewportWidth) {
			left = viewportWidth - anchorRect.left - menuRect.width - 4;
		}
		if (left < 0) left = 4;

		menuRef.style.opacity = '1';
		menuRef.style.left = `${left}px`;
		menuRef.style.top = `${top}px`;
	}

	// --- Close ---
	function closeMenu() {
		isVisible = false;
		results = [];
		selectedIndex = 0;
		matchedTextNode = null;
		lastTargetRect = null;
		if (debounceTimer) {
			clearTimeout(debounceTimer);
			debounceTimer = undefined;
		}
	}

	// --- Search ---
	async function searchUsers(query: string) {
		try {
			const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}&limit=5`);
			if (res.ok) {
				const data = (await res.json()) as { users: UserSearchResult[] };
				const excludeSet = new Set(excludeIds);
				const filtered = (data.users || []).filter((u) => !excludeSet.has(u.id));
				// Sort: username-prefix matches first
				const q = query.toLowerCase();
				filtered.sort((a, b) => {
					const aU = a.username.toLowerCase().startsWith(q) ? 0 : 1;
					const bU = b.username.toLowerCase().startsWith(q) ? 0 : 1;
					return aU - bU;
				});
				results = filtered;
				selectedIndex = 0;
				if (results.length === 0) {
					closeMenu();
				}
			} else {
				closeMenu();
			}
		} catch {
			closeMenu();
		}
	}

	// --- Insert mention ---
	function insertMention(user: UserSearchResult) {
		// Capture the match into locals: editor.update may defer its callback
		// (e.g. when invoked from a Lexical command handler), and closeMenu()
		// below resets the module-level vars before that callback runs.
		const node = matchedTextNode;
		const offset = matchedOffset;
		const length = matchedLength;
		editor.update(() => {
			if (node) {
				// Remove the @query portion from the text node
				const text = node.getTextContent();
				const before = text.slice(0, offset);
				const after = text.slice(offset + length);
				node.setTextContent(before + after);

				// Insert mention chip after the modified text node
				const mentionNode = createMentionNode(user.username, user.displayName);
				node.insertAfter(mentionNode);
				// Place cursor after the mention and insert a trailing space
				mentionNode.selectNext();
				const sel = getSelection();
				if (isRangeSelection(sel)) {
					sel.insertText(' ');
				}
			}
		});
		closeMenu();
	}

	// --- Update listener: detect @ trigger ---
	function checkTrigger() {
		if (!editor.isEditable()) {
			closeMenu();
			return;
		}

		const selection = getSelection();
		if (!isRangeSelection(selection) || !selection.isCollapsed()) {
			if (isVisible) closeMenu();
			return;
		}

		const anchor = selection.anchor;
		const node = anchor.getNode();
		if (!isTextNodeFn(node)) {
			if (isVisible) closeMenu();
			return;
		}

		const text = node.getTextContent();
		const offset = anchor.offset;
		const textBeforeCursor = text.slice(0, offset);

		const match = MENTION_TRIGGER_REGEX.exec(textBeforeCursor);
		if (!match) {
			if (isVisible) closeMenu();
			return;
		}

		// match[1] = preceding whitespace (or empty for start)
		// match[2] = @query (including @)
		// match[3] = query (without @)
		const query = match[3];

		matchedTextNode = node as TextNode;
		matchedOffset = match.index + match[1].length;
		matchedLength = match[2].length;

		// Debounce search
		if (debounceTimer) clearTimeout(debounceTimer);
		if (query.length === 0) {
			// Just typed @, show empty results while searching
			isVisible = true;
			results = [];
			debounceTimer = setTimeout(() => {
				void searchUsers('');
			}, 250);
		} else {
			debounceTimer = setTimeout(() => {
				void searchUsers(query);
			}, 250);
			// Keep menu visible while typing
			if (!isVisible && results.length > 0) {
				isVisible = true;
			}
		}

		// Position menu near cursor
		positionMenuAtCursor();
	}

	function positionMenuAtCursor() {
		const nativeSelection = window.getSelection();
		if (nativeSelection && nativeSelection.rangeCount > 0) {
			const range = nativeSelection.getRangeAt(0);
			lastTargetRect = range.getBoundingClientRect();
		}
		isVisible = true;
	}

	// The listbox only mounts once results arrive, so we cannot position it
	// synchronously in checkTrigger (menuRef is unbound then). Reposition
	// after every DOM update while the menu is open.
	$effect(() => {
		if (isVisible && results.length > 0) {
			positionMenu(lastTargetRect);
		}
	});

	// --- Mount: register listeners ---
	onMount(() => {
		const rootElement = editor.getRootElement();
		if (rootElement) {
			// Create anchor container inside editor area
			const parent = rootElement.parentElement;
			if (parent) {
				anchorElem = parent;
			}
		}

		unregisterFns = [
			editor.registerUpdateListener(() => {
				editor.getEditorState().read(() => {
					checkTrigger();
				});
			}),
			editor.registerCommand(
				KEY_ARROW_DOWN_COMMAND,
				((event) => {
					if (!isVisible || results.length === 0) return false;
					event.preventDefault();
					selectedIndex = (selectedIndex + 1) % results.length;
					scrollSelectedIntoView();
					return true;
				}) satisfies KeyboardCommandHandler,
				COMMAND_PRIORITY_LOW
			),
			editor.registerCommand(
				KEY_ARROW_UP_COMMAND,
				((event) => {
					if (!isVisible || results.length === 0) return false;
					event.preventDefault();
					selectedIndex = (selectedIndex - 1 + results.length) % results.length;
					scrollSelectedIntoView();
					return true;
				}) satisfies KeyboardCommandHandler,
				COMMAND_PRIORITY_LOW
			),
			editor.registerCommand(KEY_ENTER_COMMAND, selectHighlighted, COMMAND_PRIORITY_LOW),
			editor.registerCommand(KEY_TAB_COMMAND, selectHighlighted, COMMAND_PRIORITY_LOW),
			editor.registerCommand(
				KEY_ESCAPE_COMMAND,
				((event) => {
					if (!isVisible) return false;
					event.preventDefault();
					closeMenu();
					return true;
				}) satisfies KeyboardCommandHandler,
				COMMAND_PRIORITY_LOW
			)
		];

		return () => {
			for (const fn of unregisterFns) fn();
			if (debounceTimer) clearTimeout(debounceTimer);
		};
	});

	function scrollSelectedIntoView() {
		if (!menuRef) return;
		const items = menuRef.querySelectorAll('[role="option"]');
		const item = items[selectedIndex] as HTMLElement | undefined;
		item?.scrollIntoView({ block: 'nearest' });
	}

	function handleSelect(user: UserSearchResult) {
		insertMention(user);
	}
</script>

{#if isVisible && results.length > 0}
	<div
		bind:this={menuRef}
		class="absolute z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg overflow-hidden"
		style="opacity: 0; min-width: 200px; max-height: 240px; overflow-y: auto;"
		role="listbox"
	>
		{#each results as user, index (user.id)}
			<button
				type="button"
				class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors {selectedIndex ===
				index
					? 'bg-base-200'
					: 'hover:bg-base-200'}"
				role="option"
				aria-selected={selectedIndex === index}
				onclick={() => handleSelect(user)}
				onmouseenter={() => (selectedIndex = index)}
			>
				<Avatar
					userId={user.id}
					avatarFileId={user.avatarFileId}
					displayName={user.displayName}
					size="xs"
				/>
				<span class="min-w-0 flex-1">
					<span class="block truncate text-sm font-medium text-base-content">
						{user.displayName}
					</span>
					<span class="block truncate text-xs text-base-content/50">
						@{user.username}
					</span>
				</span>
			</button>
		{/each}
	</div>
{/if}
