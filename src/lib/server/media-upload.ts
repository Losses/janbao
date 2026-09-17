import {
	mediaUploadBytes,
	type MediaStorageConfig,
	type S3MediaStorageConfig
} from './media-storage';
import { pcloudDelete, pcloudExists, pcloudMkcol, pcloudMove, pcloudUploadBytes } from './pcloud';
import { isS3NotFoundError, s3CopyObject, s3DeleteObject, s3PutBytes } from './s3';
import { commitUploadedFile, type AsyncRollback, type AsyncVoid } from './utils/upload-commit';

type LockOwnershipCheck = () => Promise<boolean>;

async function prepareMediaUpload(plan: MediaUploadPlan): Promise<void> {
	try {
		await plan.dbWrite();
	} catch (error) {
		// A rejected DB request may already have committed. No storage mutation
		// has started, so only our own token may safely be rolled back here.
		if (plan.ownsLock) {
			try {
				if (await plan.ownsLock()) await plan.rollbackDbWrite();
			} catch (recoveryError) {
				console.error('[upload] lock acquisition needs recovery:', plan.path, recoveryError);
			}
		}
		throw error;
	}
}

async function cleanupObject(path: string, remove: AsyncVoid): Promise<void> {
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await remove();
			return;
		} catch (error) {
			if (attempt === 2) console.error('[upload] cleanup failed:', path, error);
		}
	}
}

export interface MediaUploadPlan {
	path: string;
	bytes: Uint8Array;
	contentType: string;
	hasPreviousObject?: boolean;
	previousContentType?: string | null;
	dbWrite: AsyncVoid;
	finalizeDbWrite?: AsyncVoid;
	ownsLock?: LockOwnershipCheck;
	rollbackDbWrite: AsyncRollback;
}

function isMissingObjectError(error: unknown): boolean {
	if (isS3NotFoundError(error)) return true;
	return error instanceof Error && /HTTP 404\b/.test(error.message);
}

function isInPlaceAvatarPath(path: string): boolean {
	return path.replace(/^\/+/, '').startsWith('avatars/');
}

async function finalizeMediaUpload(plan: MediaUploadPlan): Promise<void> {
	if (!plan.finalizeDbWrite) return;
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await plan.finalizeDbWrite();
			return;
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError;
}

async function publishS3Upload(cfg: S3MediaStorageConfig, plan: MediaUploadPlan): Promise<void> {
	if (!isInPlaceAvatarPath(plan.path)) {
		await s3PutBytes(cfg.s3, plan.path, plan.bytes, plan.contentType);
		await plan.dbWrite();
		return;
	}
	const tmpPath = `tmp/${crypto.randomUUID()}`;
	const backupPath = `tmp/${crypto.randomUUID()}`;
	let backupCreated = false;
	let prepared = false;
	let published = false;
	let preserveBackup = false;
	try {
		await s3PutBytes(cfg.s3, tmpPath, plan.bytes, plan.contentType);
		await prepareMediaUpload(plan);
		prepared = true;
		if (plan.hasPreviousObject) {
			try {
				await s3CopyObject(cfg.s3, plan.path, backupPath, plan.previousContentType || 'image/webp');
				backupCreated = true;
			} catch (error) {
				if (!isMissingObjectError(error)) throw error;
			}
		}
		published = true;
		await s3CopyObject(cfg.s3, tmpPath, plan.path, plan.contentType);
		await finalizeMediaUpload(plan);
	} catch (error) {
		if (prepared) {
			const owned = plan.ownsLock ? await plan.ownsLock().catch(() => false) : true;
			let restored = !published;
			if (owned && published) {
				try {
					if (backupCreated) {
						await s3CopyObject(
							cfg.s3,
							backupPath,
							plan.path,
							plan.previousContentType || 'image/webp'
						);
					} else {
						await s3DeleteObject(cfg.s3, plan.path);
					}
					restored = true;
				} catch (restoreError) {
					preserveBackup = backupCreated;
					console.error(
						'[upload] failed to restore S3 avatar after publication failure:',
						restoreError
					);
				}
			}
			if (!owned) preserveBackup = backupCreated;
			if (owned && restored) await plan.rollbackDbWrite();
		}
		throw error;
	} finally {
		await cleanupObject(tmpPath, () => s3DeleteObject(cfg.s3, tmpPath));
		if (backupCreated && !preserveBackup) {
			await cleanupObject(backupPath, () => s3DeleteObject(cfg.s3, backupPath));
		}
		if (preserveBackup) console.error('[upload] retained recovery backup:', plan.path, backupPath);
	}
}

async function publishPcloudAvatar(cfg: MediaStorageConfig, plan: MediaUploadPlan): Promise<void> {
	if (cfg.provider !== 'pcloud') throw new Error('Expected pCloud media storage');
	const name = crypto.randomUUID();
	const backupName = crypto.randomUUID();
	const tmpPath = `/tmp/${name}`;
	const backupPath = `/tmp/${backupName}`;
	await pcloudMkcol(cfg.pcloud, '/tmp');
	let prepared = false;
	let previousMoved = false;
	let backupMoveUncertain = false;
	let published = false;
	let preserveBackup = false;
	try {
		await pcloudUploadBytes(cfg.pcloud, '/tmp', name, plan.bytes);
		await prepareMediaUpload(plan);
		prepared = true;
		if (plan.hasPreviousObject) {
			try {
				await pcloudMove(cfg.pcloud, `/${plan.path}`, backupPath);
				previousMoved = true;
			} catch (error) {
				// Inspect both names: MOVE may have committed before its response
				// was lost. A failed HEAD is unknown, never proof of absence.
				backupMoveUncertain = true;
				previousMoved = await pcloudExists(cfg.pcloud, '/tmp', backupName);
				if (previousMoved) {
					backupMoveUncertain = false;
					throw error;
				}
				const slash = plan.path.lastIndexOf('/');
				const liveExists = await pcloudExists(
					cfg.pcloud,
					`/${plan.path.slice(0, slash)}`,
					plan.path.slice(slash + 1)
				);
				if (liveExists) {
					backupMoveUncertain = false;
					throw error;
				}
				if (!isMissingObjectError(error)) throw error;
				backupMoveUncertain = false;
			}
		}
		published = true;
		await pcloudMove(cfg.pcloud, tmpPath, `/${plan.path}`);
		await finalizeMediaUpload(plan);
	} catch (error) {
		if (prepared) {
			const owned = plan.ownsLock ? await plan.ownsLock().catch(() => false) : true;
			if (backupMoveUncertain) {
				preserveBackup = true;
				console.error(
					'[upload] uncertain pCloud backup MOVE; retaining lock:',
					plan.path,
					backupPath
				);
			} else if (owned) {
				try {
					if (previousMoved) await pcloudMove(cfg.pcloud, backupPath, `/${plan.path}`);
					else if (published)
						await pcloudDelete(cfg.pcloud, `/${plan.path}`).catch((error) => {
							if (!isMissingObjectError(error)) throw error;
						});
					await plan.rollbackDbWrite();
				} catch (restoreError) {
					preserveBackup = previousMoved;
					console.error(
						'[upload] failed to restore pCloud avatar after publication failure:',
						restoreError
					);
				}
			} else preserveBackup = previousMoved;
		}
		throw error;
	} finally {
		await cleanupObject(tmpPath, () =>
			pcloudDelete(cfg.pcloud, tmpPath).catch((error) => {
				if (!isMissingObjectError(error)) throw error;
			})
		);
		if (previousMoved && !preserveBackup) {
			await cleanupObject(backupPath, () =>
				pcloudDelete(cfg.pcloud, backupPath).catch((error) => {
					if (!isMissingObjectError(error)) throw error;
				})
			);
		}
		if (preserveBackup) console.error('[upload] retained recovery backup:', plan.path, backupPath);
	}
}

/** Encapsulate provider publication and temporary-object cleanup in one place. */
export async function publishMediaUpload(
	cfg: MediaStorageConfig,
	plan: MediaUploadPlan
): Promise<void> {
	if (cfg.provider === 's3') {
		await publishS3Upload(cfg, plan);
		return;
	}
	if (cfg.provider !== 'pcloud') {
		await mediaUploadBytes(cfg, plan.path, plan.bytes, plan.contentType);
		return;
	}
	if (isInPlaceAvatarPath(plan.path)) {
		await publishPcloudAvatar(cfg, plan);
		return;
	}
	const name = crypto.randomUUID();
	await pcloudMkcol(cfg.pcloud, '/tmp');
	try {
		await pcloudUploadBytes(cfg.pcloud, '/tmp', name, plan.bytes);
		await commitUploadedFile({
			dbWrite: plan.dbWrite,
			rollbackDbWrite: plan.rollbackDbWrite,
			move: () => pcloudMove(cfg.pcloud, `/tmp/${name}`, `/${plan.path}`)
		});
		await finalizeMediaUpload(plan);
	} catch (error) {
		await pcloudDelete(cfg.pcloud, `/tmp/${name}`).catch(() => {});
		throw error;
	}
}
