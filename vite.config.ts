import adapterAuto from '@sveltejs/adapter-auto';
import adapterNode from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-auto keeps Cloudflare deployment behavior unchanged. Docker builds set
			// ADAPTER=node to emit a standalone server for the Bun runtime image.
			adapter: process.env.ADAPTER === 'node' ? adapterNode() : adapterAuto(),

			typescript: {
				config: (config) => ({
					...config,
					include: [...config.include, '../drizzle.config.ts']
				})
			}
		})
	],
	resolve: {
		dedupe: ['lexical']
	},
	ssr: {
		noExternal: [
			'lexical',
			'@lexical/clipboard',
			'@lexical/code',
			'@lexical/file',
			'@lexical/hashtag',
			'@lexical/history',
			'@lexical/html',
			'@lexical/link',
			'@lexical/list',
			'@lexical/mark',
			'@lexical/markdown',
			'@lexical/overflow',
			'@lexical/plain-text',
			'@lexical/rich-text',
			'@lexical/selection',
			'@lexical/table',
			'@lexical/text',
			'@lexical/utils',
			'@lexical/yjs',
			'svelte-lexical'
		],
		// Prevent Vite from bundling libsql during production builds.
		// These modules are dynamically imported in the local development
		// database path (never reached in Cloudflare production).
		external: ['@libsql/client']
	}
});
