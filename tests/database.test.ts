import { beforeEach, describe, expect, it } from 'vitest';
import { SafetyLogDatabase } from '../src/lib/db/db';
import {
	createRecord,
	diffRecords,
	peekSequence,
	restoreRecord,
	revisionsFor,
	saveRecord,
	verifyDatabaseWritable,
	voidRecord
} from '../src/lib/db/repo';
import type { Observation } from '../src/lib/domain/types';

let db: SafetyLogDatabase;
const ctx = { eventId: 'ev1', operatorName: 'Operator', deviceId: 'dev1' };

function observationFields(id: string, at: number, sequence: number): Observation {
	return {
		id,
		createdAt: at,
		updatedAt: at,
		voided: false,
		eventId: 'ev1',
		sessionId: 'ses1',
		deviceId: 'dev1',
		operatorName: 'Operator',
		heatId: 'h1',
		legId: 'l1',
		participantId: null,
		unassignedBoatText: null,
		type: 'pass',
		source: 'direct',
		checkpointName: 'CP2',
		reportingCheckpointId: null,
		captureTime: at,
		receivedTime: null,
		reportedTime: null,
		effectiveTime: at,
		captureOffsetMinutes: 0,
		sequence,
		direction: 'downstream',
		notes: '',
		uncertainIdentification: false,
		groupActionId: null,
		reviewAcknowledgedAt: null
	};
}

async function makeObservation(overrides: Partial<Observation> = {}) {
	return createRecord<Observation>(
		'observations',
		({ id, at, sequence }) => ({ ...observationFields(id, at, sequence), ...overrides }),
		ctx,
		db
	);
}

beforeEach(async () => {
	db = new SafetyLogDatabase(`test-${Math.random().toString(36).slice(2)}`);
	await db.open();
});

describe('record and audit writes', () => {
	it('writes a create revision alongside the record', async () => {
		const record = await makeObservation();
		const stored = await db.observations.get(record.id);
		expect(stored?.id).toBe(record.id);
		const revisions = await revisionsFor(record.id, db);
		expect(revisions).toHaveLength(1);
		expect(revisions[0].action).toBe('create');
	});

	it('records field-level before and after values on an update', async () => {
		const record = await makeObservation();
		await saveRecord(
			'observations',
			{ ...record, notes: 'corrected', effectiveTime: record.captureTime + 5000 },
			{ ...ctx, reason: 'Heard the number again' },
			'update',
			db
		);
		const revisions = await revisionsFor(record.id, db);
		expect(revisions).toHaveLength(2);
		const update = revisions[1];
		expect(update.action).toBe('update');
		expect(update.reason).toBe('Heard the number again');
		const notesChange = update.changes.find((c) => c.field === 'notes');
		expect(notesChange).toEqual({ field: 'notes', before: '', after: 'corrected' });
	});

	it('never rewrites the original capture time on a correction', async () => {
		const record = await makeObservation();
		await saveRecord(
			'observations',
			{ ...record, effectiveTime: record.captureTime + 60_000 },
			{ ...ctx, reason: 'time correction' },
			'update',
			db
		);
		const stored = await db.observations.get(record.id);
		expect(stored?.captureTime).toBe(record.captureTime);
		expect(stored?.effectiveTime).toBe(record.captureTime + 60_000);
	});

	it('keeps the capture sequence stable when the effective time moves earlier', async () => {
		const first = await makeObservation();
		const second = await makeObservation();
		expect(second.sequence).toBeGreaterThan(first.sequence);
		await saveRecord(
			'observations',
			{ ...second, effectiveTime: first.effectiveTime - 10_000 },
			{ ...ctx, reason: 'corrected' },
			'update',
			db
		);
		const stored = await db.observations.get(second.id);
		expect(stored?.sequence).toBe(second.sequence);
	});

	it('hands out strictly increasing, durable sequence numbers', async () => {
		const a = await makeObservation();
		const b = await makeObservation();
		const c = await makeObservation();
		expect([a.sequence, b.sequence, c.sequence]).toEqual([1, 2, 3]);
		// Each create reserves one sequence, shared by the record and its audit row.
		expect(await peekSequence(db)).toBe(4);
	});

	it('rolls back the record when the audit write fails', async () => {
		const original = db.revisions.add.bind(db.revisions);
		// Force the audit half of the transaction to reject.
		db.revisions.add = (() => Promise.reject(new Error('audit table is full'))) as never;
		await expect(makeObservation()).rejects.toThrow(/audit table is full/);
		db.revisions.add = original as never;
		expect(await db.observations.count()).toBe(0);
	});

	it('reports a write failure instead of resolving as saved', async () => {
		const original = db.observations.put.bind(db.observations);
		db.observations.put = (() => Promise.reject(new Error('QuotaExceededError'))) as never;
		await expect(makeObservation()).rejects.toThrow(/QuotaExceededError/);
		db.observations.put = original as never;
		expect(await db.revisions.count()).toBe(0);
	});
});

describe('voiding and restoring', () => {
	it('voids without deleting and keeps the record reviewable', async () => {
		const record = await makeObservation();
		await voidRecord('observations', record.id, { ...ctx, reason: 'mis-tap' }, db);
		const stored = await db.observations.get(record.id);
		expect(stored?.voided).toBe(true);
		expect(stored?.voidReason).toBe('mis-tap');
		expect(stored?.captureTime).toBe(record.captureTime);
	});

	it('restores a voided record and logs both actions', async () => {
		const record = await makeObservation();
		await voidRecord('observations', record.id, { ...ctx, reason: 'mis-tap' }, db);
		await restoreRecord('observations', record.id, { ...ctx, reason: 'was real' }, db);
		const stored = await db.observations.get(record.id);
		expect(stored?.voided).toBe(false);
		expect(stored?.voidedAt).toBeNull();
		const actions = (await revisionsFor(record.id, db)).map((r) => r.action);
		expect(actions).toEqual(['create', 'void', 'restore']);
	});

	it('refuses to void a record that is not there', async () => {
		await expect(voidRecord('observations', 'nope', ctx, db)).rejects.toThrow(/not found/);
	});
});

describe('diffing', () => {
	it('ignores the bookkeeping updatedAt field', () => {
		const changes = diffRecords({ a: 1, updatedAt: 1 }, { a: 1, updatedAt: 2 });
		expect(changes).toEqual([]);
	});

	it('reports added and removed fields', () => {
		const changes = diffRecords({ a: 1 }, { a: 2, b: 'new' });
		expect(changes).toEqual([
			{ field: 'a', before: 1, after: 2 },
			{ field: 'b', before: null, after: 'new' }
		]);
	});
});

describe('readiness probe', () => {
	it('confirms the database can be written and read back', async () => {
		expect(await verifyDatabaseWritable(db)).toBe(true);
	});
});
