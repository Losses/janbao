import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

// Bans the em dash (U+2014) everywhere: comments, strings, identifiers, JSX/Svelte text.
// Runs once per file as a raw text scan so it is not limited to specific AST node kinds.
const noEmdash = {
	meta: {
		type: 'problem',
		schema: [],
		messages: {
			emdash:
				'Do not use the em dash character (U+2014). Use a comma, semicolon, colon, parentheses, or reword instead.'
		}
	},
	create(context) {
		const sourceCode = context.sourceCode;
		// Escape form so this file does not trip its own rule.
		const EMDASH = '\u2014';
		return {
			Program() {
				const text = sourceCode.text;
				let index = text.indexOf(EMDASH);
				while (index !== -1) {
					context.report({
						node: sourceCode.getNodeByRangeIndex(index) ?? sourceCode.ast,
						loc: sourceCode.getLocFromIndex(index),
						messageId: 'emdash'
					});
					index = text.indexOf(EMDASH, index + EMDASH.length);
				}
			}
		};
	}
};

// Treats any file as plain text so text-scan rules (no-emdash) can also run on
// non-JS sources such as Markdown. The AST is an empty Program; the original
// source stays on sourceCode.text, which is what the rules read.
const plainTextParser = {
	meta: {
		name: 'plain-text-parser',
		version: 1
	},
	parseForESLint(code) {
		const lines = code.length === 0 ? [] : code.split('\n');
		const endLine = Math.max(1, lines.length);
		const endColumn = lines.length === 0 ? 0 : lines[lines.length - 1].length;
		return {
			ast: {
				type: 'Program',
				body: [],
				sourceType: 'module',
				comments: [],
				tokens: [],
				range: [0, code.length],
				loc: {
					start: { line: 1, column: 0 },
					end: { line: endLine, column: endColumn }
				}
			},
			services: {},
			visitorKeys: { Program: [] }
		};
	}
};

export default defineConfig(
	{
		// E2E is test infrastructure driven by @playwright/test under node; it is
		// not app code and is type-checked/run by Playwright itself, not the
		// src lint gate.
		ignores: ['e2e/**', 'playwright.config.ts']
	},
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		// Override or add rule settings here, such as:
		// 'svelte/button-has-type': 'error'
		plugins: { local: { rules: { 'no-emdash': noEmdash } } },
		rules: {
			'local/no-emdash': 'error',
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
			'svelte/no-navigation-without-resolve': 'off',
			'no-restricted-syntax': [
				'error',
				{
					selector: 'TSAsExpression[typeAnnotation.type="TSAnyKeyword"]',
					message: 'Do not use "as any" assertions.'
				},
				{
					selector: 'TSAsExpression[typeAnnotation.type="TSUnknownKeyword"]',
					message: 'Do not use "as unknown" assertions.'
				},
				{
					selector: 'TSTypeAssertion[typeAnnotation.type="TSAnyKeyword"]',
					message: 'Do not use "<any>" type assertions.'
				},
				{
					selector: 'TSTypeAssertion[typeAnnotation.type="TSUnknownKeyword"]',
					message: 'Do not use "<unknown>" type assertions.'
				},
				{
					// Descendant combinator (not child) so types nested in intersections / unions /
					// arrays / nested function types are caught too. e.g. `Foo & { a: number }`
					selector: 'TSTypeAnnotation TSTypeLiteral',
					message: 'Do not use inline object type literals. Extract to a named type or interface.'
				},
				{
					selector: 'TSTypeParameterInstantiation TSTypeLiteral',
					message:
						'Do not use inline object type literals in type arguments. Extract to a named type or interface.'
				},
				{
					selector: 'TSTypeAnnotation TSFunctionType',
					message: 'Do not use inline function type literals. Extract to a named type.'
				},
				{
					selector: 'TSTypeParameterInstantiation TSFunctionType',
					message:
						'Do not use inline function type literals in type arguments. Extract to a named type.'
				},
				{
					selector: 'TSTypeAnnotation TSTupleType',
					message: 'Do not use inline tuple types. Extract to a named type.'
				},
				{
					selector: 'TSTypeParameterInstantiation TSTupleType',
					message: 'Do not use inline tuple types in type arguments. Extract to a named type.'
				}
			]
		}
	},
	{
		files: ['src/lib/components/organisms/MobileTabBar.svelte'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: '$app/navigation',
							importNames: ['goto'],
							message:
								'Do not use goto directly in mobile gesture/pager components. Delegate to getNavigationStore() instead.'
						}
					]
				}
			],
			'no-restricted-syntax': [
				'error',
				{
					selector: 'Identifier[name="history"]:not(MemberExpression > .property)',
					message:
						'Do not use global history directly in mobile gesture/pager components. Delegate to getNavigationStore() instead.'
				},
				{
					selector: 'MemberExpression[object.name="window"][property.name="history"]',
					message:
						'Do not use window.history directly in mobile gesture/pager components. Delegate to getNavigationStore() instead.'
				}
			]
		}
	},
	{
		// Markdown has no JS AST; parse it as plain text so the em-dash ban
		// (and any future text-scan rule) covers docs too.
		files: ['**/*.md'],
		languageOptions: {
			parser: plainTextParser
		},
		rules: {
			'local/no-emdash': 'error',
			// Markdown legitimately contains NBSP and other special whitespace;
			// no-irregular-whitespace targets source code, so opt docs out.
			'no-irregular-whitespace': 'off'
		}
	}
);
