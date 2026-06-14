import { test, expect } from 'bun:test';
import { lexicalToSearchText, isLexicalEmpty } from './lexical';

test('lexicalToSearchText: null / undefined / empty → empty string', () => {
	expect(lexicalToSearchText(null)).toBe('');
	expect(lexicalToSearchText(undefined)).toBe('');
	expect(lexicalToSearchText('')).toBe('');
});

test('lexicalToSearchText: invalid JSON → empty string', () => {
	expect(lexicalToSearchText('{not valid json')).toBe('');
});

test('lexicalToSearchText: plain text paragraph', () => {
	const doc = {
		root: {
			type: 'root',
			children: [{ type: 'paragraph', children: [{ type: 'text', text: '你好世界' }] }]
		}
	};
	expect(lexicalToSearchText(JSON.stringify(doc))).toBe('你好世界');
});

test('lexicalToSearchText: mention node yields username + displayName', () => {
	const doc = {
		root: {
			type: 'root',
			children: [
				{
					type: 'paragraph',
					children: [
						{ type: 'text', text: '感谢 ' },
						{ type: 'mention', username: 'alice', displayName: 'Alice' }
					]
				}
			]
		}
	};
	expect(lexicalToSearchText(JSON.stringify(doc))).toBe('感谢 alice Alice');
});

test('lexicalToSearchText: image altText is indexed', () => {
	const doc = {
		root: {
			type: 'root',
			children: [{ type: 'image', src: 'x.png', altText: '一只猫的照片' }]
		}
	};
	expect(lexicalToSearchText(JSON.stringify(doc))).toBe('一只猫的照片');
});

test('lexicalToSearchText: image without altText yields empty', () => {
	const doc = {
		root: { type: 'root', children: [{ type: 'image', src: 'x.png', altText: '' }] }
	};
	expect(lexicalToSearchText(JSON.stringify(doc))).toBe('');
});

test('lexicalToSearchText: nested link text is collected', () => {
	const doc = {
		root: {
			type: 'root',
			children: [
				{
					type: 'paragraph',
					children: [
						{ type: 'text', text: '参见 ' },
						{
							type: 'link',
							url: 'https://example.com',
							children: [{ type: 'text', text: '文档' }]
						}
					]
				}
			]
		}
	};
	expect(lexicalToSearchText(JSON.stringify(doc))).toBe('参见 文档');
});

test('lexicalToSearchText: multiple fragments joined by single space', () => {
	const doc = {
		root: {
			type: 'root',
			children: [
				{ type: 'paragraph', children: [{ type: 'text', text: '第一段' }] },
				{ type: 'paragraph', children: [{ type: 'text', text: '第二段' }] }
			]
		}
	};
	expect(lexicalToSearchText(JSON.stringify(doc))).toBe('第一段 第二段');
});

test('lexicalToSearchText: dead-image and structure-only nodes contribute nothing', () => {
	const doc = {
		root: {
			type: 'root',
			children: [{ type: 'dead-image' }]
		}
	};
	expect(lexicalToSearchText(JSON.stringify(doc))).toBe('');
});

test('lexicalToSearchText: heading / list / quote descend into children', () => {
	const doc = {
		root: {
			type: 'root',
			children: [
				{ type: 'heading', children: [{ type: 'text', text: '标题文本' }] },
				{
					type: 'list',
					children: [
						{ type: 'listitem', children: [{ type: 'text', text: '条目一' }] },
						{ type: 'listitem', children: [{ type: 'text', text: '条目二' }] }
					]
				},
				{ type: 'quote', children: [{ type: 'text', text: '引用内容' }] }
			]
		}
	};
	expect(lexicalToSearchText(JSON.stringify(doc))).toBe('标题文本 条目一 条目二 引用内容');
});

test('isLexicalEmpty: still works alongside the new extractor', () => {
	const empty = JSON.stringify({ root: { type: 'root', children: [{ type: 'dead-image' }] } });
	expect(isLexicalEmpty(empty)).toBe(true);
	expect(lexicalToSearchText(empty)).toBe('');
});
