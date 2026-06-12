import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
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
		rules: {
			'@typescript-eslint/no-explicit-any': 'error',
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
				}
			]
		}
	}
);
