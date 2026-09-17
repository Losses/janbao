import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
	forwardContentLength,
	pcloudIsConfigured,
	pcloudListFolder,
	pcloudStream,
	pcloudUploadBytes,
	resolvePcloudConfig,
	type PcloudConfig
} from './pcloud';
import {
	resolveS3Config,
	s3ConfigurationError,
	s3GetObject,
	s3ListFolder,
	s3PublicUrl,
	s3PutBytes,
	type S3Config
} from './s3';
import type { StorageObjectResult } from './storage-types';

export type MediaStorageProvider = 'pcloud' | 's3';

export interface PcloudMediaStorageConfig {
	provider: 'pcloud';
	pcloud: PcloudConfig;
}

export interface S3MediaStorageConfig {
	provider: 's3';
	s3: S3Config;
}

export interface InvalidMediaStorageConfig {
	provider: 'invalid';
	error: string;
}

export type MediaStorageConfig =
	| PcloudMediaStorageConfig
	| S3MediaStorageConfig
	| InvalidMediaStorageConfig;

function envString(envLike: Record<string, unknown>, name: string): string {
	const value = envLike[name];
	return typeof value === 'string' ? value.trim() : '';
}

export function resolveMediaStorageConfig(envLike: Record<string, unknown>): MediaStorageConfig {
	const provider = envString(envLike, 'MEDIA_STORAGE_PROVIDER').toLowerCase() || 'pcloud';
	if (provider === 'pcloud') {
		return { provider, pcloud: resolvePcloudConfig(envLike) };
	}
	if (provider === 's3') {
		const s3 = resolveS3Config(envLike);
		const error = s3ConfigurationError(s3);
		return error ? { provider: 'invalid', error } : { provider, s3 };
	}
	return {
		provider: 'invalid',
		error: `MEDIA_STORAGE_PROVIDER must be "pcloud" or "s3", received "${provider}"`
	};
}

export function mediaStorageConfigurationError(cfg: MediaStorageConfig): string | null {
	if (cfg.provider === 'invalid') return cfg.error;
	if (cfg.provider === 'pcloud' && !pcloudIsConfigured(cfg.pcloud)) {
		return 'PCLOUD_USERNAME and PCLOUD_PASSWORD are required';
	}
	return null;
}

export function avatarStoragePath(userId: number | string): string {
	if (!/^-?\d+$/.test(String(userId))) throw new Error('Invalid avatar user ID');
	return `avatars/${userId}`;
}

export function avatarStorageEntry(userId: number | string): string {
	return avatarStoragePath(userId).slice('avatars/'.length);
}

export function attachmentStoragePath(fileId: string): string {
	return `attachments/${fileId}`;
}

export async function mediaUploadBytes(
	cfg: MediaStorageConfig,
	path: string,
	bytes: Uint8Array,
	contentType: string
): Promise<void> {
	if (cfg.provider === 's3') {
		await s3PutBytes(cfg.s3, path, bytes, contentType);
		return;
	}
	if (cfg.provider === 'pcloud') {
		const slash = path.lastIndexOf('/');
		await pcloudUploadBytes(cfg.pcloud, `/${path.slice(0, slash)}`, path.slice(slash + 1), bytes);
		return;
	}
	throw new Error(cfg.error);
}

export async function mediaGetObject(
	cfg: MediaStorageConfig,
	path: string
): Promise<StorageObjectResult> {
	if (cfg.provider === 's3') return s3GetObject(cfg.s3, path);
	if (cfg.provider === 'pcloud') return pcloudStream(cfg.pcloud, `/${path}`);
	throw new Error(cfg.error);
}

export async function mediaListFolder(
	cfg: MediaStorageConfig,
	folder: string
): Promise<Set<string>> {
	if (cfg.provider === 's3') return s3ListFolder(cfg.s3, folder);
	if (cfg.provider === 'pcloud') return pcloudListFolder(cfg.pcloud, `/${folder}`);
	throw new Error(cfg.error);
}

export function mediaPublicUrl(
	cfg: MediaStorageConfig,
	path: string,
	cacheBust = ''
): string | null {
	return cfg.provider === 's3' ? s3PublicUrl(cfg.s3, path, cacheBust) : null;
}

export interface MediaResponseOptions {
	path: string;
	contentType: string;
	etag?: string;
	cacheBust?: string;
	verifiedAvatarId?: string;
}

/** Shared CDN redirect/proxy behavior; callers keep their database existence checks. */
export async function mediaResponse(
	cfg: MediaStorageConfig,
	options: MediaResponseOptions
): Promise<Response> {
	const publicUrl = mediaPublicUrl(cfg, options.path, options.cacheBust ?? '');
	if (publicUrl && !options.verifiedAvatarId) {
		return new Response(null, {
			status: 302,
			headers: { Location: publicUrl, 'Cache-Control': 'private, no-store' }
		});
	}
	const { body, headers: upstream } = await mediaGetObject(cfg, options.path);
	if (options.verifiedAvatarId) {
		const bytes = new Uint8Array(await new Response(body).arrayBuffer());
		if (
			options.verifiedAvatarId !== '1' &&
			bytesToHex(sha256(bytes)) !== options.verifiedAvatarId
		) {
			return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
		}
		return new Response(bytes, {
			headers: {
				'Content-Type': options.contentType,
				'X-Content-Type-Options': 'nosniff',
				'Cache-Control':
					options.verifiedAvatarId === '1' ? 'no-store' : 'public, max-age=31536000, immutable',
				ETag: `"${bytesToHex(sha256(bytes))}"`
			}
		});
	}
	const headers = new Headers({
		'Content-Type': options.contentType,
		'X-Content-Type-Options': 'nosniff',
		'Cache-Control': 'public, max-age=31536000, immutable',
		'CDN-Cache-Control': 'public, max-age=31536000'
	});
	const etag = options.etag ?? upstream.get('etag');
	if (etag) headers.set('ETag', etag);
	const modified = upstream.get('last-modified');
	if (modified) headers.set('Last-Modified', modified);
	forwardContentLength(headers, upstream);
	return new Response(body, { headers });
}
