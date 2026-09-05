import { getDb } from '$lib/db/db';
import { createRecord, saveRecord, voidRecord, restoreRecord } from '$lib/db/repo';
import { newId } from '$lib/domain/ids';
import { captureInstant, nowMs, utcOffsetMinutes, type Instant } from '$lib/time/clock';
import type {
	Direction,
	EventLogEntry,
	EventLogKind,
	Id,
	Observation,
	ObservationSource,
	ObservationType,
	RadioMessage,
	RadioDirection,
	RadioPriority
} from '$lib/domain/types';
import { app } from '$lib/stores/app.svelte';
import { saveQueue } from '$lib/stores/saveQueue.svelte';

/**
 * Call this synchronously inside the activation handler, before rendering a
 * form or asking for a GPS fix. Everything downstream uses the instant it
 * returns, so the recorded time is the operator's tap, not the moment the
 * database happened to be ready.
 */
export function beginCapture(): Instant {
	return captureInstant();
}

export interface ObservationDraft {
	type: ObservationType;
	source?: ObservationSource;
	heatId?: Id | null;
	legId?: Id | null;
	participantId?: Id | null;
	unassignedBoatText?: string | null;
	direction?: Direction;
	notes?: string;
	uncertainIdentification?: boolean;
	checkpointName?: string;
	reportingCheckpointId?: Id | null;
	receivedTime?: number | null;
	reportedTime?: number | null;
	groupActionId?: Id | null;
}

function baseFields(instant: Instant, draft: ObservationDraft) {
	const isRadio = draft.source === 'radio' || draft.type === 'checkpoint-pass';
	return {
		type: draft.type,
		source: draft.source ?? (draft.type === 'checkpoint-pass' ? 'radio' : 'direct'),
		heatId: draft.heatId ?? app.heatId,
		legId: draft.legId ?? app.legId,
		participantId: draft.participantId ?? null,
		unassignedBoatText: draft.unassignedBoatText ?? null,
		direction: draft.direction ?? app.leg?.direction ?? 'unknown',
		notes: draft.notes ?? '',
		uncertainIdentification: draft.uncertainIdentification ?? false,
		checkpointName: draft.checkpointName ?? app.session?.checkpointName ?? '',
		reportingCheckpointId: draft.reportingCheckpointId ?? null,
		receivedTime: draft.receivedTime ?? (isRadio ? instant.epoch : null),
		reportedTime: draft.reportedTime ?? null,
		groupActionId: draft.groupActionId ?? null
	} as const;
}

/**
 * Writes one observation. The returned promise resolves to the saved record,
 * or rejects; the save queue turns a rejection into a visible, retryable
 * failure rather than a silent loss.
 */
export async function writeObservation(
	instant: Instant,
	draft: ObservationDraft
): Promise<Observation> {
	const ctx = app.writeContext;
	if (!ctx.eventId) throw new Error('No event selected — set up an event before capturing.');
	if (!app.sessionId) throw new Error('No station session — start a session before capturing.');
	return createRecord<Observation>(
		'observations',
		({ id, at, sequence }) => ({
			id,
			createdAt: at,
			updatedAt: at,
			voided: false,
			eventId: ctx.eventId,
			sessionId: app.sessionId as Id,
			deviceId: app.deviceId,
			operatorName: ctx.operatorName,
			captureTime: instant.epoch,
			effectiveTime: instant.epoch,
			captureOffsetMinutes: utcOffsetMinutes(instant.epoch),
			sequence,
			...baseFields(instant, draft)
		}),
		ctx
	);
}

const TYPE_LABELS: Record<ObservationType, string> = {
	start: 'Start heard',
	pass: 'Pass',
	'checkpoint-pass': 'Radio checkpoint pass',
	finish: 'Finish heard',
	sweep: 'Sweep',
	'heat-complete': 'Heat complete call'
};

/** Queues an observation and reports whether the transaction committed. */
export async function captureObservation(
	instant: Instant,
	draft: ObservationDraft
): Promise<boolean> {
	const boat = draft.participantId
		? (app.boatNumberFor(draft.participantId) ?? '')
		: (draft.unassignedBoatText ?? '');
	const label = `${TYPE_LABELS[draft.type]}${boat ? ` — ${boat}` : ' — unassigned'}`;
	return saveQueue.submit(label, instant.epoch, async () => {
		await writeObservation(instant, draft);
	});
}

/**
 * Mass start: one activation, one shared timestamp, one observation per
 * selected participant, all linked by a group id. Nonparticipants get nothing.
 */
export async function captureMassStart(
	instant: Instant,
	participantIds: Id[],
	extra: Partial<ObservationDraft> = {}
): Promise<boolean> {
	if (participantIds.length === 0) return false;
	const groupActionId = newId('grp-');
	return saveQueue.submit(
		`Mass start — ${participantIds.length} boat(s)`,
		instant.epoch,
		async () => {
			for (const participantId of participantIds) {
				// Sequential so each row gets its own durable sequence number.
				// eslint-disable-next-line no-await-in-loop
				await writeObservation(instant, {
					type: 'start',
					participantId,
					groupActionId,
					...extra
				});
			}
		}
	);
}

/** Attaches a racer to an observation that was captured as unassigned. */
export async function assignObservation(
	observationId: Id,
	participantId: Id | null,
	options: { unassignedBoatText?: string | null; reason?: string } = {}
): Promise<boolean> {
	const db = getDb();
	const existing = await db.observations.get(observationId);
	if (!existing) return false;
	return saveQueue.submit(`Assign record`, nowMs(), async () => {
		await saveRecord(
			'observations',
			{
				...existing,
				participantId,
				unassignedBoatText: options.unassignedBoatText ?? existing.unassignedBoatText
			},
			{ ...app.writeContext, reason: options.reason ?? 'Assigned racer' }
		);
	});
}

export interface ObservationCorrection {
	effectiveTime?: number;
	reportedTime?: number | null;
	participantId?: Id | null;
	heatId?: Id | null;
	legId?: Id | null;
	direction?: Direction;
	checkpointName?: string;
	reportingCheckpointId?: Id | null;
	notes?: string;
	uncertainIdentification?: boolean;
	type?: ObservationType;
}

/**
 * Corrections change what the record means going forward. captureTime is
 * deliberately absent from the correction type: the original capture instant is
 * permanent.
 */
export async function correctObservation(
	observationId: Id,
	changes: ObservationCorrection,
	reason: string
): Promise<boolean> {
	const db = getDb();
	const existing = await db.observations.get(observationId);
	if (!existing) return false;
	return saveQueue.submit('Correction', nowMs(), async () => {
		await saveRecord('observations', { ...existing, ...changes }, { ...app.writeContext, reason });
	});
}

export async function voidObservation(observationId: Id, reason: string): Promise<boolean> {
	return saveQueue.submit('Void record', nowMs(), async () => {
		await voidRecord('observations', observationId, { ...app.writeContext, reason });
	});
}

export async function restoreObservation(observationId: Id, reason: string): Promise<boolean> {
	return saveQueue.submit('Restore record', nowMs(), async () => {
		await restoreRecord('observations', observationId, { ...app.writeContext, reason });
	});
}

export interface RadioDraft {
	direction: RadioDirection;
	fromParty?: string;
	toParty?: string;
	channel?: string;
	boatNumbers?: string[];
	message: string;
	priority?: RadioPriority;
	acknowledged?: boolean;
	followUpRequired?: boolean;
	heatId?: Id | null;
	incidentId?: Id | null;
	reportedTime?: number | null;
}

export async function captureRadio(instant: Instant, draft: RadioDraft): Promise<boolean> {
	const ctx = app.writeContext;
	return saveQueue.submit(
		`Radio ${draft.direction} — ${draft.message.slice(0, 40) || '(no text yet)'}`,
		instant.epoch,
		async () => {
			await createRecord<RadioMessage>(
				'radio',
				({ id, at, sequence }) => ({
					id,
					createdAt: at,
					updatedAt: at,
					voided: false,
					eventId: ctx.eventId,
					sessionId: app.sessionId as Id,
					heatId: draft.heatId ?? null,
					direction: draft.direction,
					fromParty: draft.fromParty ?? '',
					toParty: draft.toParty ?? '',
					channel: draft.channel ?? app.session?.channel ?? '',
					boatNumbers: draft.boatNumbers ?? [],
					message: draft.message,
					priority: draft.priority ?? 'routine',
					acknowledged: draft.acknowledged ?? false,
					followUpRequired: draft.followUpRequired ?? false,
					captureTime: instant.epoch,
					receivedTime: draft.direction === 'received' ? instant.epoch : null,
					reportedTime: draft.reportedTime ?? null,
					effectiveTime: instant.epoch,
					captureOffsetMinutes: utcOffsetMinutes(instant.epoch),
					sequence,
					incidentId: draft.incidentId ?? null
				}),
				ctx
			);
		}
	);
}

export async function captureEventLog(
	instant: Instant,
	kind: EventLogKind,
	message: string,
	options: { heatId?: Id | null; incidentId?: Id | null } = {}
): Promise<boolean> {
	const ctx = app.writeContext;
	return saveQueue.submit(`Log — ${message.slice(0, 40)}`, instant.epoch, async () => {
		await createRecord<EventLogEntry>(
			'eventLog',
			({ id, at, sequence }) => ({
				id,
				createdAt: at,
				updatedAt: at,
				voided: false,
				eventId: ctx.eventId,
				sessionId: app.sessionId as Id,
				heatId: options.heatId ?? app.heatId,
				kind,
				message,
				captureTime: instant.epoch,
				reportedTime: null,
				effectiveTime: instant.epoch,
				captureOffsetMinutes: utcOffsetMinutes(instant.epoch),
				sequence,
				incidentId: options.incidentId ?? null
			}),
			ctx
		);
	});
}
