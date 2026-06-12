import adapter from '@sveltejs/adapter-auto';
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

			// adapter-auto detects Cloudflare Pages via CF_PAGES env var and uses
			// @sveltejs/adapter-cloudflare when deployed. Both adapters are installed
			// to ensure the Cloudflare adapter is available at build time.
			// See https://svelte.dev/docs/kit/adapter-auto for supported environments.
			adapter: adapter(),

			typescript: {
				config: (config) => ({
					...config,
					include: [...config.include, '../drizzle.config.ts']
				})
			}
		})
	],
	ssr: {
		// Prevent Vite from bundling libsql during production builds.
		// These modules are dynamically imported in the local development
		// database path (never reached in Cloudflare production).
		external: ['@libsql/client']
	}
});
