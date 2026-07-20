/**
 * A zero-argument async operation: a DB write, a pCloud MOVE, or the matching
 * rollback. Named (not inline) per the no-inline-typing rule.
 */
export type AsyncVoid = () => Promise<void>;

/**
 * Commit plan for {@link commitUploadedFile}: the DB publish, the storage MOVE,
 * and the compensating rollback of the DB write if the MOVE fails.
 */
export interface UploadCommitPlan {
	/** Publish the upload in the DB (avatar columns update, attachment insert). */
	dbWrite: AsyncVoid;
	/** MOVE the streamed tmp file to its final content-addressed pCloud path. */
	move: AsyncVoid;
	/** Undo the DB write on MOVE failure (restore prior values, or delete the row). */
	rollbackDbWrite: AsyncVoid;
}

/**
 * Commit a streamed upload using DB-write-first / MOVE-second ordering with
 * compensating rollback of the DB write if the MOVE fails.
 *
 * DB-first is structurally cleaner than MOVE-first with file-side compensation.
 * The compensation always undoes OUR DB write, which is uniquely ours to undo,
 * never a shared file. For content-addressed attachments the destination file
 * may already be referenced by a pre-existing row for the same sha (a prior or
 * concurrent upload of identical bytes), so deleting it on a later DB failure
 * would orphan that reference. Undoing our own row never has that problem.
 *
 * Guarantees:
 *  - dbWrite throws: move is not attempted; no compensation.
 *  - move throws after a successful dbWrite: rollbackDbWrite is awaited
 *    best-effort; its errors are surfaced via console.error so they are not
 *    lost, but they never mask the original failure.
 *  - both succeed: no compensation.
 *
 * The original failure is re-thrown so the caller maps it to its HTTP response.
 */
export async function commitUploadedFile(plan: UploadCommitPlan): Promise<void> {
	await plan.dbWrite();
	try {
		await plan.move();
	} catch (moveErr) {
		try {
			await plan.rollbackDbWrite();
		} catch (rollbackErr) {
			console.error('[upload] rollback failed after move failure:', rollbackErr);
		}
		throw moveErr;
	}
}
