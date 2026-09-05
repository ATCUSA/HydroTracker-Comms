import { getDb } from '$lib/db/db';
import { createRecord, saveRecord, voidRecord } from '$lib/db/repo';
import { nowMs, utcOffsetMinutes, type Instant } from '$lib/time/clock';
import type { Id, Incident, IncidentAction, RecordedLocation } from '$lib/domain/types';
import { app } from '$lib/stores/app.svelte';
import { saveQueue } from '$lib/stores/saveQueue.svelte';
import { geoWatcher } from './geolocation.svelte';

/**
 * Emergency activation writes the incident marker immediately. It does not wait
 * for a GPS permission prompt, a fix, or a single filled field — every incident
 * field is optional and can be completed while the incident is open.
 */
export async function activateEmergency(instant: Instant): Promise<Incident | null> {
	const ctx = app.writeContext;
	if (!ctx.eventId || !app.sessionId) {
		throw new Error('Start an event and station session before recording an incident.');
	}
	const checkpoint = app.session?.checkpointLocation ?? null;
	const checkpointLocation: RecordedLocation | null = checkpoint
		? {
				source: 'checkpoint-estimate',
				latitude: checkpoint.latitude,
				longitude: checkpoint.longitude,
				accuracyMeters: checkpoint.accuracyMeters ?? null,
				fixTime: checkpoint.fixTime ?? null,
				capturedAt: instant.epoch
			}
		: null;

	// Whatever fix already exists is kept as provenance. Absence is recorded as
	// pending rather than filled in with a guess.
	const initialDeviceFix = geoWatcher.snapshot(instant.epoch);

	let created: Incident | null = null;
	const ok = await saveQueue.submit('Emergency marker', instant.epoch, async () => {
		created = await createRecord<Incident>(
			'incidents',
			({ id, at, sequence }) => ({
				id,
				createdAt: at,
				updatedAt: at,
				voided: false,
				eventId: ctx.eventId,
				sessionId: app.sessionId as Id,
				heatId: app.heatId,
				status: 'open',
				incidentType: '',
				severity: '',
				boatNumbers: [],
				locationNotes: '',
				riverSide: '',
				hazards: '',
				peopleInvolved: '',
				reportedInjuries: '',
				resources: '',
				notificationsMade: '',
				followUp: '',
				resolution: '',
				captureTime: instant.epoch,
				effectiveTime: instant.epoch,
				captureOffsetMinutes: utcOffsetMinutes(instant.epoch),
				sequence,
				resolvedAt: null,
				incidentLocation: checkpointLocation ?? {
					source: 'pending',
					capturedAt: instant.epoch
				},
				initialDeviceFix,
				checkpointLocation
			}),
			ctx
		);
	});
	return ok ? created : null;
}

export async function updateIncident(incident: Incident, reason = 'Incident details updated') {
	return saveQueue.submit('Incident update', nowMs(), async () => {
		await saveRecord('incidents', incident, { ...app.writeContext, reason });
	});
}

/**
 * Explicitly sets the incident position. Live device movement never moves it:
 * only this call does, and each change is a revision with source and time.
 */
export async function setIncidentLocation(
	incident: Incident,
	location: RecordedLocation,
	reason: string
): Promise<boolean> {
	return saveQueue.submit('Incident location', location.capturedAt, async () => {
		const db = getDb();
		const fresh = (await db.incidents.get(incident.id)) ?? incident;
		await saveRecord(
			'incidents',
			{ ...fresh, incidentLocation: location },
			{ ...app.writeContext, reason }
		);
	});
}

export async function addIncidentAction(
	instant: Instant,
	incidentId: Id,
	text: string
): Promise<boolean> {
	const ctx = app.writeContext;
	return saveQueue.submit(`Action — ${text.slice(0, 40)}`, instant.epoch, async () => {
		await createRecord<IncidentAction>(
			'incidentActions',
			({ id, at, sequence }) => ({
				id,
				createdAt: at,
				updatedAt: at,
				voided: false,
				incidentId,
				eventId: ctx.eventId,
				sessionId: app.sessionId as Id,
				text,
				captureTime: instant.epoch,
				reportedTime: null,
				effectiveTime: instant.epoch,
				captureOffsetMinutes: utcOffsetMinutes(instant.epoch),
				sequence
			}),
			ctx
		);
	});
}

export async function resolveIncident(incident: Incident, resolution: string) {
	return saveQueue.submit('Incident resolved', nowMs(), async () => {
		await saveRecord(
			'incidents',
			{ ...incident, status: 'resolved', resolvedAt: nowMs(), resolution },
			{ ...app.writeContext, reason: 'Incident marked resolved' }
		);
	});
}

export async function reopenIncident(incident: Incident) {
	return saveQueue.submit('Incident reopened', nowMs(), async () => {
		await saveRecord(
			'incidents',
			{ ...incident, status: 'open', resolvedAt: null },
			{ ...app.writeContext, reason: 'Incident reopened' }
		);
	});
}

export async function voidIncident(incidentId: Id, reason: string) {
	return saveQueue.submit('Void incident', nowMs(), async () => {
		await voidRecord('incidents', incidentId, { ...app.writeContext, reason });
	});
}
