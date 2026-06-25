/**
 * UploadingImageNode - A transient, in-place placeholder shown while a pasted
 * image uploads. It anchors the image's eventual position with a stable node
 * key, so when the upload resolves the finished ImageNode is dropped exactly
 * where the user pasted - instead of at the live selection, which may have
 * moved (the "images jumping around" problem when pasting several images or
 * typing while an upload is in flight).
 *
 * Transient by design: the editor strips every uploading-image node from its
 * serialized output before notifying the parent or autosaving, so saved drafts
 * and published posts never contain one. importJSON still reconstructs one
 * defensively (a draft saved mid-upload), but importDOM() returns null so a
 * placeholder can never be created by pasting markup.
 *
 * Follows the svelte-lexical DOM-based decorator pattern (like DeadImageNode /
 * MentionNode): createDOM() builds the element, decorate() returns null,
 * skipDecorateRender = true.
 */
import { DecoratorNode, $applyNodeReplacement } from 'lexical';
import type { NodeKey, SerializedLexicalNode } from 'lexical';

/**
 * Locale-aware label for the in-place uploading placeholder. The editor (which
 * has the request locale via `t`) sets this on mount; the default keeps it
 * language-neutral so English users never see a legacy Chinese string.
 */
let uploadingImageLabel = 'Uploading...';

export function setUploadingImageLabel(label: string): void {
	uploadingImageLabel = label;
}

interface SerializedUploadingImageNode extends SerializedLexicalNode {
	type: 'uploading-image';
	version: number;
}

export class UploadingImageNode extends DecoratorNode<unknown> {
	/** Tells Decorator.svelte to skip rendering via decorate(). */
	static skipDecorateRender = true;

	static getType(): string {
		return 'uploading-image';
	}

	static clone(node: UploadingImageNode): UploadingImageNode {
		return new UploadingImageNode(node.__key);
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	static importJSON(_serializedNode: SerializedUploadingImageNode): UploadingImageNode {
		return createUploadingImageNode();
	}

	/**
	 * Intentionally returns null: a placeholder must never be reconstructed from
	 * pasted HTML (it is created only programmatically during an upload), so
	 * users cannot produce one by pasting.
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
			'uploading-image-placeholder flex items-center justify-center gap-2 w-full my-2 px-4 py-4 rounded-field border border-dashed border-base-300 bg-base-200/40 text-base-content/50 text-sm';
		span.contentEditable = 'false';

		// daisyUI spinner, matching the editor's disabled-overlay spinner style.
		const spinner = document.createElement('span');
		spinner.className = 'loading loading-spinner loading-sm text-primary';

		const label = document.createElement('span');
		label.textContent = uploadingImageLabel;

		span.appendChild(spinner);
		span.appendChild(label);
		return span;
	}

	updateDOM(): boolean {
		return false;
	}

	exportJSON(): SerializedUploadingImageNode {
		return {
			type: 'uploading-image',
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

export function createUploadingImageNode(): UploadingImageNode {
	return $applyNodeReplacement(new UploadingImageNode());
}
