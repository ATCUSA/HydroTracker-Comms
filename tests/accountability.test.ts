import { describe, expect, it } from 'vitest';
import { buildAccountability, copyLineup } from '../src/lib/domain/accountability';
import { legTemplatesFor } from '../src/lib/domain/legs';
import { checkpoint, heat, leg, observation, participant, racer } from './factories';

const racers = [racer('r1', '007', 'A'), racer('r2', '12', 'A'), racer('r3', '4B', 'B')];
const participants = [
	participant('p1', 'r1', 1),
	participant('p2', 'r2', 2),
	participant('p3', 'r3', 3)
];
const legs = [leg('l1', 1), leg('l2', 2)];

function build(observations = [] as ReturnType<typeof observation>[], overrides = {}) {
	return buildAccountability({
		heat: heat(),
		legs,
		participants,
		racers,
		observations,
		checkpoints: [],
		...overrides
	});
}

describe('accountability derivation', () => {
	it('marks unobserved racers as not observed, not as missing', () => {
		const result = build();
		expect(result.rows).toHaveLength(3);
		expect(result.rows[0].passes[0].state).toBe('not-observed');
		expect(result.summary.observedHereCount).toBe(0);
		expect(result.summary.unobservedHereCount).toBe(3);
	});

	it('marks a direct pass as directly observed', () => {
		const result = build([observation('o1', { participantId: 'p1', legId: 'l1' })]);
		expect(result.rows[0].passes[0].state).toBe('directly-observed');
		expect(result.summary.observedHereCount).toBe(1);
	});

	it('keeps every legitimate repeated pass instead of collapsing them', () => {
		const result = build([
			observation('o1', { participantId: 'p1', legId: 'l1', captureTime: 1000 }),
			observation('o2', { participantId: 'p1', legId: 'l1', captureTime: 2000 })
		]);
		expect(result.rows[0].passes[0].observations).toHaveLength(2);
		expect(result.rows[0].passes[0].firstTime).toBe(1000);
	});

	it('distinguishes a radio-confirmed checkpoint report from a direct pass', () => {
		const cps = [checkpoint('c1', 'CP1', true)];
		const result = build(
			[
				observation('o1', {
					type: 'checkpoint-pass',
					source: 'radio',
					participantId: 'p1',
					reportingCheckpointId: 'c1'
				})
			],
			{ checkpoints: cps }
		);
		expect(result.rows[0].checkpointReports[0].state).toBe('radio-confirmed');
	});

	it('treats silence from a non-reporting checkpoint as not expected, not missing', () => {
		const cps = [checkpoint('c1', 'Landing', false)];
		const result = build([], { checkpoints: cps });
		expect(result.rows[0].checkpointReports[0].state).toBe('not-expected');
	});

	it('still expects a report from a checkpoint that normally calls passages', () => {
		const cps = [checkpoint('c1', 'CP1', true)];
		const result = build([], { checkpoints: cps });
		expect(result.rows[0].checkpointReports[0].state).toBe('not-observed');
	});

	it('does not imply a finish from a local passage', () => {
		const result = build([observation('o1', { participantId: 'p1', legId: 'l2' })]);
		expect(result.rows[0].passes[1].state).toBe('directly-observed');
		expect(result.rows[0].finish.state).toBe('not-observed');
		expect(result.summary.finishHeardCount).toBe(0);
	});

	it('records a finish only when the finish announcement was heard', () => {
		const result = build([observation('o1', { type: 'finish', participantId: 'p1' })]);
		expect(result.rows[0].finish.state).toBe('radio-confirmed');
		expect(result.summary.finishHeardCount).toBe(1);
	});

	it('marks a scratched racer not applicable rather than unobserved', () => {
		const result = build([], {
			participants: [
				participant('p1', 'r1', 1, { participation: 'scratched' }),
				participant('p2', 'r2', 2)
			]
		});
		expect(result.rows[0].passes[0].state).toBe('not-applicable');
		expect(result.summary.expectedCount).toBe(1);
		expect(result.summary.scratchedCount).toBe(1);
	});

	it('counts a DNF racer as still expected on course', () => {
		const result = build([], {
			participants: [participant('p1', 'r1', 1, { participation: 'dnf' })]
		});
		expect(result.summary.dnfCount).toBe(1);
		expect(result.summary.expectedCount).toBe(1);
	});

	it('surfaces unassigned observations rather than guessing a boat', () => {
		const result = build([observation('o1', { participantId: null })]);
		expect(result.unassigned).toHaveLength(1);
		expect(result.summary.observedHereCount).toBe(0);
	});

	it('excludes voided observations from every cell', () => {
		const result = build([observation('o1', { participantId: 'p1', legId: 'l1', voided: true })]);
		expect(result.rows[0].passes[0].state).toBe('not-observed');
	});

	it('flags an uncertain identification on the cell', () => {
		const result = build([
			observation('o1', { participantId: 'p1', legId: 'l1', uncertainIdentification: true })
		]);
		expect(result.rows[0].passes[0].uncertain).toBe(true);
	});

	it('tracks sweep progress per leg and direction', () => {
		const result = build([
			observation('s1', { type: 'sweep', legId: 'l1', captureTime: 5000 }),
			observation('s2', { type: 'sweep', legId: 'l2', captureTime: 6000 })
		]);
		expect(result.summary.sweep.map((s) => s.observed)).toEqual([true, true]);
		expect(result.summary.sweep[0].time).toBe(5000);
		expect(result.summary.sweepComplete).toBe(true);
	});

	it('does not treat a partial sweep as complete', () => {
		const result = build([observation('s1', { type: 'sweep', legId: 'l1' })]);
		expect(result.summary.sweepComplete).toBe(false);
	});

	it('leaves the heat-complete call out of racer accountability', () => {
		const result = build([observation('hc', { type: 'heat-complete' })]);
		expect(result.summary.finishHeardCount).toBe(0);
		expect(result.unassigned).toHaveLength(0);
		expect(result.rows.every((r) => r.finish.state === 'not-observed')).toBe(true);
	});

	it('orders rows by starting order', () => {
		const result = build([], {
			participants: [participant('p1', 'r1', 3), participant('p2', 'r2', 1)]
		});
		expect(result.rows.map((r) => r.boatNumber)).toEqual(['12', '007']);
	});
});

describe('leg formats', () => {
	it('gives a continuous down-and-back exactly one start and one finish', () => {
		const templates = legTemplatesFor('continuous-down-and-back');
		expect(templates).toHaveLength(2);
		expect(templates.filter((t) => t.hasStart)).toHaveLength(1);
		expect(templates.filter((t) => t.hasFinish)).toHaveLength(1);
		expect(templates[0].direction).toBe('downstream');
		expect(templates[1].direction).toBe('upstream');
	});

	it('gives separate legs their own start and finish', () => {
		const templates = legTemplatesFor('separate-legs', 3);
		expect(templates).toHaveLength(3);
		expect(templates.every((t) => t.hasStart && t.hasFinish)).toBe(true);
	});

	it('gives a one-way run a single leg', () => {
		expect(legTemplatesFor('one-way')).toHaveLength(1);
	});
});

describe('copying a lineup', () => {
	const source = [
		participant('p1', 'r1', 1, { participation: 'dnf', participationNote: 'mechanical' }),
		participant('p2', 'r2', 2, { participation: 'entered', className: 'A' }),
		participant('p3', 'r3', 3, { participation: 'scratched' })
	];

	it('carries only boats, order and class', () => {
		const copies = copyLineup(source, 'h2');
		expect(copies).toEqual([
			{ heatId: 'h2', racerId: 'r1', startOrder: 1, className: '' },
			{ heatId: 'h2', racerId: 'r2', startOrder: 2, className: 'A' },
			{ heatId: 'h2', racerId: 'r3', startOrder: 3, className: '' }
		]);
	});

	it('never carries a previous DNF, scratch or note', () => {
		const copies = copyLineup(source, 'h2');
		for (const copy of copies) {
			expect(copy).not.toHaveProperty('participation');
			expect(copy).not.toHaveProperty('participationNote');
		}
	});

	it('lets a previous DNF race again and a finisher sit out', () => {
		const copies = copyLineup(source, 'h2');
		// The DNF boat is present and starts as a normal entry.
		expect(copies.some((c) => c.racerId === 'r1')).toBe(true);
		// Excluding a boat is just not adding it; the roster is untouched.
		const withoutR2 = copies.filter((c) => c.racerId !== 'r2');
		expect(withoutR2.map((c) => c.racerId)).toEqual(['r1', 'r3']);
	});

	it('renumbers the order contiguously and skips voided entries', () => {
		const copies = copyLineup(
			[participant('p1', 'r1', 5), participant('p2', 'r2', 9, { voided: true })],
			'h2'
		);
		expect(copies).toEqual([{ heatId: 'h2', racerId: 'r1', startOrder: 1, className: '' }]);
	});
});
