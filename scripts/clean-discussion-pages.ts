/**
 * Remove mislabeled and duplicate discussion page files.
 *
 * The original crawler mislabeled pages (e.g. saved real-page-2 as
 * page-000001.html) and sometimes fetched the same real page twice. This
 * dedupes each discussion by REAL page number (from the pager's Highlight
 * marker), keeping one file per real page and deleting the rest.
 *
 * Preference for which copy to keep, per real page:
 *   1. the file whose filename number equals the real page number (correctly
 *      labeled), else
 *   2. the lowest-numbered filename (stable, deterministic).
 *
 * Safety: a file is only deleted when ANOTHER file covers the same real page.
 * Single-page discussions (no pager) are always kept. Files whose real page
 * can't be detected are kept (never deleted on guesswork).
 *
 * Usage:
 *   bun run scripts/clean-discussion-pages.ts <data-dir>           # dry-run (list only)
 *   JANBAO_APPLY=1 bun run scripts/clean-discussion-pages.ts <data-dir>   # actually delete
 */
import { readdirSync, readFileSync, existsSync, unlinkSync, appendFileSync } from 'fs';
import { join } from 'path';

interface FilePageInfo {
	file: string;
	filePage: number;
	realPage: number | null;
}

function detectRealPage(html: string): number | null {
	const pm = html.match(/<span[^>]*class="Pager NumberedPager"[^>]*>([\s\S]*?)<\/span>/);
	if (!pm) return null;
	const hi = pm[1].match(/<(?:a|span)[^>]*class="[^"]*\bHighlight\b[^"]*"[^>]*>/);
	if (hi) {
		const pn = hi[0].match(/\bp-(\d+)\b/);
		if (pn) return parseInt(pn[1], 10);
	}
	return null;
}

const LOG_FILE = 'clean-pages.log';
function log(line: string): void {
	console.log(line);
	appendFileSync(LOG_FILE, line + '\n', 'utf-8');
}

function main() {
	const dataDir = process.argv[2];
	if (!dataDir || !existsSync(dataDir)) {
		console.error('Usage: bun run scripts/clean-discussion-pages.ts <data-dir>');
		process.exit(1);
	}
	const apply = !!process.env.JANBAO_APPLY;
	log(
		apply ? 'APPLY mode: deleting files.' : 'DRY-RUN: listing only (set JANBAO_APPLY=1 to delete).'
	);

	const discussionsDir = join(dataDir, 'discussions');
	const dirs = readdirSync(discussionsDir).filter((d) => /^\d+$/.test(d));

	let kept = 0;
	let deleted = 0;
	let untouchedDisc = 0;

	for (const d of dirs) {
		const discDir = join(discussionsDir, d);
		let files: string[];
		try {
			files = readdirSync(discDir).filter((f) => /^page-\d+\.html$/.test(f));
		} catch {
			continue;
		}
		if (files.length === 0) continue;

		const infos: FilePageInfo[] = files.map((f) => {
			const html = readFileSync(join(discDir, f), 'utf-8');
			return {
				file: f,
				filePage: parseInt(f.match(/^page-(\d+)/)![1], 10),
				realPage: detectRealPage(html)
			};
		});

		// Group by real page. null realPage files are ungroupable → keep all.
		const byReal = new Map<number, FilePageInfo[]>();
		const undetectable: FilePageInfo[] = [];
		for (const info of infos) {
			if (info.realPage === null) {
				undetectable.push(info);
			} else {
				const arr = byReal.get(info.realPage);
				if (arr) arr.push(info);
				else byReal.set(info.realPage, [info]);
			}
		}

		// For each real page with >1 file, pick one to keep, delete the rest.
		const toDelete: string[] = [];
		for (const [rp, group] of byReal) {
			if (group.length <= 1) continue;
			// Prefer the correctly-labeled file (filename == realPage); else lowest filename.
			const correct = group.find((g) => g.filePage === rp);
			const keeper = correct ?? group.reduce((a, b) => (a.filePage < b.filePage ? a : b));
			for (const g of group) {
				if (g.file !== keeper.file) toDelete.push(g.file);
			}
		}

		if (toDelete.length === 0) {
			untouchedDisc++;
			continue;
		}

		for (const f of toDelete) {
			const info = infos.find((i) => i.file === f)!;
			log(`  disc ${d} del ${f} (realPage=${info.realPage})`);
			if (apply) unlinkSync(join(discDir, f));
			deleted++;
		}
		kept += files.length - toDelete.length;
	}

	log(
		`\nDone. ${deleted} files ${apply ? 'deleted' : 'would be deleted'}, ${kept} kept, ${untouchedDisc} discussions untouched.`
	);
	if (!apply) log('Re-run with JANBAO_APPLY=1 to actually delete.');
}

main();
