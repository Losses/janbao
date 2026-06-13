/**
 * DeadImageNode - A custom Lexical DecoratorNode that renders as a broken-image
 * placeholder for content images that failed to import (dead links, failed
 * downloads). It is import-only: no toolbar button, command, or typeahead can
 * create it, and importDOM() returns null so pasted markup never reconstructs
 * one. It exists so imported threads visually mark where an image was lost
 * instead of silently dropping it.
 *
 * Follows the svelte-lexical DOM-based decorator pattern (like MentionNode /
 * HorizontalRuleNode): createDOM() builds the element, decorate() returns null,
 * skipDecorateRender = true.
 */
import { DecoratorNode, $applyNodeReplacement } from 'lexical';
import type { NodeKey, SerializedLexicalNode } from 'lexical';
import { mdiImageBrokenVariant } from '@mdi/js';

interface SerializedDeadImageNode extends SerializedLexicalNode {
	type: 'dead-image';
	version: number;
}

export class DeadImageNode extends DecoratorNode<unknown> {
	/** Tells Decorator.svelte to skip rendering via decorate(). */
	static skipDecorateRender = true;

	static getType(): string {
		return 'dead-image';
	}

	static clone(node: DeadImageNode): DeadImageNode {
		return new DeadImageNode(node.__key);
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	static importJSON(_serializedNode: SerializedDeadImageNode): DeadImageNode {
		return createDeadImageNode();
	}

	/**
	 * Intentionally returns null: this node is import-only and must never be
	 * reconstructed from pasted HTML, so users cannot create one by pasting.
	 */
	static importDOM(): null {
		return null;
	}

	constructor(key?: NodeKey) {
		super(key);
	}

	createDOM(): HTMLElement {
		const span = document.createElement('span');
		span.className =
			'dead-image-placeholder inline-flex items-center gap-2 my-2 px-3 py-2 rounded-lg border border-dashed border-base-300 bg-base-200/50 text-base-content/60 text-sm';
		span.contentEditable = 'false';

		// mdiImageBrokenVariant path data rendered as an inline SVG (the editor
		// createDOM cannot use the Svelte Icon component).
		const svgNs = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(svgNs, 'svg');
		svg.setAttribute('xmlns', svgNs);
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('width', '20');
		svg.setAttribute('height', '20');
		svg.setAttribute('fill', 'currentColor');
		svg.style.opacity = '0.5';
		const path = document.createElementNS(svgNs, 'path');
		path.setAttribute('d', mdiImageBrokenVariant);
		svg.appendChild(path);

		const label = document.createElement('span');
		label.textContent = '图片已失效';

		span.appendChild(svg);
		span.appendChild(label);
		return span;
	}

	updateDOM(): boolean {
		return false;
	}

	exportJSON(): SerializedDeadImageNode {
		return {
			type: 'dead-image',
			version: 1
		};
	}

	decorate(): null {
		return null;
	}

	isInline(): boolean {
		return false;
	}

	getTextContent(): string {
		return '';
	}
}

export function createDeadImageNode(): DeadImageNode {
	return $applyNodeReplacement(new DeadImageNode());
}
