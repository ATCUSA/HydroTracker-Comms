import { getDb } from '$lib/db/db';
import { createRecord, saveRecord, voidRecord } from '$lib/db/repo';
import { nowMs, deviceTimezone } from '$lib/time/clock';
import { legTemplatesFor } from '$lib/domain/legs';
import { copyLineup } from '$lib/domain/accountability';
import type {
	Heat,
	HeatParticipant,
	Id,
	LegFormat,
	Leg,
	ParticipationState,
	RaceEvent,
	Racer,
	ReportingCheckpoint,
	StartMode,
	StationSession
} from '$lib/domain/types';
import { app } from '$lib/stores/app.svelte';

function ctx(eventId: Id) {
	return { eventId, operatorName: app.session?.operatorName ?? 'setup', deviceId: app.deviceId };
}

export interface EventDraft {
	name: string;
	dates: string[];
	timezone?: string;
	courseNotes?: string;
	isDemo?: boolean;
	workspace?: RaceEvent['workspace'];
}

export async function createEvent(draft: EventDraft): Promise<RaceEvent> {
	// The event id is not known until the record is built, so seed the audit
	// context with a placeholder and let createRecord stamp the real id.
	const db = getDb();
	const at = nowMs();
	const record = await createRecord<RaceEvent>(
		'events',
		({ id }) => ({
			id,
			createdAt: at,
			updatedAt: at,
			voided: false,
			name: draft.name,
			dates: draft.dates,
			timezone: draft.timezone ?? deviceTimezone(),
			courseNotes: draft.courseNotes ?? '',
			isDemo: draft.isDemo ?? false,
			workspace: draft.workspace ?? 'live',
			importedFrom: null
		}),
		{ eventId: '', operatorName: app.session?.operatorName ?? 'setup', deviceId: app.deviceId },
		db
	);
	// Point the just-written audit row at the event it belongs to.
	const rev = await db.revisions.where('recordId').equals(record.id).first();
	if (rev) await db.revisions.update(rev.id, { eventId: record.id });
	return record;
}

export async function updateEvent(event: RaceEvent, reason = 'Event settings changed') {
	return saveRecord('events', event, { ...ctx(event.id), reason });
}

export interface SessionDraft {
	eventId: Id;
	checkpointName: string;
	safetyBoatNumber: string;
	operatorName: string;
	callSign: string;
	channel?: string;
	checkpointLocation?: StationSession['checkpointLocation'];
	deviceLabel?: string;
}

export async function startSession(draft: SessionDraft): Promise<StationSession> {
	const at = nowMs();
	return createRecord<StationSession>(
		'sessions',
		({ id }) => ({
			id,
			createdAt: at,
			updatedAt: at,
			voided: false,
			eventId: draft.eventId,
			checkpointName: draft.checkpointName,
			safetyBoatNumber: draft.safetyBoatNumber,
			operatorName: draft.operatorName,
			callSign: draft.callSign,
			channel: draft.channel ?? '',
			checkpointLocation: draft.checkpointLocation ?? null,
			deviceId: app.deviceId,
			deviceLabel: draft.deviceLabel ?? '',
			startedAt: at,
			endedAt: null
		}),
		ctx(draft.eventId)
	);
}

export async function updateSession(session: StationSession, reason = 'Station details changed') {
	return saveRecord('sessions', session, { ...ctx(session.eventId), reason });
}

export async function addRacer(
	eventId: Id,
	boatNumber: string,
	className = '',
	notes = ''
): Promise<Racer> {
	const at = nowMs();
	return createRecord<Racer>(
		'racers',
		({ id }) => ({
			id,
			createdAt: at,
			updatedAt: at,
			voided: false,
			eventId,
			boatNumber: boatNumber.trim(),
			className: className.trim(),
			notes
		}),
		ctx(eventId)
	);
}

/**
 * Finds an existing roster entry for a boat number or creates one. Boat numbers
 * are compared as trimmed text so "007" and "7" stay different boats.
 */
export async function ensureRacer(eventId: Id, boatNumber: string, className = ''): Promise<Racer> {
	const trimmed = boatNumber.trim();
	const db = getDb();
	const existing = await db.racers
		.where('eventId')
		.equals(eventId)
		.filter((r) => !r.voided && r.boatNumber === trimmed)
		.first();
	if (existing) {
		if (className && !existing.className) {
			return saveRecord('racers', { ...existing, className }, ctx(eventId));
		}
		return existing;
	}
	return addRacer(eventId, trimmed, className);
}

export async function updateRacer(racer: Racer, reason = 'Roster edit') {
	return saveRecord('racers', racer, { ...ctx(racer.eventId), reason });
}

export async function removeRacer(racer: Racer, reason = 'Removed from roster') {
	return voidRecord('racers', racer.id, { ...ctx(racer.eventId), reason });
}

export interface HeatDraft {
	eventId: Id;
	name: string;
	legFormat: LegFormat;
	startMode?: StartMode;
	legCount?: number;
	notes?: string;
}

export async function createHeat(draft: HeatDraft): Promise<Heat> {
	const db = getDb();
	const at = nowMs();
	const siblings = await db.heats.where('eventId').equals(draft.eventId).toArray();
	const heat = await createRecord<Heat>(
		'heats',
		({ id }) => ({
			id,
			createdAt: at,
			updatedAt: at,
			voided: false,
			eventId: draft.eventId,
			name: draft.name,
			legFormat: draft.legFormat,
			startMode: draft.startMode ?? 'individual',
			sortIndex: siblings.length + 1,
			closedAt: null,
			closedBy: null,
			notes: draft.notes ?? ''
		}),
		ctx(draft.eventId)
	);
	const templates = legTemplatesFor(draft.legFormat, draft.legCount ?? 2);
	for (const [index, tpl] of templates.entries()) {
		// eslint-disable-next-line no-await-in-loop
		await createRecord<Leg>(
			'legs',
			({ id }) => ({
				id,
				createdAt: at,
				updatedAt: at,
				voided: false,
				heatId: heat.id,
				name: tpl.name,
				sortIndex: index + 1,
				direction: tpl.direction,
				hasStart: tpl.hasStart,
				hasFinish: tpl.hasFinish
			}),
			ctx(draft.eventId)
		);
	}
	return heat;
}

export async function updateHeat(heat: Heat, reason = 'Heat edit') {
	return saveRecord('heats', heat, { ...ctx(heat.eventId), reason });
}

export async function updateLeg(leg: Leg, eventId: Id, reason = 'Leg edit') {
	return saveRecord('legs', leg, { ...ctx(eventId), reason });
}

/**
 * Administrative close. This is not a heat-complete radio call and it fabricates
 * nothing: no finishes, no missing observations. Closed heats stay editable.
 */
export async function closeHeat(heat: Heat, operatorName: string) {
	return saveRecord(
		'heats',
		{ ...heat, closedAt: nowMs(), closedBy: operatorName },
		{ ...ctx(heat.eventId), reason: 'Operator closed the heat' }
	);
}

export async function reopenHeat(heat: Heat) {
	return saveRecord(
		'heats',
		{ ...heat, closedAt: null, closedBy: null },
		{ ...ctx(heat.eventId), reason: 'Operator reopened the heat' }
	);
}

export async function addParticipant(
	eventId: Id,
	heatId: Id,
	racerId: Id,
	startOrder: number,
	className = ''
): Promise<HeatParticipant> {
	const at = nowMs();
	return createRecord<HeatParticipant>(
		'participants',
		({ id }) => ({
			id,
			createdAt: at,
			updatedAt: at,
			voided: false,
			heatId,
			racerId,
			startOrder,
			participation: 'entered',
			participationNote: '',
			className
		}),
		ctx(eventId)
	);
}

export async function setParticipation(
	eventId: Id,
	participant: HeatParticipant,
	participation: ParticipationState,
	note = ''
) {
	return saveRecord(
		'participants',
		{ ...participant, participation, participationNote: note },
		{ ...ctx(eventId), reason: `Participation set to ${participation}` }
	);
}

/** Removes a boat from this heat's lineup without touching the event roster. */
export async function removeFromLineup(eventId: Id, participant: HeatParticipant) {
	return voidRecord('participants', participant.id, {
		...ctx(eventId),
		reason: 'Removed from lineup (roster unchanged)'
	});
}

export async function reorderLineup(eventId: Id, ordered: HeatParticipant[]) {
	for (const [index, participant] of ordered.entries()) {
		if (participant.startOrder === index + 1) continue;
		// eslint-disable-next-line no-await-in-loop
		await saveRecord(
			'participants',
			{ ...participant, startOrder: index + 1 },
			{ ...ctx(eventId), reason: 'Starting order changed' }
		);
	}
}

/**
 * Copies a lineup into a new or existing heat. Only order and class travel:
 * no times, no DNF, no scratches, no results.
 */
export async function copyLineupInto(eventId: Id, sourceHeatId: Id, targetHeatId: Id) {
	const db = getDb();
	const source = await db.participants.where('heatId').equals(sourceHeatId).toArray();
	const copies = copyLineup(source, targetHeatId);
	for (const copy of copies) {
		// eslint-disable-next-line no-await-in-loop
		await addParticipant(eventId, targetHeatId, copy.racerId, copy.startOrder, copy.className);
	}
	return copies.length;
}

export async function addCheckpoint(
	eventId: Id,
	name: string,
	expectedToReport = true,
	notes = ''
): Promise<ReportingCheckpoint> {
	const db = getDb();
	const at = nowMs();
	const siblings = await db.checkpoints.where('eventId').equals(eventId).toArray();
	return createRecord<ReportingCheckpoint>(
		'checkpoints',
		({ id }) => ({
			id,
			createdAt: at,
			updatedAt: at,
			voided: false,
			eventId,
			name,
			expectedToReport,
			sortIndex: siblings.length + 1,
			notes
		}),
		ctx(eventId)
	);
}

export async function updateCheckpoint(cp: ReportingCheckpoint, reason = 'Checkpoint edit') {
	return saveRecord('checkpoints', cp, { ...ctx(cp.eventId), reason });
}

export async function removeCheckpoint(cp: ReportingCheckpoint) {
	return voidRecord('checkpoints', cp.id, { ...ctx(cp.eventId), reason: 'Checkpoint removed' });
}

/** Parses a pasted or typed list of boat numbers. Text, never numbers. */
export function parseBoatList(text: string): string[] {
	return text
		.split(/[\n,;\t]+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}
