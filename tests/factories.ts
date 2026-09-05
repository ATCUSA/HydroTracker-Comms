import type {
	Heat,
	HeatParticipant,
	Leg,
	Observation,
	Racer,
	ReportingCheckpoint
} from '../src/lib/domain/types';

let seq = 0;
export function nextSeq(): number {
	seq += 1;
	return seq;
}

const base = (id: string) => ({ id, createdAt: 0, updatedAt: 0, voided: false });

export function racer(id: string, boatNumber: string, className = ''): Racer {
	return { ...base(id), eventId: 'ev1', boatNumber, className, notes: '' };
}

export function heat(id = 'h1', overrides: Partial<Heat> = {}): Heat {
	return {
		...base(id),
		eventId: 'ev1',
		name: 'Heat 1',
		legFormat: 'continuous-down-and-back',
		startMode: 'individual',
		sortIndex: 1,
		closedAt: null,
		closedBy: null,
		notes: '',
		...overrides
	};
}

export function leg(id: string, sortIndex: number, overrides: Partial<Leg> = {}): Leg {
	return {
		...base(id),
		heatId: 'h1',
		name: `Leg ${sortIndex}`,
		sortIndex,
		direction: sortIndex % 2 === 1 ? 'downstream' : 'upstream',
		hasStart: sortIndex === 1,
		hasFinish: true,
		...overrides
	};
}

export function participant(
	id: string,
	racerId: string,
	startOrder: number,
	overrides: Partial<HeatParticipant> = {}
): HeatParticipant {
	return {
		...base(id),
		heatId: 'h1',
		racerId,
		startOrder,
		participation: 'entered',
		participationNote: '',
		className: '',
		...overrides
	};
}

export function checkpoint(id: string, name: string, expectedToReport = true): ReportingCheckpoint {
	return { ...base(id), eventId: 'ev1', name, expectedToReport, sortIndex: 1, notes: '' };
}

export function observation(id: string, overrides: Partial<Observation> = {}): Observation {
	const captureTime = overrides.captureTime ?? 1_000_000;
	return {
		...base(id),
		eventId: 'ev1',
		sessionId: 'ses1',
		deviceId: 'dev1',
		operatorName: 'Operator',
		heatId: 'h1',
		legId: null,
		participantId: null,
		unassignedBoatText: null,
		type: 'pass',
		source: 'direct',
		checkpointName: 'CP2',
		reportingCheckpointId: null,
		captureTime,
		receivedTime: null,
		reportedTime: null,
		effectiveTime: overrides.effectiveTime ?? captureTime,
		captureOffsetMinutes: 0,
		sequence: overrides.sequence ?? nextSeq(),
		direction: 'downstream',
		notes: '',
		uncertainIdentification: false,
		groupActionId: null,
		reviewAcknowledgedAt: null,
		...overrides
	};
}
