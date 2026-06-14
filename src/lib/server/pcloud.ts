/**
 * pCloud WebDAV client  - shared by the reverse-proxy routes (Cloudflare Worker /
 * local dev), the upload route, and the import/migration script (Bun). Uses
 * only Web APIs (fetch) so it loads in every runtime with no node imports.
 *
 * pCloud disabled password-based REST login (it now requires the web OAuth
 * flow), so we use WebDAV instead, which authenticates every request with
 * HTTP Basic auth (email + password). The account must NOT have 2FA enabled.
 * Region endpoints: US `webdav.pcloud.com`, EU `ewebdav.pcloud.com`.
 */

export interface PcloudConfig {
	username: string;
	password: string;
	host: string;
	/** Project root folder under the pCloud account root (e.g. "/Janbao"). */
	basePath: string;
}

const DEFAULT_HOST = 'webdav.pcloud.com';
const DEFAULT_BASE_PATH = '/Janbao';

/**
 * Resolve pCloud config from an env-like record. Callers pass their runtime's
 * env source: routes merge `$env/dynamic/private` with `platform.env`; the
 * import script passes `process.env`.
 */
export function resolvePcloudConfig(envLike: Record<string, unknown>): PcloudConfig {
	const username = envLike.PCLOUD_USERNAME;
	const password = envLike.PCLOUD_PASSWORD;
	const host = envLike.PCLOUD_WEBDAV_HOST;
	const basePath = envLike.PCLOUD_BASE_PATH;
	return {
		username: typeof username === 'string' ? username : '',
		password: typeof password === 'string' ? password : '',
		host: typeof host === 'string' ? host : DEFAULT_HOST,
		basePath: typeof basePath === 'string' && basePath ? basePath : DEFAULT_BASE_PATH
	};
}

export function pcloudIsConfigured(cfg: PcloudConfig): boolean {
	return cfg.username.length > 0 && cfg.password.length > 0;
}

function basicAuth(cfg: PcloudConfig): string {
	return 'Basic ' + btoa(`${cfg.username}:${cfg.password}`);
}

/** Join the project base path with a sub-path (e.g. "/avatars/318" -> "/Janbao/avatars/318"). */
function fullPath(cfg: PcloudConfig, path: string): string {
	const base = cfg.basePath.replace(/\/+$/, '');
	const rel = path.replace(/^\/+/, '');
	return `${base}/${rel}`;
}

/** Build a WebDAV URL under the project base path. */
function webdavUrl(cfg: PcloudConfig, path: string): string {
	return `https://${cfg.host}${fullPath(cfg, path)}`;
}

/**
 * GET a file from pCloud and return its streaming body for reverse-proxying.
 * Streams straight through (pCloud → client) with no buffering, so the caller
 * must supply the content-type (looked up in the DB)  - pCloud always returns
 * `application/octet-stream`. WebDAV serves the file in a single request in
 * both local and Worker runtimes.
 */
export async function pcloudStream(
	cfg: PcloudConfig,
	path: string
): Promise<ReadableStream<Uint8Array>> {
	const res = await fetch(webdavUrl(cfg, path), { headers: { Authorization: basicAuth(cfg) } });
	if (!res.ok) throw new Error(`pCloud WebDAV GET ${path} -> HTTP ${res.status}`);
	if (!res.body) throw new Error(`pCloud WebDAV GET ${path} -> empty body`);
	return res.body;
}

/**
 * PUT bytes to a pCloud path (folder/name). Overwrites if the file exists, so
 * re-runs are idempotent.
 */
export async function pcloudUploadBytes(
	cfg: PcloudConfig,
	folder: string,
	name: string,
	bytes: Uint8Array
): Promise<void> {
	const path = `${folder}/${name}`;
	const res = await fetch(webdavUrl(cfg, path), {
		method: 'PUT',
		headers: {
			Authorization: basicAuth(cfg),
			'Content-Type': 'application/octet-stream'
		},
		body: bytes as BodyInit
	});
	if (!res.ok && res.status !== 201 && res.status !== 204) {
		throw new Error(`pCloud WebDAV PUT ${path} -> HTTP ${res.status}`);
	}
}

/**
 * PUT a streaming body to a pCloud path (folder/name). The request body streams
 * straight through to pCloud (no buffering)  - used by the upload route to pipe
 * an incoming request body to pCloud while counting/hashing/sniffing in a
 * TransformStream upstream.
 */
export async function pcloudUploadStream(
	cfg: PcloudConfig,
	folder: string,
	name: string,
	body: ReadableStream<Uint8Array>
): Promise<void> {
	const path = `${folder}/${name}`;
	const res = await fetch(webdavUrl(cfg, path), {
		method: 'PUT',
		headers: {
			Authorization: basicAuth(cfg),
			'Content-Type': 'application/octet-stream'
		},
		body
	});
	if (!res.ok && res.status !== 201 && res.status !== 204) {
		throw new Error(`pCloud WebDAV PUT (stream) ${path} -> HTTP ${res.status}`);
	}
}

/** MOVE a pCloud path to another (WebDAV MOVE with Destination header). */
export async function pcloudMove(
	cfg: PcloudConfig,
	fromPath: string,
	toPath: string
): Promise<void> {
	const res = await fetch(webdavUrl(cfg, fromPath), {
		method: 'MOVE',
		headers: {
			Authorization: basicAuth(cfg),
			Destination: webdavUrl(cfg, toPath),
			Overwrite: 'T'
		}
	});
	// 201 = created at dest; 204 = overwritten. A failure because the dest
	// already exists is fine for content-addressed dedup.
	if (!res.ok && res.status !== 201 && res.status !== 204) {
		throw new Error(`pCloud WebDAV MOVE ${fromPath} -> HTTP ${res.status}`);
	}
}

/** DELETE a pCloud path (WebDAV DELETE)  - used to clean up temp/partial files. */
export async function pcloudDelete(cfg: PcloudConfig, path: string): Promise<void> {
	const res = await fetch(webdavUrl(cfg, path), {
		method: 'DELETE',
		headers: { Authorization: basicAuth(cfg) }
	});
	if (!res.ok && res.status !== 204 && res.status !== 200) {
		throw new Error(`pCloud WebDAV DELETE ${path} -> HTTP ${res.status}`);
	}
}

/** Whether a file exists at folder/name (WebDAV HEAD). */
export async function pcloudExists(
	cfg: PcloudConfig,
	folder: string,
	name: string
): Promise<boolean> {
	const path = `${folder}/${name}`;
	const res = await fetch(webdavUrl(cfg, path), {
		method: 'HEAD',
		headers: { Authorization: basicAuth(cfg) }
	});
	return res.ok;
}

/**
 * Create a folder if missing (WebDAV MKCOL). A non-201 (e.g. 405 already
 * exists) is treated as success; a 401 surfaces as a thrown error so the setup
 * script can detect bad credentials.
 */
export async function pcloudMkcol(cfg: PcloudConfig, folder: string): Promise<void> {
	const res = await fetch(webdavUrl(cfg, folder), {
		method: 'MKCOL',
		headers: { Authorization: basicAuth(cfg) }
	});
	if (res.status === 401) throw new Error('pCloud WebDAV auth failed (401)  - check credentials');
	// 201 = created; 405 = already exists; both fine.
}

/**
 * Create the project base folder itself (cfg.basePath) directly at the account
 * root, without the basePath re-prefix that pcloudMkcol applies. Call before
 * pcloudMkcol so the parent of sub-folders exists.
 */
export async function pcloudEnsureBase(cfg: PcloudConfig): Promise<void> {
	const res = await fetch(`https://${cfg.host}${cfg.basePath}`, {
		method: 'MKCOL',
		headers: { Authorization: basicAuth(cfg) }
	});
	if (res.status === 401) throw new Error('pCloud WebDAV auth failed (401)  - check credentials');
	// 201 = created; 405 = already exists; both fine.
}

/**
 * List file names directly under a folder (WebDAV PROPFIND, Depth: 1). The
 * response is XML; hrefs are extracted namespace-agnostically and reduced to
 * their last path segment. Used by the import script to skip already-uploaded
 * files ("ls before migration to avoid duplicates").
 */
export async function pcloudListFolder(cfg: PcloudConfig, folder: string): Promise<Set<string>> {
	const base = webdavUrl(cfg, folder);
	const url = base.endsWith('/') ? base : base + '/';
	const res = await fetch(url, {
		method: 'PROPFIND',
		headers: {
			Authorization: basicAuth(cfg),
			Depth: '1'
		}
	});
	if (!res.ok) throw new Error(`pCloud WebDAV PROPFIND ${folder} -> HTTP ${res.status}`);
	const xml = await res.text();
	const names = new Set<string>();
	const hrefRe = /<(?:[^:>]+:)?href[^>]*>([^<]+)<\/(?:[^:>]+:)?href>/gi;
	let match: RegExpExecArray | null;
	// Full path of the folder itself (basePath + folder)  - its PROPFIND response
	// includes the folder as the first href, which we must skip.
	const selfPath = fullPath(cfg, folder).replace(/^\/+/, '').replace(/\/+$/, '');
	while ((match = hrefRe.exec(xml)) !== null) {
		const href = decodeURIComponent(match[1]);
		const clean = href
			.replace(/^https?:\/\/[^/]+/, '')
			.replace(/\/+$/, '')
			.replace(/^\/+/, '');
		if (!clean || clean === selfPath) continue; // skip the folder itself
		if (clean.endsWith('/')) continue; // nested folder
		const seg = clean.split('/').pop();
		if (seg) names.add(seg);
	}
	return names;
}
