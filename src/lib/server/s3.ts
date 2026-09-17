import { AwsClient } from 'aws4fetch';
import { XMLParser } from 'fast-xml-parser';
import type { StorageObjectResult } from './storage-types';

export interface S3Config {
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	region: string;
	sessionToken: string;
	forcePathStyle: boolean;
	prefix: string;
	cdnBaseUrl: string;
}

function s3ListContentsAreArray(tagName: string): boolean {
	return tagName === 'Contents';
}

const listParser = new XMLParser({
	ignoreAttributes: true,
	removeNSPrefix: true,
	parseTagValue: false,
	isArray: s3ListContentsAreArray
});

interface S3ParsedList {
	keys: string[];
	continuationToken: string;
}

function envString(envLike: Record<string, unknown>, name: string): string {
	const value = envLike[name];
	return typeof value === 'string' ? value.trim() : '';
}

function parseBoolean(value: string, fallback: boolean): boolean {
	if (!value) return fallback;
	return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

function normalizeEndpoint(value: string): string {
	return value.replace(/\/+$/, '');
}

function normalizePrefix(value: string): string {
	return value.replace(/^\/+|\/+$/g, '');
}

export function resolveS3Config(envLike: Record<string, unknown>): S3Config {
	return {
		endpoint: normalizeEndpoint(envString(envLike, 'S3_ENDPOINT')),
		bucket: envString(envLike, 'S3_BUCKET'),
		accessKeyId: envString(envLike, 'S3_ACCESS_KEY_ID'),
		secretAccessKey: envString(envLike, 'S3_SECRET_ACCESS_KEY'),
		region: envString(envLike, 'S3_REGION'),
		sessionToken: envString(envLike, 'S3_SESSION_TOKEN'),
		forcePathStyle: parseBoolean(envString(envLike, 'S3_FORCE_PATH_STYLE'), true),
		prefix: normalizePrefix(envString(envLike, 'S3_PREFIX')),
		cdnBaseUrl: normalizeEndpoint(envString(envLike, 'S3_CDN_BASE_URL'))
	};
}

export function s3ConfigurationError(cfg: S3Config): string | null {
	if (!cfg.endpoint) return 'S3_ENDPOINT is required';
	try {
		const endpoint = new URL(cfg.endpoint);
		if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
			return 'S3_ENDPOINT must use http or https';
		}
	} catch {
		return 'S3_ENDPOINT must be a valid URL';
	}
	if (!cfg.bucket) return 'S3_BUCKET is required';
	if (!cfg.accessKeyId) return 'S3_ACCESS_KEY_ID is required';
	if (!cfg.secretAccessKey) return 'S3_SECRET_ACCESS_KEY is required';
	if (!cfg.region) return 'S3_REGION is required';
	return null;
}

export function s3ObjectKey(cfg: S3Config, path: string): string {
	const normalizedPath = path.replace(/^\/+/, '');
	return cfg.prefix ? `${cfg.prefix}/${normalizedPath}` : normalizedPath;
}

function encodePath(path: string): string {
	return path
		.split('/')
		.map((part) => encodeURIComponent(part))
		.join('/');
}

export function s3ObjectUrl(cfg: S3Config, path: string): string {
	const endpoint = new URL(cfg.endpoint);
	const key = encodePath(s3ObjectKey(cfg, path));
	const basePath = endpoint.pathname.replace(/\/+$/, '');
	if (cfg.forcePathStyle) {
		endpoint.pathname = `${basePath}/${encodeURIComponent(cfg.bucket)}/${key}`;
	} else {
		endpoint.hostname = `${cfg.bucket}.${endpoint.hostname}`;
		endpoint.pathname = `${basePath}/${key}`;
	}
	return endpoint.toString();
}

export function s3PublicUrl(cfg: S3Config, path: string, cacheBust = ''): string | null {
	if (!cfg.cdnBaseUrl) return null;
	const url = `${cfg.cdnBaseUrl}/${encodePath(s3ObjectKey(cfg, path))}`;
	return cacheBust ? `${url}?v=${encodeURIComponent(cacheBust)}` : url;
}

export function s3CacheControlForPath(path: string): string {
	return path.replace(/^\/+/, '').startsWith('avatars/')
		? 'no-cache, max-age=0, must-revalidate'
		: 'public, max-age=31536000, immutable';
}

function s3CopySource(cfg: S3Config, path: string): string {
	return `/${encodeURIComponent(cfg.bucket)}/${encodePath(s3ObjectKey(cfg, path))}`;
}

function createClient(cfg: S3Config): AwsClient {
	return new AwsClient({
		accessKeyId: cfg.accessKeyId,
		secretAccessKey: cfg.secretAccessKey,
		sessionToken: cfg.sessionToken || undefined,
		service: 's3',
		region: cfg.region,
		retries: 3
	});
}

export class S3RequestError extends Error {
	readonly status: number;

	constructor(operation: string, status: number, detail: string) {
		super(`S3 ${operation} -> HTTP ${status}${detail ? `: ${detail}` : ''}`);
		this.name = 'S3RequestError';
		this.status = status;
	}
}

export function isS3NotFoundError(error: unknown): boolean {
	return error instanceof S3RequestError && error.status === 404;
}

async function throwS3Error(operation: string, response: Response): Promise<never> {
	const detail = (await response.text()).slice(0, 500);
	throw new S3RequestError(operation, response.status, detail);
}

export async function s3PutBytes(
	cfg: S3Config,
	path: string,
	bytes: Uint8Array,
	contentType: string
): Promise<void> {
	const response = await createClient(cfg).fetch(s3ObjectUrl(cfg, path), {
		method: 'PUT',
		headers: {
			'Content-Type': contentType,
			'Cache-Control': s3CacheControlForPath(path)
		},
		body: bytes as BodyInit
	});
	if (!response.ok) await throwS3Error(`PUT ${path}`, response);
}

export async function s3CopyObject(
	cfg: S3Config,
	fromPath: string,
	toPath: string,
	contentType: string
): Promise<void> {
	const response = await createClient(cfg).fetch(s3ObjectUrl(cfg, toPath), {
		method: 'PUT',
		headers: {
			'x-amz-copy-source': s3CopySource(cfg, fromPath),
			'x-amz-metadata-directive': 'REPLACE',
			'Content-Type': contentType,
			'Cache-Control': s3CacheControlForPath(toPath)
		}
	});
	if (!response.ok) await throwS3Error(`COPY ${fromPath} -> ${toPath}`, response);
	const responseXml = await response.text();
	const parsed: unknown = listParser.parse(responseXml);
	if (!isRecord(parsed) || !('CopyObjectResult' in parsed) || 'Error' in parsed) {
		throw new Error(
			`S3 COPY ${fromPath} -> ${toPath} -> invalid response: ${responseXml.slice(0, 500)}`
		);
	}
}

export async function s3DeleteObject(cfg: S3Config, path: string): Promise<void> {
	const response = await createClient(cfg).fetch(s3ObjectUrl(cfg, path), { method: 'DELETE' });
	if (!response.ok && response.status !== 404) {
		await throwS3Error(`DELETE ${path}`, response);
	}
}

export async function s3GetObject(cfg: S3Config, path: string): Promise<StorageObjectResult> {
	const response = await createClient(cfg).fetch(s3ObjectUrl(cfg, path));
	if (!response.ok) await throwS3Error(`GET ${path}`, response);
	if (!response.body) throw new Error(`S3 GET ${path} -> empty body`);
	return { body: response.body, headers: response.headers };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function xmlText(value: unknown): string {
	if (typeof value === 'string' || typeof value === 'number') return String(value);
	if (isRecord(value) && '#text' in value) return xmlText(value['#text']);
	return '';
}

function collectTag(node: unknown, tag: string, into: string[]): void {
	if (Array.isArray(node)) {
		for (const item of node) collectTag(item, tag, into);
		return;
	}
	if (!isRecord(node)) return;
	for (const [key, value] of Object.entries(node)) {
		if (key === tag) {
			if (Array.isArray(value)) {
				for (const item of value) {
					const text = xmlText(item);
					if (text) into.push(text);
				}
			} else {
				const text = xmlText(value);
				if (text) into.push(text);
			}
		}
		if (key !== tag) collectTag(value, tag, into);
	}
}

function parseListXml(xml: string): S3ParsedList {
	const parsed: unknown = listParser.parse(xml);
	const keys: string[] = [];
	const tokens: string[] = [];
	collectTag(parsed, 'Key', keys);
	collectTag(parsed, 'NextContinuationToken', tokens);
	return { keys, continuationToken: tokens[0] ?? '' };
}

export async function s3ListFolder(cfg: S3Config, folder: string): Promise<Set<string>> {
	const folderPath = folder.replace(/^\/+|\/+$/g, '');
	const objectPrefix = s3ObjectKey(cfg, folderPath ? `${folderPath}/` : '');
	const names = new Set<string>();
	let continuationToken = '';
	do {
		const endpoint = new URL(cfg.endpoint);
		const listPath = cfg.forcePathStyle
			? `${endpoint.pathname.replace(/\/+$/, '')}/${encodeURIComponent(cfg.bucket)}`
			: endpoint.pathname.replace(/\/+$/, '') || '/';
		if (!cfg.forcePathStyle) endpoint.hostname = `${cfg.bucket}.${endpoint.hostname}`;
		endpoint.pathname = listPath;
		endpoint.searchParams.set('list-type', '2');
		endpoint.searchParams.set('prefix', objectPrefix);
		if (continuationToken) endpoint.searchParams.set('continuation-token', continuationToken);

		const response = await createClient(cfg).fetch(endpoint);
		if (!response.ok) await throwS3Error(`LIST ${folder}`, response);
		const parsed = parseListXml(await response.text());
		for (const key of parsed.keys) {
			const relative = key.startsWith(objectPrefix) ? key.slice(objectPrefix.length) : '';
			if (relative) names.add(relative);
		}
		continuationToken = parsed.continuationToken;
	} while (continuationToken);
	return names;
}
