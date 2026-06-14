/**
 * MentionNode - A custom Lexical DecoratorNode that renders as an inline
 * mention chip showing @displayName. Stores both username (for backend
 * mention resolution) and displayName (for visual rendering).
 *
 * Follows the svelte-lexical DOM-based decorator pattern (like HorizontalRuleNode):
 * createDOM() builds the element, decorate() returns null, skipDecorateRender = true.
 */
import { DecoratorNode, $applyNodeReplacement } from 'lexical';
import type {
	NodeKey,
	SerializedLexicalNode,
	DOMConversionMap,
	DOMConversionOutput,
	DOMExportOutput
} from 'lexical';

interface SerializedMentionNode extends SerializedLexicalNode {
	username: string;
	displayName: string;
	type: 'mention';
	version: number;
}

/**
 * Reconstructs a MentionNode from a pasted <span data-lexical-mention> element.
 * Paired with exportDOM() below so copy/paste round-trips the full chip
 * (username + displayName), not just plain text.
 */
function convertMentionElement(element: HTMLElement): DOMConversionOutput {
	const username = element.getAttribute('data-lexical-username') ?? '';
	const displayName = element.getAttribute('data-lexical-display-name') ?? '';
	return { node: createMentionNode(username, displayName || username) };
}

export class MentionNode extends DecoratorNode<unknown> {
	__username: string;
	__displayName: string;

	/** Tells Decorator.svelte to skip rendering via decorate(). */
	static skipDecorateRender = true;

	static getType(): string {
		return 'mention';
	}

	static clone(node: MentionNode): MentionNode {
		return new MentionNode(node.__username, node.__displayName, node.__key);
	}

	static importJSON(serializedNode: SerializedMentionNode): MentionNode {
		return createMentionNode(serializedNode.username, serializedNode.displayName);
	}

	/**
	 * Match the spans produced by exportDOM() on paste and convert them back
	 * into MentionNodes. Silences Lexical's "should implement importDOM"
	 * warning when a custom exportDOM is present.
	 */
	static importDOM(): DOMConversionMap {
		return {
			span: (domNode: HTMLElement) => {
				if (!domNode.hasAttribute('data-lexical-mention')) return null;
				return {
					conversion: convertMentionElement,
					priority: 1
				};
			}
		};
	}

	constructor(username: string, displayName: string, key?: NodeKey) {
		super(key);
		this.__username = username;
		this.__displayName = displayName;
	}

	createDOM(): HTMLElement {
		const span = document.createElement('span');
		span.className =
			'inline-flex items-center px-1.5 py-0 mx-0.5 -my-0.5 rounded bg-primary/15 text-primary font-medium';
		span.contentEditable = 'false';
		span.textContent = `@${this.__displayName}`;
		return span;
	}

	updateDOM(): boolean {
		return false;
	}

	exportJSON(): SerializedMentionNode {
		return {
			type: 'mention',
			username: this.__username,
			displayName: this.__displayName,
			version: 1
		};
	}

	exportDOM(): DOMExportOutput {
		const element = document.createElement('span');
		// Tag with data attributes so importDOM can reconstruct the chip on
		// paste. Visible text mirrors the in-editor chip (@displayName).
		element.setAttribute('data-lexical-mention', 'true');
		element.setAttribute('data-lexical-username', this.__username);
		element.setAttribute('data-lexical-display-name', this.__displayName);
		element.textContent = `@${this.__displayName}`;
		return { element };
	}

	decorate(): null {
		return null;
	}

	isInline(): boolean {
		return true;
	}

	getTextContent(): string {
		return `@${this.__username} `;
	}
}

export function createMentionNode(username: string, displayName: string): MentionNode {
	return $applyNodeReplacement(new MentionNode(username, displayName));
}
