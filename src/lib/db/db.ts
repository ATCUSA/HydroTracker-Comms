import Dexie, { type Table } from 'dexie';
import type {
	AppSetting,
	ArchivedLog,
	AuditRevision,
	ClockAnomaly,
	EventLogEntry,
	Heat,
	HeatParticipant,
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

/**
 * IndexedDB is the authoritative store. Every schema change gets its own
 * numbered version block below; versions are never edited in place once they
 * have shipped, so an existing device upgrades through the same path a new one
 * would take.
 */
export const SCHEMA_VERSION = 1;

export class SafetyLogDatabase extends Dexie {
	events!: Table<RaceEvent, string>;
	sessions!: Table<StationSession, string>;
	racers!: Table<Racer, string>;
	heats!: Table<Heat, string>;
	legs!: Table<Leg, string>;
	participants!: Table<HeatParticipant, string>;
	checkpoints!: Table<ReportingCheckpoint, string>;
	observations!: Table<Observation, string>;
	radio!: Table<RadioMessage, string>;
	eventLog!: Table<EventLogEntry, string>;
	incidents!: Table<Incident, string>;
	incidentActions!: Table<IncidentAction, string>;
	revisions!: Table<AuditRevision, string>;
	dismissals!: Table<ReviewPromptDismissal, string>;
	settings!: Table<AppSetting, string>;
	archive!: Table<ArchivedLog, string>;
	clockAnomalies!: Table<ClockAnomaly, string>;

	constructor(name = 'hydrotracker-comms') {
		super(name);

		this.version(1).stores({
			events: 'id, name, workspace, isDemo',
			sessions: 'id, eventId, deviceId',
			racers: 'id, eventId, boatNumber, className',
			heats: 'id, eventId, sortIndex',
			legs: 'id, heatId, sortIndex',
			participants: 'id, heatId, racerId, [heatId+racerId], startOrder',
			checkpoints: 'id, eventId, sortIndex',
			observations:
				'id, eventId, heatId, legId, participantId, type, effectiveTime, sequence, [heatId+type], [eventId+sequence]',
			radio: 'id, eventId, heatId, incidentId, effectiveTime, sequence',
			eventLog: 'id, eventId, heatId, incidentId, effectiveTime, sequence',
			incidents: 'id, eventId, status, effectiveTime, sequence',
			incidentActions: 'id, incidentId, eventId, effectiveTime, sequence',
			revisions: 'id, eventId, recordId, table, at, sequence',
			dismissals: 'id, eventId, promptKey',
			settings: 'key',
			archive: 'id, contentHash, deviceId, importedAt',
			clockAnomalies: 'id, eventId, detectedAt'
		});
	}
}

let instance: SafetyLogDatabase | null = null;

export function getDb(): SafetyLogDatabase {
	if (!instance) instance = new SafetyLogDatabase();
	return instance;
}

/** Test seam: swap in a database backed by a fake IndexedDB. */
export function setDb(db: SafetyLogDatabase | null): void {
	instance = db;
}

export type AnyDb = SafetyLogDatabase;
