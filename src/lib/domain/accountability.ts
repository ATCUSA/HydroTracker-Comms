import type {
	Direction,
	EpochMs,
	Heat,
	HeatParticipant,
	Id,
	Leg,
	Observation,
	Racer,
	ReportingCheckpoint
} from './types';

/**
 * Accountability is derived, never stored. Counts and states below are
 * recomputed from observations plus the heat's participation decisions, so
 * there is exactly one source of truth.
 *
 * The four cell states exist because "nothing recorded" means different things
 * in different places: a silent checkpoint that never reports is not the same
 * as a boat nobody has seen.
 */
export type CellState =
	/** Expected, and nothing has been recorded. */
	| 'not-observed'
	/** This checkpoint is not expected to call passages, so silence means nothing. */
	| 'not-expected'
	/** Another station reported it over the radio. */
	| 'radio-confirmed'
	/** This operator saw it from this checkpoint. */
	| 'directly-observed'
	/** Not applicable to this racer, e.g. scratched before the start. */
	| 'not-applicable';

export const CELL_STATE_LABELS: Record<CellState, string> = {
	'not-observed': 'Not observed',
	'not-expected': 'Not expected to report',
	'radio-confirmed': 'Confirmed by radio',
	'directly-observed': 'Directly observed',
	'not-applicable': 'Not applicable'
};

export interface AccountabilityCell {
	state: CellState;
	/** Every matching observation. Legitimate repeats are all kept. */
	observations: Observation[];
	/** Effective time of the first matching observation, if any. */
	firstTime: EpochMs | null;
	uncertain: boolean;
}

export interface LegPassCell extends AccountabilityCell {
	legId: Id;
	legName: string;
	direction: Direction;
}

export interface AccountabilityRow {
	participant: HeatParticipant;
	racer: Racer | undefined;
	boatNumber: string;
	className: string;
	startOrder: number;
	start: AccountabilityCell;
	passes: LegPassCell[];
	checkpointReports: Array<AccountabilityCell & { checkpoint: ReportingCheckpoint }>;
	finish: AccountabilityCell;
	notes: string;
}

export interface SweepProgress {
	legId: Id;
	legName: string;
	direction: Direction;
	observed: boolean;
	time: EpochMs | null;
}

export interface AccountabilitySummary {
	/** Participants still on the lineup (not scratched or DNS). */
	expectedCount: number;
	/** Of those, how many have at least one direct pass at this checkpoint. */
	observedHereCount: number;
	unobservedHereCount: number;
	finishHeardCount: number;
	dnfCount: number;
	scratchedCount: number;
	sweep: SweepProgress[];
	/** True when at least one sweep observation exists for every expected leg. */
	sweepComplete: boolean;
}

export interface AccountabilityInput {
	heat: Heat;
	legs: Leg[];
	participants: HeatParticipant[];
	racers: Racer[];
	observations: Observation[];
	checkpoints: ReportingCheckpoint[];
}

export interface AccountabilityResult {
	rows: AccountabilityRow[];
	summary: AccountabilitySummary;
	/** Observations in this heat still without a racer. */
	unassigned: Observation[];
}

function emptyCell(state: CellState = 'not-observed'): AccountabilityCell {
	return { state, observations: [], firstTime: null, uncertain: false };
}

function fill(
	cell: AccountabilityCell,
	matches: Observation[],
	observedState: CellState
): AccountabilityCell {
	if (matches.length === 0) return cell;
	const sorted = [...matches].sort((a, b) => a.effectiveTime - b.effectiveTime);
	return {
		state: observedState,
		observations: sorted,
		firstTime: sorted[0].effectiveTime,
		uncertain: sorted.some((o) => o.uncertainIdentification)
	};
}

/** Participation states that mean the boat is not expected on course. */
const NOT_RACING = new Set(['scratched', 'dns']);

export function buildAccountability(input: AccountabilityInput): AccountabilityResult {
	const { heat, participants, racers, checkpoints } = input;
	const legs = [...input.legs].sort((a, b) => a.sortIndex - b.sortIndex);
	const racerById = new Map(racers.map((r) => [r.id, r]));

	const live = input.observations.filter((o) => !o.voided && o.heatId === heat.id);
	const byParticipant = new Map<Id, Observation[]>();
	const unassigned: Observation[] = [];
	for (const o of live) {
		if (o.type === 'sweep' || o.type === 'heat-complete') continue;
		if (o.participantId) {
			const list = byParticipant.get(o.participantId) ?? [];
			list.push(o);
			byParticipant.set(o.participantId, list);
		} else {
			unassigned.push(o);
		}
	}

	const expectedCheckpoints = checkpoints.filter((c) => !c.voided);

	const rows: AccountabilityRow[] = [...participants]
		.filter((p) => !p.voided)
		.sort((a, b) => a.startOrder - b.startOrder)
		.map((participant) => {
			const mine = byParticipant.get(participant.id) ?? [];
			const racer = racerById.get(participant.racerId);
			const racing = !NOT_RACING.has(participant.participation);

			const start = racing
				? fill(
						emptyCell(),
						mine.filter((o) => o.type === 'start'),
						'directly-observed'
					)
				: emptyCell('not-applicable');

			const passes: LegPassCell[] = legs.map((leg) => {
				const matches = mine.filter((o) => o.type === 'pass' && o.legId === leg.id);
				const base = racing ? emptyCell() : emptyCell('not-applicable');
				const cell = fill(base, matches, 'directly-observed');
				return { ...cell, legId: leg.id, legName: leg.name, direction: leg.direction };
			});

			const checkpointReports = expectedCheckpoints.map((checkpoint) => {
				const matches = mine.filter(
					(o) => o.type === 'checkpoint-pass' && o.reportingCheckpointId === checkpoint.id
				);
				// Silence at a station that never calls passages is not a gap.
				const base = !racing
					? emptyCell('not-applicable')
					: checkpoint.expectedToReport
						? emptyCell('not-observed')
						: emptyCell('not-expected');
				const cell = fill(base, matches, 'radio-confirmed');
				return { ...cell, checkpoint };
			});

			const finish = racing
				? fill(
						emptyCell(),
						mine.filter((o) => o.type === 'finish'),
						'radio-confirmed'
					)
				: emptyCell('not-applicable');

			return {
				participant,
				racer,
				boatNumber: racer?.boatNumber ?? '(unknown boat)',
				className: participant.className || racer?.className || '',
				startOrder: participant.startOrder,
				start,
				passes,
				checkpointReports,
				finish,
				notes: participant.participationNote
			};
		});

	const sweepObs = live.filter((o) => o.type === 'sweep');
	const sweep: SweepProgress[] = legs.map((leg) => {
		const match = sweepObs
			.filter((o) => o.legId === leg.id)
			.sort((a, b) => a.effectiveTime - b.effectiveTime)[0];
		return {
			legId: leg.id,
			legName: leg.name,
			direction: leg.direction,
			observed: Boolean(match),
			time: match?.effectiveTime ?? null
		};
	});

	const racingRows = rows.filter((r) => !NOT_RACING.has(r.participant.participation));
	const observedHereCount = racingRows.filter((r) =>
		r.passes.some((p) => p.observations.length > 0)
	).length;

	const summary: AccountabilitySummary = {
		expectedCount: racingRows.length,
		observedHereCount,
		unobservedHereCount: racingRows.length - observedHereCount,
		finishHeardCount: racingRows.filter((r) => r.finish.observations.length > 0).length,
		dnfCount: rows.filter((r) => r.participant.participation === 'dnf').length,
		scratchedCount: rows.filter((r) => NOT_RACING.has(r.participant.participation)).length,
		sweep,
		sweepComplete: sweep.length > 0 && sweep.every((s) => s.observed)
	};

	return { rows, summary, unassigned };
}

/**
 * A racer's participation is scoped to one heat, so copying a lineup carries
 * only order and class forward. Results, times, DNF and scratches never travel.
 */
export function copyLineup(
	source: HeatParticipant[],
	targetHeatId: Id
): Array<Pick<HeatParticipant, 'racerId' | 'startOrder' | 'className'> & { heatId: Id }> {
	return [...source]
		.filter((p) => !p.voided)
		.sort((a, b) => a.startOrder - b.startOrder)
		.map((p, index) => ({
			heatId: targetHeatId,
			racerId: p.racerId,
			startOrder: index + 1,
			className: p.className
		}));
}
