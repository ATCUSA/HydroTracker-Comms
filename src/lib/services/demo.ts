import { getDb } from '$lib/db/db';
import { beginCapture } from './capture';
import { writeObservation } from './capture';
import {
	addCheckpoint,
	addParticipant,
	addRacer,
	createEvent,
	createHeat,
	setParticipation,
	startSession
} from './setup';
import { app } from '$lib/stores/app.svelte';
import { nowMs } from '$lib/time/clock';

export const DEMO_EVENT_NAME = 'DEMO RACE — not a real log';

/**
 * Builds a self-contained demo event. It is flagged isDemo and named so it can
 * never be confused with a real log, and it is deleted wholesale rather than
 * merged into anything.
 */
export async function createDemoRace(): Promise<string> {
	const event = await createEvent({
		name: DEMO_EVENT_NAME,
		dates: [new Date().toISOString().slice(0, 10)],
		courseNotes:
			'Demonstration data for training and for checking reports. Not an official record.',
		isDemo: true
	});

	const session = await startSession({
		eventId: event.id,
		checkpointName: 'Demo Checkpoint 2',
		safetyBoatNumber: 'SB-2',
		operatorName: 'Demo Operator',
		callSign: 'Safety Two',
		channel: '72',
		checkpointLocation: {
			latitude: 45.5234,
			longitude: -122.6762,
			accuracyMeters: 12,
			fixTime: nowMs()
		}
	});

	await app.setEvent(event.id);
	await app.setSession(session.id);

	const cp1 = await addCheckpoint(event.id, 'Demo Checkpoint 1', true, 'Upstream of this station');
	await addCheckpoint(event.id, 'Demo Checkpoint 3', true, 'Downstream of this station');
	await addCheckpoint(
		event.id,
		'Demo Landing (silent)',
		false,
		'Staffed but does not call passages on the radio'
	);

	const boats = [
		{ n: '007', c: 'A' },
		{ n: '12', c: 'A' },
		{ n: '4B', c: 'B' },
		{ n: '31', c: 'B' },
		{ n: '88', c: 'A' }
	];
	const racers = [];
	for (const b of boats) racers.push(await addRacer(event.id, b.n, b.c));

	const heat1 = await createHeat({
		eventId: event.id,
		name: 'Demo Heat 1',
		legFormat: 'continuous-down-and-back',
		startMode: 'individual'
	});
	for (const [i, racer] of racers.entries()) {
		await addParticipant(event.id, heat1.id, racer.id, i + 1, racer.className);
	}
	await app.setHeat(heat1.id);

	const db = getDb();
	const legs = await db.legs.where('heatId').equals(heat1.id).sortBy('sortIndex');
	const parts = await db.participants.where('heatId').equals(heat1.id).sortBy('startOrder');

	// A short, plausible sequence: starts, outbound passes, one DNF, a return
	// pass, one finish heard, and a sweep. Deliberately incomplete so the
	// accountability screen has something real to show.
	let t = nowMs() - 25 * 60_000;
	const step = async (ms: number) => {
		t += ms;
		return { epoch: t, monotonic: t };
	};

	for (const p of parts) {
		await writeObservation(await step(20_000), {
			type: 'start',
			participantId: p.id,
			heatId: heat1.id,
			legId: legs[0]?.id
		});
	}
	for (const p of parts.slice(0, 4)) {
		await writeObservation(await step(35_000), {
			type: 'pass',
			participantId: p.id,
			heatId: heat1.id,
			legId: legs[0]?.id,
			direction: 'downstream'
		});
	}
	await writeObservation(await step(40_000), {
		type: 'checkpoint-pass',
		source: 'radio',
		participantId: parts[0].id,
		heatId: heat1.id,
		reportingCheckpointId: cp1.id,
		checkpointName: 'Demo Checkpoint 1'
	});
	await setParticipation(event.id, parts[3], 'dnf', 'Demo: reported mechanical, towed to the ramp');
	for (const p of parts.slice(0, 3)) {
		await writeObservation(await step(50_000), {
			type: 'pass',
			participantId: p.id,
			heatId: heat1.id,
			legId: legs[1]?.id,
			direction: 'upstream'
		});
	}
	await writeObservation(await step(30_000), {
		type: 'finish',
		source: 'radio',
		participantId: parts[0].id,
		heatId: heat1.id,
		legId: legs[1]?.id
	});
	await writeObservation(await step(60_000), {
		type: 'sweep',
		heatId: heat1.id,
		legId: legs[1]?.id,
		direction: 'upstream'
	});

	// Heat 2 copies the lineup by hand so the demo shows a DNF boat racing again
	// and a finisher sitting out — with no prior outcomes carried over.
	const heat2 = await createHeat({
		eventId: event.id,
		name: 'Demo Heat 2',
		legFormat: 'one-way',
		startMode: 'mass'
	});
	const secondLineup = [racers[3], racers[1], racers[2], racers[4]];
	for (const [i, racer] of secondLineup.entries()) {
		await addParticipant(event.id, heat2.id, racer.id, i + 1, racer.className);
	}

	return event.id;
}

/** Removes the demo event and everything that belongs to it. */
export async function deleteDemoRace(eventId: string): Promise<void> {
	const db = getDb();
	await db.transaction(
		'rw',
		[
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
		],
		async () => {
			const heats = await db.heats.where('eventId').equals(eventId).toArray();
			const heatIds = heats.map((h) => h.id);
			await db.legs.where('heatId').anyOf(heatIds).delete();
			await db.participants.where('heatId').anyOf(heatIds).delete();
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
					.equals(eventId)
					.delete();
			}
			await db.events.delete(eventId);
		}
	);
}
