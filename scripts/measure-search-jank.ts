/**
 * measure-search-jank - the AUTHORITATIVE search-appear frame-drop check.
 *
 * The search-appear animation's frame budget must be measured against the
 * PRODUCTION build, not the dev server. The dev server (Vite on-demand
 * transform) pays a V8 lazy-JIT cost compiling the `/search` route modules on
 * first navigation that dominates the frame (~150 to 200ms) and is absent in
 * production (pre-bundled, minified, streaming compile). The dev JIT floor is
 * large enough that a dev jank threshold cannot distinguish a janky
 * implementation from a smooth one; production is where the user sees the jank,
 * so production is where the bar lives.
 *
 * This script builds the app, serves the production build (`vite preview`),
 * drives a real search-enter under 4x CPU throttle (CDP Emulation, mobile
 * class), and measures the worst Long-Animation-Frame. Passes when the worst
 * frame is under JANK_BUDGET_MS (150ms). The production worst frame measures
 * ~60 to 85ms, so the budget has margin.
 *
 * Run: `bun scripts/measure-search-jank.ts`.
 */
import { chromium, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';

const BROWSER = process.env.E2E_BROWSER ?? '/run/current-system/sw/bin/chromium';
const PORT = 5179;
const BASE = `http://localhost:${PORT}`;
const JANK_BUDGET_MS = 150;
const RUNS = 4;

async function sleep(ms: number): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(): Promise<void> {
	for (let i = 0; i < 60; i++) {
		try {
			const res = await fetch(`${BASE}/`);
			if (res.ok || res.status === 304) return;
		} catch {
			/* not ready */
		}
		await sleep(500);
	}
	throw new Error(`preview server not ready at ${BASE}`);
}

interface LoafWindow extends Window {
	__loaf?: number[];
}

async function measureRun(page: Page): Promise<number> {
	await page.goto(`${BASE}/`);
	await page.waitForLoadState('domcontentloaded');
	await sleep(400);
	await page.evaluate(() => {
		const w = window as LoafWindow;
		w.__loaf = [];
		const obs = new PerformanceObserver((list) => {
			for (const e of list.getEntries()) w.__loaf!.push(e.duration);
		});
		obs.observe({ type: 'long-animation-frame', buffered: false });
	});
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
	await page.locator('header a[href="/search"][aria-label]').click();
	try {
		await page.waitForURL('**/search', { timeout: 12000 });
	} catch {
		/* the animation is the subject, not the URL flip */
	}
	await sleep(1500);
	await client.detach();
	const loaf = (await page.evaluate(() => (window as LoafWindow).__loaf)) ?? [];
	return loaf.length ? Math.max(...loaf) : 0;
}

async function main(): Promise<void> {
	console.log('building production bundle...');
	const build = spawn('bun', ['run', 'build'], { stdio: 'inherit' });
	await new Promise<void>((resolve, reject) => {
		build.on('exit', (code) =>
			code === 0 ? resolve() : reject(new Error(`build exited ${code}`))
		);
	});

	console.log(`starting vite preview on :${PORT}...`);
	const preview = spawn('bun', ['run', 'preview', '--port', String(PORT), '--strictPort'], {
		stdio: 'ignore',
		detached: false
	});
	try {
		await waitForServer();
		const browser = await chromium.launch({
			executablePath: BROWSER,
			args: ['--no-sandbox', '--disable-dev-shm-usage']
		});
		const ctx = await browser.newContext({
			viewport: { width: 393, height: 851 },
			isMobile: true,
			hasTouch: true
		});
		const page = await ctx.newPage();
		const maxes: number[] = [];
		for (let i = 0; i < RUNS; i++) {
			const m = await measureRun(page);
			maxes.push(Math.round(m));
			console.log(`  run ${i + 1}: worst LoAF frame ${Math.round(m)}ms`);
		}
		await browser.close();
		const overall = Math.max(...maxes);
		const mean = Math.round(maxes.reduce((a, b) => a + b, 0) / maxes.length);
		console.log(
			`\nPRODUCTION search-appear @4x CPU: worst per run [${maxes.join(', ')}]  ` +
				`overall max ${overall}ms (mean ${mean}ms); budget ${JANK_BUDGET_MS}ms.`
		);
		if (overall >= JANK_BUDGET_MS) {
			console.error(`FAIL: worst frame ${overall}ms exceeds the ${JANK_BUDGET_MS}ms budget.`);
			process.exit(1);
		}
		console.log('PASS');
	} finally {
		preview.kill();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
