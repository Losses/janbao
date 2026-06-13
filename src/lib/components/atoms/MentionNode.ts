/**
 * MentionNode - A custom Lexical DecoratorNode that renders as an inline
 * mention chip showing @displayName. Stores both username (for backend
 * mention resolution) and displayName (for visual rendering).
 *
 * Follows the svelte-lexical DOM-based decorator pattern (like HorizontalRuleNode):
 * createDOM() builds the element, decorate() returns null, skipDecorateRender = true.
 */
import { DecoratorNode, $applyNodeReplacement } from 'lexical';
import type { NodeKey, SerializedLexicalNode } from 'lexical';

interface ExportDomResult {
	element: HTMLElement;
}

interface SerializedMentionNode extends SerializedLexicalNode {
	username: string;
	displayName: string;
	type: 'mention';
	version: number;
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

	constructor(username: string, displayName: string, key?: NodeKey) {
		super(key);
		this.__username = username;
		this.__displayName = displayName;
	}

	createDOM(): HTMLElement {
		const span = document.createElement('span');
		span.className =
			'inline-flex items-center px-1.5 py-0 mx-0.5 rounded bg-primary/15 text-primary text-xs font-medium';
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

	exportDOM(): ExportDomResult {
		const element = document.createElement('span');
		element.textContent = `@${this.__username}`;
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
