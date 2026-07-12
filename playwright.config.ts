import { defineConfig, devices } from '@playwright/test';

/**
 * Mobile E2E for the back-swipe matrix. Runs under node (`npx playwright test`)
 * while the app/dev server stays Bun. On NixOS `playwright install` can't fetch
 * a browser, so we point at the system Chromium via executablePath - the
 * Playwright driver ships in the npm package (no `playwright install` needed),
 * and the core CDP we use (Input.dispatchTouchEvent, Emulation, Network) is
 * stable across Chromium versions.
 */

const BROWSER = process.env.E2E_BROWSER ?? '/run/current-system/sw/bin/chromium';
// Dedicated port + reuseExistingServer:false → Playwright starts a FRESH dev
// server for each run. This sidesteps HMR state corruption that builds up in a
// long-lived dev server across edits (orphaned modules / stale singletons),
// which made gesture/backTarget behaviour flaky. It also keeps the E2E run
// off whatever server you may already be browsing in.
const PORT = Number(process.env.E2E_PORT ?? 5174);
const BASE = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
	testDir: './e2e',
	// Sequential: one chromium, one dev server, one admin session - avoids
	// login/DB contention and keeps gesture timing deterministic.
	fullyParallel: false,
	workers: 1,
	// A full sequential run (~196 specs, one fresh dev server) degrades the dev
	// server over ~10 min, so timing-sensitive specs intermittently time out
	// late in the run despite passing in isolation. Two retries passes those
	// intermittent flakes (Playwright marks them flaky in the list reporter)
	// while a real regression still fails every attempt. trace:'on-first-retry'
	// captures the first failure for diagnosis.
	retries: 2,
	reporter: 'list',
	timeout: 30_000,
	use: {
		baseURL: BASE,
		trace: 'on-first-retry',
		...devices['Pixel 5'],
		launchOptions: {
			executablePath: BROWSER,
			args: ['--no-sandbox', '--disable-dev-shm-usage']
		}
	},
	webServer: {
		command: `bun run dev -- --port ${PORT} --strictPort`,
		url: BASE,
		reuseExistingServer: false,
		timeout: 120_000
	}
});
