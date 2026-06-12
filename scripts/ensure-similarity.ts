/**
 * Downloads the correct similarity-ts binary from GitHub Releases into bin/.
 * Skips if the binary already exists.
 *
 * Usage: bun scripts/ensure-similarity.ts
 */

import { existsSync, mkdirSync, chmodSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const REPO = 'mizchi/similarity';
const VERSION = 'v0.5.0';
const BIN_DIR = join(import.meta.dirname, '..', 'bin');
const BIN_PATH = join(BIN_DIR, 'similarity-ts');

type PlatformTriple = `${string}-${string}-${string}`;

function getPlatformTriple(): PlatformTriple {
	const rawArch = process.arch;
	const arch = rawArch === 'x64' ? 'x86_64' : rawArch === 'arm64' ? 'aarch64' : rawArch;
	const platform = process.platform;

	if (platform === 'linux') return `${arch}-unknown-linux-gnu`;
	if (platform === 'darwin') return `${arch}-apple-darwin`;

	throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

async function downloadAndExtract() {
	if (existsSync(BIN_PATH)) {
		console.log(`✓ similarity-ts already exists at ${BIN_PATH}`);
		return;
	}

	const version = VERSION;
	const triple = getPlatformTriple();
	const filename = `similarity-${version}-${triple}.tar.gz`;
	const url = `https://github.com/${REPO}/releases/download/${version}/${filename}`;

	console.log(`Downloading similarity-ts ${version} for ${triple}...`);
	console.log(`  URL: ${url}`);

	mkdirSync(BIN_DIR, { recursive: true });

	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Download failed: ${res.status} ${res.statusText}`);
	}

	// Write tarball to temp file, extract with tar
	const tmpTar = join(BIN_DIR, 'download.tar.gz');
	await Bun.write(tmpTar, res);

	const proc = Bun.spawn(
		[
			'tar',
			'xzf',
			tmpTar,
			'-C',
			BIN_DIR,
			'--strip-components=1',
			`similarity-${version}-${triple}/similarity-ts`
		],
		{
			stdout: 'inherit',
			stderr: 'inherit'
		}
	);
	await proc.exited;

	// Cleanup tarball
	try {
		unlinkSync(tmpTar);
	} catch {
		/* already removed */
	}

	if (!existsSync(BIN_PATH)) {
		throw new Error('Extraction failed: binary not found after extract');
	}

	chmodSync(BIN_PATH, 0o755);
	console.log(`✓ similarity-ts installed to ${BIN_PATH}`);
}

downloadAndExtract().catch((err) => {
	console.error('Failed to download similarity-ts:', err);
	process.exit(1);
});
