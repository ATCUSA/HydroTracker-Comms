import { getDb, SCHEMA_VERSION, type AnyDb } from '$lib/db/db';
import { newId } from '$lib/domain/ids';
import { nowMs } from '$lib/time/clock';
import type {
	AppSetting,
	ArchivedLog,
	AuditRevision,
	ClockAnomaly,
	EventLogEntry,
	Heat,
	HeatParticipant,
	Id,
	Incident,
	IncidentAction,
	Leg,
	Observation,
	RaceEvent,
	Racer,
	RadioMessage,
	ReportingCheckpoint,
	ReviewPromptDismissal,
	StationSession
} from '$lib/domain/types';

/** Bump when the backup shape changes; restore checks it before touching data. */
export const BACKUP_VERSION = 1;
export const BACKUP_KIND = 'hydrotracker-comms.backup';

export interface BackupDocument {
	kind: typeof BACKUP_KIND;
	backupVersion: number;
	schemaVersion: number;
	generatedAt: number;
	appVersion: string;
	station: {
		deviceId: string;
		deviceLabel: string;
		checkpointName: string;
		operatorName: string;
		callSign: string;
	};
	event: RaceEvent;
	sessions: StationSession[];
	racers: Racer[];
	heats: Heat[];
	legs: Leg[];
	participants: HeatParticipant[];
	checkpoints: ReportingCheckpoint[];
	observations: Observation[];
	radio: RadioMessage[];
	eventLog: EventLogEntry[];
	incidents: Incident[];
	incidentActions: IncidentAction[];
	revisions: AuditRevision[];
	dismissals: ReviewPromptDismissal[];
	clockAnomalies: ClockAnomaly[];
	settings: AppSetting[];
}

/** Collects one event and everything linked to it, including audit history. */
export async function buildBackup(
	eventId: Id,
	appVersion: string,
	db: AnyDb = getDb()
): Promise<BackupDocument> {
	const event = await db.events.get(eventId);
	if (!event) throw new Error('That event no longer exists.');

	const sessions = await db.sessions.where('eventId').equals(eventId).toArray();
	const heats = await db.heats.where('eventId').equals(eventId).toArray();
	const heatIds = heats.map((h) => h.id);
	const legs = heatIds.length ? await db.legs.where('heatId').anyOf(heatIds).toArray() : [];
	const participants = heatIds.length
		? await db.participants.where('heatId').anyOf(heatIds).toArray()
		: [];
	const incidents = await db.incidents.where('eventId').equals(eventId).toArray();

	const session = sessions[sessions.length - 1];

	return {
		kind: BACKUP_KIND,
		backupVersion: BACKUP_VERSION,
		schemaVersion: SCHEMA_VERSION,
		generatedAt: nowMs(),
		appVersion,
		station: {
			deviceId: session?.deviceId ?? 'unknown',
			deviceLabel: session?.deviceLabel ?? '',
			checkpointName: session?.checkpointName ?? 'unknown',
			operatorName: session?.operatorName ?? 'unknown',
			callSign: session?.callSign ?? ''
		},
		event,
		sessions,
		racers: await db.racers.where('eventId').equals(eventId).toArray(),
		heats,
		legs,
		participants,
		checkpoints: await db.checkpoints.where('eventId').equals(eventId).toArray(),
		observations: await db.observations.where('eventId').equals(eventId).toArray(),
		radio: await db.radio.where('eventId').equals(eventId).toArray(),
		eventLog: await db.eventLog.where('eventId').equals(eventId).toArray(),
		incidents,
		incidentActions: await db.incidentActions.where('eventId').equals(eventId).toArray(),
		revisions: await db.revisions.where('eventId').equals(eventId).toArray(),
		dismissals: await db.dismissals.where('eventId').equals(eventId).toArray(),
		clockAnomalies: await db.clockAnomalies.where('eventId').equals(eventId).toArray(),
		settings: []
	};
}

export interface ValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
	summary?: {
		eventName: string;
		station: string;
		generatedAt: number;
		counts: Record<string, number>;
	};
}

const ARRAY_FIELDS = [
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
	'incidentActions',
	'revisions'
] as const;

/**
 * Validation runs to completion before any write. A backup that fails here is
 * rejected whole, so a corrupt or incompatible file leaves existing records
 * exactly as they were.
 */
export function validateBackup(input: unknown): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (typeof input !== 'object' || input === null) {
		return { valid: false, errors: ['The file is not a JSON object.'], warnings };
	}
	const doc = input as Partial<BackupDocument>;

	if (doc.kind !== BACKUP_KIND) {
		errors.push('This file is not a Jet Boat Safety Log backup.');
	}
	if (typeof doc.backupVersion !== 'number') {
		errors.push('The backup has no version number.');
	} else if (doc.backupVersion > BACKUP_VERSION) {
		errors.push(
			`The backup was written by a newer app version (backup v${doc.backupVersion}, this app reads up to v${BACKUP_VERSION}).`
		);
	}
	if (!doc.event || typeof doc.event !== 'object' || typeof doc.event.id !== 'string') {
		errors.push('The backup contains no event record.');
	}
	for (const field of ARRAY_FIELDS) {
		if (!Array.isArray(doc[field])) errors.push(`Missing or malformed "${field}" list.`);
	}

	if (errors.length > 0) return { valid: false, errors, warnings };

	// Referential checks: warn rather than reject, so a partial log still imports.
	const heatIds = new Set((doc.heats ?? []).map((h) => h.id));
	const participantIds = new Set((doc.participants ?? []).map((p) => p.id));
	const orphanObservations = (doc.observations ?? []).filter(
		(o) =>
			(o.heatId && !heatIds.has(o.heatId)) ||
			(o.participantId && !participantIds.has(o.participantId))
	);
	if (orphanObservations.length > 0) {
		warnings.push(
			`${orphanObservations.length} observation(s) reference a heat or boat that is not in this backup. They will be restored as-is.`
		);
	}
	if ((doc.revisions ?? []).length === 0) {
		warnings.push('The backup contains no audit revisions.');
	}

	const counts: Record<string, number> = {};
	for (const field of ARRAY_FIELDS) counts[field] = (doc[field] as unknown[]).length;

	return {
		valid: true,
		errors,
		warnings,
		summary: {
			eventName: doc.event?.name ?? 'unknown',
			station: `${doc.station?.checkpointName ?? 'unknown'} / ${doc.station?.operatorName ?? 'unknown'}`,
			generatedAt: doc.generatedAt ?? 0,
			counts
		}
	};
}

export type RestoreMode = 'copy' | 'replace';

export interface RestoreResult {
	eventId: Id;
	mode: RestoreMode;
	/** Backup of what was there before, when a replace overwrote anything. */
	preReplaceBackup?: BackupDocument;
}

/**
 * Restores into a separate recoverable workspace by default. A replace must be
 * asked for explicitly and takes a backup of the existing event first.
 */
export async function restoreBackup(
	doc: BackupDocument,
	mode: RestoreMode,
	appVersion: string,
	db: AnyDb = getDb()
): Promise<RestoreResult> {
	const validation = validateBackup(doc);
	if (!validation.valid) {
		throw new Error(`Backup rejected: ${validation.errors.join(' ')}`);
	}

	let preReplaceBackup: BackupDocument | undefined;
	const targetEventId = mode === 'replace' ? doc.event.id : newId('evt-');

	if (mode === 'replace') {
		const existing = await db.events.get(doc.event.id);
		if (existing) preReplaceBackup = await buildBackup(doc.event.id, appVersion, db);
	}

	// Copy mode remaps every id so a restored workspace can coexist with the
	// live log without either one shadowing the other.
	const idMap = new Map<Id, Id>();
	const remap = (id: Id | null | undefined): Id | null => {
		if (id == null) return null;
		if (mode === 'replace') return id;
		let next = idMap.get(id);
		if (!next) {
			next = newId();
			idMap.set(id, next);
		}
		return next;
	};
	if (mode === 'copy') idMap.set(doc.event.id, targetEventId);

	const tables = [
		db.events,
		db.sessions,
		db.racers,
		db.heats,
		db.legs,
		db.participants,
		db.checkpoints,
		db.observations,
		db.radio,
		db.eventLog,
		db.incidents,
		db.incidentActions,
		db.revisions,
		db.dismissals,
		db.clockAnomalies
	];

	await db.transaction('rw', tables, async () => {
		if (mode === 'replace') {
			const heats = await db.heats.where('eventId').equals(doc.event.id).toArray();
			const heatIds = heats.map((h) => h.id);
			if (heatIds.length) {
				await db.legs.where('heatId').anyOf(heatIds).delete();
				await db.participants.where('heatId').anyOf(heatIds).delete();
			}
			for (const table of [
				db.sessions,
				db.racers,
				db.heats,
				db.checkpoints,
				db.observations,
				db.radio,
				db.eventLog,
				db.incidents,
				db.incidentActions,
				db.revisions,
				db.dismissals,
				db.clockAnomalies
			]) {
				await (
					table as unknown as {
						where: (k: string) => { equals: (v: string) => { delete: () => Promise<number> } };
					}
				)
					.where('eventId')
					.equals(doc.event.id)
					.delete();
			}
			await db.events.delete(doc.event.id);
		}

		await db.events.put({
			...doc.event,
			id: targetEventId,
			name: mode === 'copy' ? `${doc.event.name} (restored)` : doc.event.name,
			workspace: mode === 'copy' ? 'restored' : doc.event.workspace,
			importedFrom: `${doc.station.checkpointName} / ${doc.station.deviceId}`
		});

		await db.sessions.bulkPut(
			doc.sessions.map((s) => ({ ...s, id: remap(s.id) as Id, eventId: targetEventId }))
		);
		await db.racers.bulkPut(
			doc.racers.map((r) => ({ ...r, id: remap(r.id) as Id, eventId: targetEventId }))
		);
		await db.heats.bulkPut(
			doc.heats.map((h) => ({ ...h, id: remap(h.id) as Id, eventId: targetEventId }))
		);
		await db.legs.bulkPut(
			doc.legs.map((l) => ({ ...l, id: remap(l.id) as Id, heatId: remap(l.heatId) as Id }))
		);
		await db.participants.bulkPut(
			doc.participants.map((p) => ({
				...p,
				id: remap(p.id) as Id,
				heatId: remap(p.heatId) as Id,
				racerId: remap(p.racerId) as Id
			}))
		);
		await db.checkpoints.bulkPut(
			doc.checkpoints.map((c) => ({ ...c, id: remap(c.id) as Id, eventId: targetEventId }))
		);
		await db.observations.bulkPut(
			doc.observations.map((o) => ({
				...o,
				id: remap(o.id) as Id,
				eventId: targetEventId,
				sessionId: remap(o.sessionId) as Id,
				heatId: remap(o.heatId),
				legId: remap(o.legId),
				participantId: remap(o.participantId),
				reportingCheckpointId: remap(o.reportingCheckpointId)
			}))
		);
		await db.radio.bulkPut(
			doc.radio.map((r) => ({
				...r,
				id: remap(r.id) as Id,
				eventId: targetEventId,
				sessionId: remap(r.sessionId) as Id,
				heatId: remap(r.heatId),
				incidentId: remap(r.incidentId)
			}))
		);
		await db.eventLog.bulkPut(
			doc.eventLog.map((e) => ({
				...e,
				id: remap(e.id) as Id,
				eventId: targetEventId,
				sessionId: remap(e.sessionId) as Id,
				heatId: remap(e.heatId),
				incidentId: remap(e.incidentId)
			}))
		);
		await db.incidents.bulkPut(
			doc.incidents.map((i) => ({
				...i,
				id: remap(i.id) as Id,
				eventId: targetEventId,
				sessionId: remap(i.sessionId) as Id,
				heatId: remap(i.heatId)
			}))
		);
		await db.incidentActions.bulkPut(
			doc.incidentActions.map((a) => ({
				...a,
				id: remap(a.id) as Id,
				eventId: targetEventId,
				sessionId: remap(a.sessionId) as Id,
				incidentId: remap(a.incidentId) as Id
			}))
		);
		await db.revisions.bulkPut(
			doc.revisions.map((r) => ({
				...r,
				id: remap(r.id) as Id,
				eventId: targetEventId,
				recordId: remap(r.recordId) as Id
			}))
		);
		await db.dismissals.bulkPut(
			doc.dismissals.map((d) => ({ ...d, id: remap(d.id) as Id, eventId: targetEventId }))
		);
		await db.clockAnomalies.bulkPut(
			doc.clockAnomalies.map((c) => ({ ...c, id: remap(c.id) as Id, eventId: targetEventId }))
		);
	});

	return { eventId: targetEventId, mode, preReplaceBackup };
}

/**
 * Stable content hash over the backup's records, ignoring generation time so a
 * re-export of unchanged data is recognised as the same snapshot.
 */
export async function hashBackup(doc: BackupDocument): Promise<string> {
	const stable = JSON.stringify({
		event: doc.event,
		sessions: doc.sessions,
		racers: doc.racers,
		heats: doc.heats,
		legs: doc.legs,
		participants: doc.participants,
		checkpoints: doc.checkpoints,
		observations: doc.observations,
		radio: doc.radio,
		eventLog: doc.eventLog,
		incidents: doc.incidents,
		incidentActions: doc.incidentActions,
		revisions: doc.revisions
	});
	const subtle = globalThis.crypto?.subtle;
	if (subtle) {
		const bytes = new TextEncoder().encode(stable);
		const digest = await subtle.digest('SHA-256', bytes);
		return Array.from(new Uint8Array(digest))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}
	// Non-secure contexts have no SubtleCrypto; a non-cryptographic digest is
	// enough for "have I already imported this exact file?".
	let h1 = 0x811c9dc5;
	let h2 = 0x01000193;
	for (let i = 0; i < stable.length; i += 1) {
		h1 = Math.imul(h1 ^ stable.charCodeAt(i), 0x01000193) >>> 0;
		h2 = Math.imul(h2 + stable.charCodeAt(i), 0x85ebca6b) >>> 0;
	}
	return `fnv-${h1.toString(16)}${h2.toString(16)}-${stable.length.toString(16)}`;
}

export type ArchiveOutcome = 'added' | 'duplicate' | 'new-version';

export interface ArchiveResult {
	outcome: ArchiveOutcome;
	entry: ArchivedLog;
}

/**
 * Collects another station's backup into a read-only archive. Each source log
 * is kept whole and separate: nothing is merged, deduplicated across stations,
 * or combined into a single accountability claim.
 */
export async function archiveBackup(
	doc: BackupDocument,
	db: AnyDb = getDb()
): Promise<ArchiveResult> {
	const validation = validateBackup(doc);
	if (!validation.valid) throw new Error(`Backup rejected: ${validation.errors.join(' ')}`);

	const contentHash = await hashBackup(doc);
	const existingSameContent = await db.archive.where('contentHash').equals(contentHash).first();
	if (existingSameContent) {
		return { outcome: 'duplicate', entry: existingSameContent };
	}

	const sameStation = await db.archive.where('deviceId').equals(doc.station.deviceId).toArray();
	const sameStationSameEvent = sameStation.filter((a) => a.eventName === doc.event.name);
	const snapshotVersion =
		sameStationSameEvent.reduce((max, a) => Math.max(max, a.snapshotVersion), 0) + 1;

	const entry: ArchivedLog = {
		id: newId('arc-'),
		contentHash,
		stationLabel: doc.station.checkpointName,
		operatorName: doc.station.operatorName,
		eventName: doc.event.name,
		deviceId: doc.station.deviceId,
		importedAt: nowMs(),
		generatedAt: doc.generatedAt,
		backupVersion: doc.backupVersion,
		payload: doc,
		snapshotVersion
	};
	await db.archive.add(entry);
	return { outcome: snapshotVersion > 1 ? 'new-version' : 'added', entry };
}
