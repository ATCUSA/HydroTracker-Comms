import { beforeEach, describe, expect, it } from 'vitest';
import { SafetyLogDatabase } from '../src/lib/db/db';
import {
	archiveBackup,
	buildBackup,
	hashBackup,
	restoreBackup,
	validateBackup,
	BACKUP_KIND,
	type BackupDocument
} from '../src/lib/export/backup';
import { createRecord } from '../src/lib/db/repo';
import type { Observation, RaceEvent, StationSession } from '../src/lib/domain/types';

let db: SafetyLogDatabase;
const ctx = { eventId: 'ev1', operatorName: 'Operator', deviceId: 'dev1' };

async function seed() {
	await db.events.put({
		id: 'ev1',
		createdAt: 1,
		updatedAt: 1,
		voided: false,
		name: 'River Classic',
		dates: ['2026-09-05'],
		timezone: 'America/Los_Angeles',
		courseNotes: 'Notes',
		isDemo: false,
		workspace: 'live',
		importedFrom: null
	} satisfies RaceEvent);
	await db.sessions.put({
		id: 'ses1',
		createdAt: 1,
		updatedAt: 1,
		voided: false,
		eventId: 'ev1',
		checkpointName: 'Checkpoint 2',
		safetyBoatNumber: 'SB-2',
		operatorName: 'Operator',
		callSign: 'Safety Two',
		channel: '72',
		checkpointLocation: null,
		deviceId: 'dev1',
		deviceLabel: 'Phone',
		startedAt: 1,
		endedAt: null
	} satisfies StationSession);
	await db.heats.put({
		id: 'h1',
		createdAt: 1,
		updatedAt: 1,
		voided: false,
		eventId: 'ev1',
		name: 'Heat 1',
		legFormat: 'one-way',
		startMode: 'individual',
		sortIndex: 1,
		closedAt: null,
		closedBy: null,
		notes: ''
	});
	await db.racers.put({
		id: 'r1',
		createdAt: 1,
		updatedAt: 1,
		voided: false,
		eventId: 'ev1',
		boatNumber: '007',
		className: 'A',
		notes: ''
	});
	await db.participants.put({
		id: 'p1',
		createdAt: 1,
		updatedAt: 1,
		voided: false,
		heatId: 'h1',
		racerId: 'r1',
		startOrder: 1,
		participation: 'entered',
		participationNote: '',
		className: 'A'
	});
	await createRecord<Observation>(
		'observations',
		({ id, at, sequence }) => ({
			id,
			createdAt: at,
			updatedAt: at,
			voided: false,
			eventId: 'ev1',
			sessionId: 'ses1',
			deviceId: 'dev1',
			operatorName: 'Operator',
			heatId: 'h1',
			legId: null,
			participantId: 'p1',
			unassignedBoatText: null,
			type: 'pass',
			source: 'direct',
			checkpointName: 'Checkpoint 2',
			reportingCheckpointId: null,
			captureTime: 1_700_000_000_000,
			receivedTime: null,
			reportedTime: null,
			effectiveTime: 1_700_000_000_000,
			captureOffsetMinutes: -420,
			sequence,
			direction: 'downstream',
			notes: 'clean pass',
			uncertainIdentification: false,
			groupActionId: null,
			reviewAcknowledgedAt: null
		}),
		ctx,
		db
	);
}

beforeEach(async () => {
	db = new SafetyLogDatabase(`test-${Math.random().toString(36).slice(2)}`);
	await db.open();
	await seed();
});

describe('backup contents', () => {
	it('includes records, audit revisions and station identity', async () => {
		const doc = await buildBackup('ev1', '1.0.0', db);
		expect(doc.kind).toBe(BACKUP_KIND);
		expect(doc.event.name).toBe('River Classic');
		expect(doc.observations).toHaveLength(1);
		expect(doc.revisions.length).toBeGreaterThan(0);
		expect(doc.station.checkpointName).toBe('Checkpoint 2');
		expect(doc.station.deviceId).toBe('dev1');
	});

	it('refuses to back up an event that is not there', async () => {
		await expect(buildBackup('missing', '1.0.0', db)).rejects.toThrow(/no longer exists/);
	});
});

describe('validation', () => {
	it('accepts a well-formed backup', async () => {
		const result = validateBackup(await buildBackup('ev1', '1.0.0', db));
		expect(result.valid).toBe(true);
		expect(result.summary?.counts.observations).toBe(1);
	});

	it('rejects a file that is not a backup', () => {
		expect(validateBackup({ hello: 'world' }).valid).toBe(false);
		expect(validateBackup(null).valid).toBe(false);
		expect(validateBackup('a string').valid).toBe(false);
	});

	it('rejects a backup written by a newer app', async () => {
		const doc = await buildBackup('ev1', '1.0.0', db);
		const result = validateBackup({ ...doc, backupVersion: 99 });
		expect(result.valid).toBe(false);
		expect(result.errors.join(' ')).toMatch(/newer app version/);
	});

	it('rejects a backup with a missing record list', async () => {
		const doc = (await buildBackup('ev1', '1.0.0', db)) as unknown as Record<string, unknown>;
		delete doc.observations;
		expect(validateBackup(doc).valid).toBe(false);
	});

	it('warns but does not reject when an observation points at a missing heat', async () => {
		const doc = await buildBackup('ev1', '1.0.0', db);
		doc.observations[0].heatId = 'gone';
		const result = validateBackup(doc);
		expect(result.valid).toBe(true);
		expect(result.warnings.join(' ')).toMatch(/reference a heat or boat/);
	});
});

describe('restore', () => {
	it('round-trips a replace restore preserving ids and history', async () => {
		const doc = await buildBackup('ev1', '1.0.0', db);
		const originalObservationId = doc.observations[0].id;
		const originalRevisionCount = doc.revisions.length;

		await restoreBackup(doc, 'replace', '1.0.0', db);

		const restored = await buildBackup('ev1', '1.0.0', db);
		expect(restored.observations[0].id).toBe(originalObservationId);
		expect(restored.observations[0].captureTime).toBe(doc.observations[0].captureTime);
		expect(restored.revisions).toHaveLength(originalRevisionCount);
		expect(restored.event.name).toBe('River Classic');
	});

	it('restores into a separate workspace without disturbing the live event', async () => {
		const doc = await buildBackup('ev1', '1.0.0', db);
		const result = await restoreBackup(doc, 'copy', '1.0.0', db);

		expect(result.eventId).not.toBe('ev1');
		const live = await db.events.get('ev1');
		expect(live?.workspace).toBe('live');
		const copy = await db.events.get(result.eventId);
		expect(copy?.workspace).toBe('restored');
		expect(copy?.name).toBe('River Classic (restored)');
		// Both copies of the observation exist and do not shadow each other.
		expect(await db.observations.count()).toBe(2);
	});

	it('remaps every link when copying so nothing points across workspaces', async () => {
		const doc = await buildBackup('ev1', '1.0.0', db);
		const result = await restoreBackup(doc, 'copy', '1.0.0', db);
		const copied = await db.observations.where('eventId').equals(result.eventId).first();
		expect(copied?.participantId).not.toBe('p1');
		const participant = await db.participants.get(copied?.participantId as string);
		expect(participant?.heatId).not.toBe('h1');
		const racer = await db.racers.get(participant?.racerId as string);
		expect(racer?.boatNumber).toBe('007');
	});

	it('hands back a backup of what a replace overwrote', async () => {
		const doc = await buildBackup('ev1', '1.0.0', db);
		const result = await restoreBackup(doc, 'replace', '1.0.0', db);
		expect(result.preReplaceBackup?.observations).toHaveLength(1);
	});

	it('leaves existing records untouched when the backup is malformed', async () => {
		const before = await db.observations.toArray();
		const malformed = { kind: BACKUP_KIND, backupVersion: 1 } as unknown as BackupDocument;
		await expect(restoreBackup(malformed, 'replace', '1.0.0', db)).rejects.toThrow(
			/Backup rejected/
		);
		expect(await db.observations.toArray()).toEqual(before);
		expect(await db.events.count()).toBe(1);
	});
});

describe('separate-log archive', () => {
	it('keeps each station log whole and unmerged', async () => {
		const mine = await buildBackup('ev1', '1.0.0', db);
		const theirs: BackupDocument = {
			...mine,
			station: { ...mine.station, deviceId: 'dev2', checkpointName: 'Checkpoint 5' },
			observations: []
		};

		await archiveBackup(mine, db);
		await archiveBackup(theirs, db);

		const rows = await db.archive.toArray();
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.stationLabel).sort()).toEqual(['Checkpoint 2', 'Checkpoint 5']);
		// Archiving never writes into the live tables.
		expect(await db.observations.count()).toBe(1);
	});

	it('detects an identical re-import', async () => {
		const doc = await buildBackup('ev1', '1.0.0', db);
		const first = await archiveBackup(doc, db);
		expect(first.outcome).toBe('added');
		// A fresh export of unchanged data differs only in generatedAt.
		const second = await archiveBackup({ ...doc, generatedAt: doc.generatedAt + 60_000 }, db);
		expect(second.outcome).toBe('duplicate');
		expect(await db.archive.count()).toBe(1);
	});

	it('keeps a changed snapshot from the same station as a new version', async () => {
		const doc = await buildBackup('ev1', '1.0.0', db);
		await archiveBackup(doc, db);
		const changed = { ...doc, observations: [] };
		const result = await archiveBackup(changed, db);
		expect(result.outcome).toBe('new-version');
		expect(result.entry.snapshotVersion).toBe(2);
		expect(await db.archive.count()).toBe(2);
	});

	it('rejects a malformed backup without archiving anything', async () => {
		await expect(archiveBackup({} as BackupDocument, db)).rejects.toThrow(/Backup rejected/);
		expect(await db.archive.count()).toBe(0);
	});
});

describe('content hashing', () => {
	it('ignores generation time so an unchanged re-export matches', async () => {
		const doc = await buildBackup('ev1', '1.0.0', db);
		const a = await hashBackup(doc);
		const b = await hashBackup({ ...doc, generatedAt: doc.generatedAt + 1 });
		expect(a).toBe(b);
	});

	it('changes when a record changes', async () => {
		const doc = await buildBackup('ev1', '1.0.0', db);
		const a = await hashBackup(doc);
		const b = await hashBackup({ ...doc, observations: [] });
		expect(a).not.toBe(b);
	});
});
