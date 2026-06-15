/**
 * Audit crawled discussion pages for anomalies.
 *
 * Usage: bun run scripts/audit-discussion-pages.ts <data-dir>
 *
 * For each discussion, every page file declares which real page it is via the
 * pager's Highlight marker: class="Highlight p-N" (or class="p-N ... Highlight").
 * We compare that against the filename's implied page (page-000001 → 1, etc.)
 * and flag:
 *
 *   missing_real_page — a real page (1..N) that no file covers. Most serious:
 *                       real page 1 missing means the OP + early replies are lost.
 *   duplicate_page    — two or more files cover the same real page (e.g. 1054,
 *                       where page-1 and page-3 are both real page 3).
 *   out_of_order      — files are not in ascending real-page order.
 *   no_real_page_1    — no file covers real page 1 (OP is gone), regardless of
 *                       whether other pages duplicate.
 *
 * Output: writes discussion-page-audit.json (full detail) and prints a summary
 * + the discussions that most need a re-crawl (missing real page 1).
 */
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

interface FilePageInfo {
	file: string;
	realPage: number | null; // from pager Highlight; null if single-page (no pager)
	firstItem: number | null;
	lastItem: number | null;
	commentCount: number;
}

interface DiscussionAudit {
	discussionId: number;
	fileCount: number;
	files: FilePageInfo[];
	realPagesCovered: number[];
	missingRealPages: number[];
	duplicateRealPages: number[];
	noRealPage1: boolean;
}

function detectRealPage(html: string): number | null {
	// Single-page discussions have no pager at all → null.
	const pagerMatch = html.match(/<span[^>]*class="Pager NumberedPager"[^>]*>([\s\S]*?)<\/span>/);
	if (!pagerMatch) return null;
	const pager = pagerMatch[1];
	// Vanilla marks the current page with a "Highlight" class on its <a>/<span>,
	// plus a "p-N" class. Extract the p-N off that same element.
	const hiElem = pager.match(/<(?:a|span)[^>]*class="[^"]*\bHighlight\b[^"]*"[^>]*>/);
	if (hiElem) {
		const pn = hiElem[0].match(/\bp-(\d+)\b/);
		if (pn) return parseInt(pn[1], 10);
		// Fallback: the visible page number inside the highlighted element.
		const inner = pager.slice(pager.indexOf(hiElem[0]));
		const num = inner.match(/>(\d+)</);
		if (num) return parseInt(num[1], 10);
	}
	return null;
}

function filePageInfo(html: string, file: string): FilePageInfo {
	const ids = [...html.matchAll(/id="Comment_(\d+)"/g)].map((m) => m[1]);
	const items = [...html.matchAll(/name="Item_(\d+)"/g)].map((m) => parseInt(m[1], 10));
	return {
		file,
		realPage: detectRealPage(html),
		firstItem: items.length ? Math.min(...items) : null,
		lastItem: items.length ? Math.max(...items) : null,
		commentCount: ids.length
	};
}

function main() {
	const dataDir = process.argv[2];
	if (!dataDir || !existsSync(dataDir)) {
		console.error('Usage: bun run scripts/audit-discussion-pages.ts <data-dir>');
		process.exit(1);
	}
	const discussionsDir = join(dataDir, 'discussions');
	if (!existsSync(discussionsDir)) {
		console.error(`No discussions dir at ${discussionsDir}`);
		process.exit(1);
	}

	const ids = readdirSync(discussionsDir)
		.filter((d) => /^\d+$/.test(d))
		.map(Number)
		.sort((a, b) => a - b);
	const audits: DiscussionAudit[] = [];
	let totalFiles = 0;

	for (const id of ids) {
		const dir = join(discussionsDir, String(id));
		const files = readdirSync(dir)
			.filter((f) => /^page-\d+\.html$/.test(f))
			.sort();
		if (files.length === 0) continue;
		totalFiles += files.length;

		const infos: FilePageInfo[] = files.map((f) =>
			filePageInfo(readFileSync(join(dir, f), 'utf-8'), f)
		);

		// Group files by the real page they cover. null real-page files (no pager,
		// single-page discussions) each cover "page 1" implicitly.
		const byRealPage = new Map<number, string[]>();
		for (const info of infos) {
			const rp = info.realPage ?? 1;
			if (!byRealPage.has(rp)) byRealPage.set(rp, []);
			byRealPage.get(rp)!.push(info.file);
		}
		const realPagesCovered = [...byRealPage.keys()].sort((a, b) => a - b);

		// Missing: if multi-page (pager present somewhere), page 1..max should all
		// exist. For single-page discussions, realPagesCovered = [1], nothing missing.
		const missing: number[] = [];
		const duplicates: number[] = [];
		const hasPager = infos.some((i) => i.realPage !== null);
		if (hasPager) {
			const maxPage = Math.max(...realPagesCovered);
			for (let p = 1; p <= maxPage; p++) {
				if (!byRealPage.has(p)) missing.push(p);
			}
			for (const [p, fs] of byRealPage) {
				if (fs.length > 1) duplicates.push(p);
			}
		}

		audits.push({
			discussionId: id,
			fileCount: files.length,
			files: infos,
			realPagesCovered,
			missingRealPages: missing,
			duplicateRealPages: duplicates,
			noRealPage1: hasPager && !byRealPage.has(1)
		});
	}

	const anomalies = audits.filter(
		(a) => a.missingRealPages.length > 0 || a.duplicateRealPages.length > 0 || a.noRealPage1
	);
	const missingPage1 = anomalies.filter((a) => a.noRealPage1);
	const withDuplicates = audits.filter((a) => a.duplicateRealPages.length > 0);

	console.log(`Scanned ${audits.length} discussions (${totalFiles} page files).`);
	console.log(`Anomalous discussions: ${anomalies.length}`);
	console.log(`  - missing real page 1 (OP lost): ${missingPage1.length}`);
	console.log(`  - with duplicate pages:           ${withDuplicates.length}`);

	const out = {
		scanned: audits.length,
		totalFiles,
		anomalous: anomalies.length,
		missingRealPage1: missingPage1.length,
		withDuplicates: withDuplicates.length,
		// Discussions needing a re-crawl of page 1 (OP + early replies lost):
		missingPage1Ids: missingPage1.map((a) => a.discussionId),
		discussions: anomalies.map((a) => ({
			discussionId: a.discussionId,
			fileCount: a.fileCount,
			realPagesCovered: a.realPagesCovered,
			missingRealPages: a.missingRealPages,
			duplicateRealPages: a.duplicateRealPages,
			noRealPage1: a.noRealPage1,
			files: a.files.map((f) => ({
				file: f.file,
				realPage: f.realPage,
				items: [f.firstItem, f.lastItem],
				comments: f.commentCount
			}))
		}))
	};
	writeFileSync(
		join(process.cwd(), 'discussion-page-audit.json'),
		JSON.stringify(out, null, 2),
		'utf-8'
	);
	console.log('\nFull detail → discussion-page-audit.json');
	console.log('\nFirst 20 missing-page-1 (need re-crawl):');
	console.log(
		missingPage1
			.slice(0, 20)
			.map((a) => a.discussionId)
			.join(', ')
	);
}

main();
