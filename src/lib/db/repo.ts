import type { Table } from 'dexie';
import { getDb, type AnyDb } from './db';
import { toStorable } from './plain';
import { newId } from '$lib/domain/ids';
import { nowMs, utcOffsetMinutes } from '$lib/time/clock';
import type { AuditAction, AuditRevision, EpochMs, Id } from '$lib/domain/types';

/** Tables whose changes are recorded in the audit trail. */
export type AuditedTable =
	| 'events'
	| 'sessions'
	| 'racers'
	| 'heats'
	| 'legs'
	| 'participants'
	| 'checkpoints'
	| 'observations'
	| 'radio'
	| 'eventLog'
	| 'incidents'
	| 'incidentActions';

const AUDITED_TABLES: AuditedTable[] = [
	'events',
	'sessions',
	'racers',
	'heats',
	'legs',
	'participants',
	'checkpoints',
	'observations',
	'radio',
	'eventLog',
	'incidents',
	'incidentActions'
];

const SEQUENCE_KEY = 'sequence.counter';

export interface WriteContext {
	eventId: Id;
	operatorName: string;
	deviceId: string;
	reason?: string;
}

/** Fields that never appear in an audit diff because they are bookkeeping. */
const IGNORED_DIFF_FIELDS = new Set(['updatedAt']);

export function diffRecords(
	before: Record<string, unknown> | undefined,
	after: Record<string, unknown>
): AuditRevision['changes'] {
	const changes: AuditRevision['changes'] = [];
	const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
	for (const key of keys) {
		if (IGNORED_DIFF_FIELDS.has(key)) continue;
		const b = before?.[key];
		const a = after[key];
		if (JSON.stringify(b) !== JSON.stringify(a)) {
			changes.push({ field: key, before: b ?? null, after: a ?? null });
		}
	}
	return changes;
}

/**
 * Reserves the next per-device sequence number inside the caller's transaction.
 * Sequence is durable and strictly increasing, so capture order survives both
 * a reload and any later correction of effective times.
 */
async function nextSequence(db: AnyDb): Promise<number> {
	const row = await db.settings.get(SEQUENCE_KEY);
	const next = ((row?.value as number | undefined) ?? 0) + 1;
	await db.settings.put({ key: SEQUENCE_KEY, value: next, updatedAt: nowMs() });
	return next;
}

/** Reads the next sequence without consuming it (for previews and tests). */
export async function peekSequence(db: AnyDb = getDb()): Promise<number> {
	const row = await db.settings.get(SEQUENCE_KEY);
	return ((row?.value as number | undefined) ?? 0) + 1;
}

function tableOf(db: AnyDb, name: AuditedTable): Table<Record<string, unknown>, string> {
	return db[name] as unknown as Table<Record<string, unknown>, string>;
}

export interface SaveResult<T> {
	ok: boolean;
	record?: T;
	error?: Error;
}

/**
 * Writes a record and its audit revision in a single IndexedDB transaction.
 * If either write fails the whole thing rolls back and the caller is told the
 * save failed — the UI must never show "saved" for a rejected transaction.
 */
export async function saveRecord<T extends { id: Id; updatedAt: EpochMs }>(
	table: AuditedTable,
	record: T,
	ctx: WriteContext,
	action: AuditAction = 'update',
	db: AnyDb = getDb()
): Promise<T> {
	const at = nowMs();
	await db.transaction('rw', [tableOf(db, table), db.revisions, db.settings], async () => {
		const existing = (await tableOf(db, table).get(record.id)) as
			Record<string, unknown> | undefined;
		const resolvedAction: AuditAction = action === 'update' && !existing ? 'create' : action;
		const next = toStorable({ ...record, updatedAt: at }) as unknown as Record<string, unknown>;
		const changes = resolvedAction === 'create' ? [] : diffRecords(existing, next);
		const sequence = await nextSequence(db);
		await tableOf(db, table).put(next);
		await db.revisions.add({
			id: newId('rev-'),
			eventId: ctx.eventId,
			table,
			recordId: record.id,
			action: resolvedAction,
			changes: toStorable(changes),
			at,
			operatorName: ctx.operatorName,
			deviceId: ctx.deviceId,
			reason: ctx.reason ?? '',
			sequence
		});
	});
	return { ...record, updatedAt: at };
}

/**
 * Creates a record, stamping id/timestamps/sequence. `build` receives the
 * reserved sequence so observation rows carry it directly.
 */
export async function createRecord<T extends { id: Id; createdAt: EpochMs; updatedAt: EpochMs }>(
	table: AuditedTable,
	build: (fields: { id: Id; at: EpochMs; sequence: number; offsetMinutes: number }) => T,
	ctx: WriteContext,
	db: AnyDb = getDb()
): Promise<T> {
	const at = nowMs();
	const offsetMinutes = utcOffsetMinutes(at);
	let created!: T;
	await db.transaction('rw', [tableOf(db, table), db.revisions, db.settings], async () => {
		const sequence = await nextSequence(db);
		created = toStorable(build({ id: newId(), at, sequence, offsetMinutes }));
		await tableOf(db, table).put(created as unknown as Record<string, unknown>);
		await db.revisions.add({
			id: newId('rev-'),
			eventId: ctx.eventId,
			table,
			recordId: created.id,
			action: 'create',
			changes: [],
			at,
			operatorName: ctx.operatorName,
			deviceId: ctx.deviceId,
			reason: ctx.reason ?? '',
			sequence
		});
	});
	return created;
}

/** Normal deletion is voiding: the row stays, reviewable and restorable. */
export async function voidRecord(
	table: AuditedTable,
	id: Id,
	ctx: WriteContext,
	db: AnyDb = getDb()
): Promise<void> {
	const existing = (await tableOf(db, table).get(id)) as
		(Record<string, unknown> & { id: Id; updatedAt: EpochMs }) | undefined;
	if (!existing) throw new Error(`Cannot void: ${table}/${id} not found`);
	await saveRecord(
		table,
		{ ...existing, voided: true, voidedAt: nowMs(), voidReason: ctx.reason ?? '' },
		ctx,
		'void',
		db
	);
}

export async function restoreRecord(
	table: AuditedTable,
	id: Id,
	ctx: WriteContext,
	db: AnyDb = getDb()
): Promise<void> {
	const existing = (await tableOf(db, table).get(id)) as
		(Record<string, unknown> & { id: Id; updatedAt: EpochMs }) | undefined;
	if (!existing) throw new Error(`Cannot restore: ${table}/${id} not found`);
	await saveRecord(
		table,
		{ ...existing, voided: false, voidedAt: null, voidReason: null },
		ctx,
		'restore',
		db
	);
}

export async function revisionsFor(recordId: Id, db: AnyDb = getDb()): Promise<AuditRevision[]> {
	const rows = await db.revisions.where('recordId').equals(recordId).toArray();
	return rows.sort((a, b) => a.sequence - b.sequence);
}

export { AUDITED_TABLES };

/**
 * Confirms the database can actually be written to and read back. Used by the
 * offline-readiness check, which must not report readiness on the strength of
 * a cached shell alone.
 */
export async function verifyDatabaseWritable(db: AnyDb = getDb()): Promise<boolean> {
	const key = 'readiness.probe';
	const token = newId('probe-');
	await db.settings.put({ key, value: token, updatedAt: nowMs() });
	const read = await db.settings.get(key);
	return read?.value === token;
}
