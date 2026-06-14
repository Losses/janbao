/**
 * One-time pCloud setup for WebDAV: verify credentials, create the /avatars and
 * /attachments folders, and write PCLOUD_USERNAME + PCLOUD_PASSWORD +
 * PCLOUD_WEBDAV_HOST to .env. Run with: `bun scripts/setup-pcloud.ts`.
 *
 * pCloud disabled password-based REST login, so we use WebDAV (HTTP Basic auth
 * with email + password on every request). The account must NOT have 2FA
 * enabled. EU accounts use ewebdav.pcloud.com; US use webdav.pcloud.com.
 *
 * NOTE: the password is stored in .env (gitignored) because WebDAV needs it on
 * every request — there is no token to use instead.
 */
import { createInterface } from 'readline';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import {
	pcloudEnsureBase,
	pcloudMkcol,
	pcloudListFolder,
	pcloudIsConfigured,
	type PcloudConfig
} from '../src/lib/server/pcloud';

const rl = createInterface({ input: process.stdin, output: process.stdout });

type AskFn = (query: string) => Promise<string>;
const ask: AskFn = (query) =>
	new Promise((resolve) => rl.question(query, (answer) => resolve(answer.trim())));

function writeEnv(key: string, value: string): void {
	const envPath = '.env';
	const lines = existsSync(envPath) ? readFileSync(envPath, 'utf-8').split('\n') : [];
	const prefix = `${key}=`;
	const idx = lines.findIndex((line) => line.startsWith(prefix));
	const newLine = `${prefix}${value}`;
	if (idx >= 0) {
		lines[idx] = newLine;
	} else {
		if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
		lines.push(newLine);
	}
	writeFileSync(envPath, lines.join('\n'), 'utf-8');
}

async function main(): Promise<void> {
	console.log('pCloud WebDAV setup — verify credentials and create image folders.\n');
	const email = await ask('pCloud email: ');
	if (!email) {
		console.error('Email is required.');
		process.exit(1);
	}
	const password = await ask('pCloud password (visible while typing): ');
	if (!password) {
		console.error('Password is required.');
		process.exit(1);
	}
	const regionInput = await ask('Region — EU or US [EU]: ');
	const host = regionInput.toUpperCase() === 'US' ? 'webdav.pcloud.com' : 'ewebdav.pcloud.com';
	console.log(`Using WebDAV host: ${host}`);

	const cfg: PcloudConfig = { username: email, password, host };
	if (!pcloudIsConfigured(cfg)) {
		console.error('Credentials missing.');
		process.exit(1);
	}

	// Create the project folder and image sub-folders; MKCOL also verifies auth
	// (401 = bad credentials / 2FA on).
	try {
		await pcloudEnsureBase(cfg);
		await pcloudMkcol(cfg, '/avatars');
		await pcloudMkcol(cfg, '/attachments');
		await pcloudListFolder(cfg, '/avatars');
	} catch (e) {
		console.error('\nCredential verification / folder creation failed:', e);
		console.error('If 401: wrong email/password, OR 2FA is enabled (WebDAV needs 2FA off).');
		process.exit(1);
	}
	console.log(
		`✓ Credentials verified; ${cfg.basePath}/avatars and ${cfg.basePath}/attachments ready.`
	);

	writeEnv('PCLOUD_USERNAME', cfg.username);
	writeEnv('PCLOUD_PASSWORD', cfg.password);
	writeEnv('PCLOUD_WEBDAV_HOST', cfg.host);
	writeEnv('PCLOUD_BASE_PATH', cfg.basePath);
	console.log(
		'✓ Wrote PCLOUD_USERNAME, PCLOUD_PASSWORD, PCLOUD_WEBDAV_HOST, PCLOUD_BASE_PATH to .env'
	);

	console.log('\nFor production (Cloudflare), set the same values as secrets:');
	console.log('  wrangler secret put PCLOUD_USERNAME');
	console.log('  wrangler secret put PCLOUD_PASSWORD');
	console.log('  wrangler secret put PCLOUD_WEBDAV_HOST   # ewebdav.pcloud.com for EU');

	rl.close();
}

main().catch((err) => {
	console.error('Error in setup:', err);
	process.exit(1);
});
