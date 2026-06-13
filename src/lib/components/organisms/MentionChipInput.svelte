<script lang="ts">
	/**
	 * MentionChipInput - A minimal Lexical editor that ONLY accepts @mention chips.
	 * Used for the message recipient field where only user mention chips are valid input.
	 * All other content (plain text, formatting) is filtered out on extraction.
	 *
	 * Features:
	 * - Type @ to trigger user search autocomplete
	 * - Selected user becomes a MentionNode chip
	 * - Chips are shown inline with @displayName
	 * - On change, extracts mention data and fires onRecipientsChange
	 * - No toolbar, no formatting, no markdown shortcuts
	 */
	import {
		Composer,
		ContentEditable,
		RichTextPlugin,
		HistoryPlugin,
		PlaceHolder,
		OnChangePlugin
	} from 'svelte-lexical';
	import { MentionNode } from '$lib/components/atoms/MentionNode';
	import MentionTypeaheadPlugin from '$lib/components/molecules/MentionTypeaheadPlugin.svelte';
	import type { UserSearchResult } from '$lib/types/api';

	type ContentChangeHandler = (json: string) => void;
	type RecipientsChangeHandler = (users: UserSearchResult[]) => void;
	type ToJSONFn = () => unknown;

	interface LexicalNode {
		type: string;
		username?: string;
		displayName?: string;
		children?: LexicalNode[];
	}

	interface EditorStateLike {
		toJSON: ToJSONFn;
	}

	interface MentionChipInputProps {
		/** Placeholder text */
		placeholder?: string;
		/** User IDs to exclude from suggestions */
		excludeIds?: string[];
		/** Pre-loaded recipients (e.g. from URL prefill) */
		initialRecipients?: UserSearchResult[];
		/** Called with the current list of mention recipients on every change */
		onRecipientsChange?: RecipientsChangeHandler;
		/** Called with raw Lexical JSON on every change */
		onContentChange?: ContentChangeHandler;
		/** Disable the input */
		disabled?: boolean;
	}

	let {
		placeholder = 'Add recipients...',
		excludeIds = [],
		initialRecipients,
		onRecipientsChange,
		onContentChange,
		disabled = false
	}: MentionChipInputProps = $props();

	// Build initial content from prefill recipients
	const initialContent = $derived.by(() => {
		if (!initialRecipients || initialRecipients.length === 0) return undefined;
		const mentionChildren = initialRecipients.map((r) => ({
			type: 'mention',
			username: r.username,
			displayName: r.displayName,
			version: 1
		}));
		mentionChildren.push({ type: 'text', text: ' ', format: 0 });
		return JSON.stringify({
			root: {
				children: [
					{
						type: 'paragraph',
						children: mentionChildren,
						direction: null,
						format: '',
						indent: 0,
						version: 1
					}
				],
				direction: null,
				format: '',
				indent: 0,
				type: 'root',
				version: 1
			}
		});
	});

	const editorNodes = [MentionNode];

	const initialConfig = $derived({
		namespace: 'JanbaoMentionChipInput',
		theme: {
			paragraph: 'mb-0',
			text: {}
		},
		nodes: editorNodes,
		editorState: initialContent ?? undefined,
		onError: (error: Error) => {
			console.error('MentionChipInput Error:', error);
		}
	});

	function handleChange(editorState: EditorStateLike) {
		const json = JSON.stringify(editorState.toJSON());
		onContentChange?.(json);
		extractRecipients(json);
	}

	function extractRecipients(contentJson: string) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(contentJson);
		} catch {
			onRecipientsChange?.([]);
			return;
		}

		const users: UserSearchResult[] = [];
		collectMentions(parsed, users);
		onRecipientsChange?.(users);
	}

	function collectMentions(node: unknown, out: UserSearchResult[]): void {
		if (!node || typeof node !== 'object') return;
		const lexicalNode = node as LexicalNode;

		if (
			lexicalNode.type === 'mention' &&
			typeof lexicalNode.username === 'string' &&
			typeof lexicalNode.displayName === 'string'
		) {
			out.push({
				id: lexicalNode.username,
				username: lexicalNode.username,
				displayName: lexicalNode.displayName,
				avatarFileId: null
			});
		}

		if (Array.isArray(lexicalNode.children)) {
			for (const child of lexicalNode.children) {
				collectMentions(child, out);
			}
		}
	}
</script>

<div
	class="mention-chip-input relative rounded-lg border border-base-300 bg-base-100 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all duration-200"
>
	<Composer {initialConfig}>
		<div class={disabled ? 'opacity-60 pointer-events-none' : ''}>
			<div class="relative {disabled ? 'opacity-60 pointer-events-none' : ''}">
				<ContentEditable
					ariaLabel={placeholder}
					className="ContentEditable__root prose prose-sm max-w-none min-h-[40px] px-3 py-2 text-base-content bg-base-100 focus:outline-none"
				/>
				<RichTextPlugin />
				<HistoryPlugin />
				<OnChangePlugin
					ignoreHistoryMergeTagChange={true}
					ignoreSelectionChange={true}
					onChange={handleChange}
				/>
				<PlaceHolder>
					{placeholder}
				</PlaceHolder>
			</div>
		</div>
		<MentionTypeaheadPlugin {excludeIds} />
	</Composer>
</div>
