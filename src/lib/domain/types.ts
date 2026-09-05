/**
 * Domain model for the jet boat safety log.
 *
 * Design rules that come straight from the operating brief:
 *  - Nothing derived is stored as a second source of truth. Accountability is
 *    computed from observations plus per-heat participation decisions.
 *  - A racer has no global status. DNF/scratch/finish live on HeatParticipant,
 *    so a boat can DNF one heat and race the next.
 *  - Every timestamp is epoch milliseconds in UTC. Display timezone is a
 *    property of the event, kept alongside the offset captured at write time.
 *  - captureTime is written once and never changed. Corrections move
 *    effectiveTime and are recorded as AuditRevision rows.
 */

export type Id = string;

/** Milliseconds since the Unix epoch, UTC. */
export type EpochMs = number;

export type LegFormat =
	| 'one-way'
	/** One start, outbound and return observations at the same checkpoint. */
	| 'continuous-down-and-back'
	/** Distinct legs, each with its own start/finish where the operator uses them. */
	| 'separate-legs';

export type Direction = 'upstream' | 'downstream' | 'unknown';

export type StartMode = 'individual' | 'mass';

/** How the operator came to know about the thing being recorded. */
export type ObservationSource =
	/** Operator saw it from this checkpoint. */
	| 'direct'
	/** Heard over the radio from another station / race control. */
	| 'radio'
	/** Entered after the fact from notes or another operator. */
	| 'manual';

export type ObservationType =
	/** Start announcement heard for a racer (individual or one of a mass start). */
	| 'start'
	/** Boat passed this checkpoint, observed directly. */
	| 'pass'
	/** Another checkpoint reported the boat passing them. */
	| 'checkpoint-pass'
	/** Finish-line announcement heard for a racer. */
	| 'finish'
	/** Sweep boat passed this checkpoint. */
	| 'sweep'
	/** Heat-complete announcement heard on the radio. */
	| 'heat-complete';

export type ParticipationState =
	/** On the lineup and expected to race. */
	| 'entered'
	/** Removed from this heat before the start. */
	| 'scratched'
	/** Announced/known as not starting. */
	| 'dns'
	/** Announced/known as not finishing this heat. */
	| 'dnf';

export type SaveState = 'pending' | 'saved' | 'failed';

export type CoordinateFormat = 'dd' | 'ddm' | 'dms';

export type LocationSource =
	/** Copied from the saved checkpoint coordinates. */
	| 'checkpoint-estimate'
	/** Taken from a device GPS fix. */
	| 'device-fix'
	/** Typed in by the operator. */
	| 'manual-entry'
	/** No coordinates are known yet. */
	| 'pending';

export interface Coordinates {
	/** WGS84 decimal degrees, positive north. */
	latitude: number;
	/** WGS84 decimal degrees, positive east. */
	longitude: number;
	/** Reported horizontal accuracy in metres, when the source provided one. */
	accuracyMeters?: number | null;
	/** When the underlying fix was taken (not when it was saved). */
	fixTime?: EpochMs | null;
}

export interface RecordedLocation extends Partial<Coordinates> {
	source: LocationSource;
	/** When this location was attached to the record. */
	capturedAt: EpochMs;
	/** Free text for manual entries, e.g. "river left, below the bridge". */
	note?: string;
}

export interface BaseRecord {
	id: Id;
	createdAt: EpochMs;
	updatedAt: EpochMs;
	/** Voided records stay in the database and stay reviewable. */
	voided: boolean;
	voidedAt?: EpochMs | null;
	voidReason?: string | null;
}

export interface RaceEvent extends BaseRecord {
	name: string;
	/** ISO dates (YYYY-MM-DD), one or more days. */
	dates: string[];
	/** IANA timezone name used for all human-readable times in this event. */
	timezone: string;
	courseNotes: string;
	/** Demo data is clearly separated from real logs. */
	isDemo: boolean;
	/** Restored backups land in their own workspace copy. */
	workspace: 'live' | 'restored' | 'archive';
	/** Set when this event came from an imported backup. */
	importedFrom?: string | null;
}

export interface StationSession extends BaseRecord {
	eventId: Id;
	checkpointName: string;
	safetyBoatNumber: string;
	operatorName: string;
	callSign: string;
	channel: string;
	checkpointLocation?: Coordinates | null;
	/** Stable per-install identity so collected logs can be told apart. */
	deviceId: string;
	deviceLabel: string;
	startedAt: EpochMs;
	endedAt?: EpochMs | null;
}

export interface Racer extends BaseRecord {
	eventId: Id;
	/** Text, never a number: leading zeros and letters are meaningful. */
	boatNumber: string;
	className: string;
	notes: string;
}

export interface Heat extends BaseRecord {
	eventId: Id;
	name: string;
	legFormat: LegFormat;
	startMode: StartMode;
	/** Ordinal for display; not a timestamp. */
	sortIndex: number;
	/** Administrative close by the operator. Distinct from a heat-complete call. */
	closedAt?: EpochMs | null;
	closedBy?: string | null;
	notes: string;
}

export interface Leg extends BaseRecord {
	heatId: Id;
	name: string;
	sortIndex: number;
	/** Direction the field travels on this leg past this checkpoint. */
	direction: Direction;
	/** Whether the operator uses a start observation on this leg. */
	hasStart: boolean;
	/** Whether the operator uses a finish observation on this leg. */
	hasFinish: boolean;
}

export interface HeatParticipant extends BaseRecord {
	heatId: Id;
	racerId: Id;
	/** Position in the starting order as read over the radio. */
	startOrder: number;
	participation: ParticipationState;
	/** Why the participation state was set, when the operator gave a reason. */
	participationNote: string;
	/** Optional per-heat class override for grouped mass starts. */
	className: string;
}

export interface ReportingCheckpoint extends BaseRecord {
	eventId: Id;
	name: string;
	/** Whether this checkpoint is expected to call passages on the radio. */
	expectedToReport: boolean;
	sortIndex: number;
	notes: string;
}

export interface Observation extends BaseRecord {
	eventId: Id;
	sessionId: Id;
	deviceId: string;
	operatorName: string;

	heatId?: Id | null;
	legId?: Id | null;
	/** Set once the observation is assigned to a racer in the lineup. */
	participantId?: Id | null;
	/** Boat number typed in before (or instead of) assigning a participant. */
	unassignedBoatText?: string | null;

	type: ObservationType;
	source: ObservationSource;
	/** Checkpoint the observation is about. Own checkpoint for direct passes. */
	checkpointName: string;
	/** Set for 'checkpoint-pass': which station reported it. */
	reportingCheckpointId?: Id | null;

	/** Written once at the moment of the operator's activation. Never edited. */
	captureTime: EpochMs;
	/** For radio traffic: when the operator received the call. */
	receivedTime?: EpochMs | null;
	/** When the reporter says the thing actually happened. Optional, later. */
	reportedTime?: EpochMs | null;
	/** What the timeline sorts and reports on. Starts equal to captureTime. */
	effectiveTime: EpochMs;
	/** UTC offset in minutes in force at capture, for faithful export. */
	captureOffsetMinutes: number;
	/** Monotonic, per-device, so capture order survives time corrections. */
	sequence: number;

	direction: Direction;
	notes: string;
	/** Operator was not certain which boat this was. */
	uncertainIdentification: boolean;
	/** Shared by every observation written by one mass-start activation. */
	groupActionId?: Id | null;
	/** Operator acknowledged a review prompt about this record. */
	reviewAcknowledgedAt?: EpochMs | null;
}

export type RadioDirection = 'received' | 'sent';
export type RadioPriority = 'routine' | 'priority' | 'emergency';

export interface RadioMessage extends BaseRecord {
	eventId: Id;
	sessionId: Id;
	heatId?: Id | null;
	direction: RadioDirection;
	fromParty: string;
	toParty: string;
	channel: string;
	/** Boat numbers as text; may reference racers not on this heat's lineup. */
	boatNumbers: string[];
	message: string;
	priority: RadioPriority;
	acknowledged: boolean;
	followUpRequired: boolean;
	captureTime: EpochMs;
	receivedTime?: EpochMs | null;
	reportedTime?: EpochMs | null;
	effectiveTime: EpochMs;
	captureOffsetMinutes: number;
	sequence: number;
	incidentId?: Id | null;
}

export type EventLogKind = 'note' | 'hazard' | 'course-hold' | 'status' | 'administrative';

export interface EventLogEntry extends BaseRecord {
	eventId: Id;
	sessionId: Id;
	heatId?: Id | null;
	kind: EventLogKind;
	message: string;
	captureTime: EpochMs;
	reportedTime?: EpochMs | null;
	effectiveTime: EpochMs;
	captureOffsetMinutes: number;
	sequence: number;
	incidentId?: Id | null;
}

export type IncidentStatus = 'open' | 'resolved';

export interface Incident extends BaseRecord {
	eventId: Id;
	sessionId: Id;
	heatId?: Id | null;
	status: IncidentStatus;
	incidentType: string;
	severity: string;
	boatNumbers: string[];
	locationNotes: string;
	riverSide: string;
	hazards: string;
	peopleInvolved: string;
	reportedInjuries: string;
	resources: string;
	notificationsMade: string;
	followUp: string;
	resolution: string;
	/** Written the instant Emergency is pressed, before any field is filled. */
	captureTime: EpochMs;
	effectiveTime: EpochMs;
	captureOffsetMinutes: number;
	sequence: number;
	resolvedAt?: EpochMs | null;
	/** Explicitly chosen incident position. Live device movement never edits it. */
	incidentLocation?: RecordedLocation | null;
	/** First device fix available after activation, kept for provenance. */
	initialDeviceFix?: RecordedLocation | null;
	/** Checkpoint coordinates copied at activation as the initial estimate. */
	checkpointLocation?: RecordedLocation | null;
}

export interface IncidentAction extends BaseRecord {
	incidentId: Id;
	eventId: Id;
	sessionId: Id;
	text: string;
	captureTime: EpochMs;
	reportedTime?: EpochMs | null;
	effectiveTime: EpochMs;
	captureOffsetMinutes: number;
	sequence: number;
}

export type AuditAction = 'create' | 'update' | 'void' | 'restore';

export interface AuditRevision {
	id: Id;
	eventId: Id;
	/** Dexie table name of the record this revision describes. */
	table: string;
	recordId: Id;
	action: AuditAction;
	/** Field-level before/after. Empty for 'create'. */
	changes: Array<{ field: string; before: unknown; after: unknown }>;
	at: EpochMs;
	operatorName: string;
	deviceId: string;
	reason: string;
	sequence: number;
}

export interface ReviewPromptDismissal {
	id: Id;
	eventId: Id;
	/** Stable key identifying the prompt, so it stays dismissed across reloads. */
	promptKey: string;
	at: EpochMs;
	note: string;
}

/** Single-row-per-key application state that is not part of the race record. */
export interface AppSetting {
	key: string;
	value: unknown;
	updatedAt: EpochMs;
}

/** A read-only copy of another station's backup, kept whole and unmerged. */
export interface ArchivedLog {
	id: Id;
	/** Hash of the backup payload; identical re-import is detected by this. */
	contentHash: string;
	stationLabel: string;
	operatorName: string;
	eventName: string;
	deviceId: string;
	importedAt: EpochMs;
	/** Backup's own generation time. */
	generatedAt: EpochMs;
	backupVersion: number;
	/** The untouched backup document. */
	payload: unknown;
	/** Increments when a changed snapshot arrives from the same station. */
	snapshotVersion: number;
}

/** Recorded whenever wall-clock time jumps against monotonic elapsed time. */
export interface ClockAnomaly {
	id: Id;
	eventId: Id;
	detectedAt: EpochMs;
	/** Difference between wall-clock delta and monotonic delta, in ms. */
	driftMs: number;
	acknowledgedAt?: EpochMs | null;
	note: string;
}
