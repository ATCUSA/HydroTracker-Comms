import { describe, expect, it } from 'vitest';
import { buildTimeline, filterTimeline } from '../src/lib/domain/timeline';
import { buildReviewPrompts } from '../src/lib/domain/review';
import { buildAccountability } from '../src/lib/domain/accountability';
import { checkpoint, heat, leg, observation, participant, racer } from './factories';
import type { Incident, RadioMessage } from '../src/lib/domain/types';

function timelineOf(observations: ReturnType<typeof observation>[], extra = {}) {
	return buildTimeline({
		observations,
		radio: [],
		eventLog: [],
		incidents: [],
		incidentActions: [],
		heats: [],
		boatNumberFor: (id) => (id === 'p1' ? '007' : null),
		...extra
	});
}

describe('timeline ordering', () => {
	it('orders by effective time', () => {
		const entries = timelineOf([
			observation('o2', { captureTime: 2000, sequence: 2 }),
			observation('o1', { captureTime: 1000, sequence: 1 })
		]);
		expect(entries.map((e) => e.id)).toEqual(['o1', 'o2']);
	});

	it('breaks ties on the durable capture sequence', () => {
		const entries = timelineOf([
			observation('b', { captureTime: 1000, sequence: 9 }),
			observation('a', { captureTime: 1000, sequence: 4 })
		]);
		expect(entries.map((e) => e.id)).toEqual(['a', 'b']);
	});

	it('reorders on a corrected time while keeping the capture order visible', () => {
		const entries = timelineOf([
			observation('first', { captureTime: 1000, sequence: 1, effectiveTime: 5000 }),
			observation('second', { captureTime: 2000, sequence: 2 })
		]);
		expect(entries.map((e) => e.id)).toEqual(['second', 'first']);
		const corrected = entries.find((e) => e.id === 'first');
		expect(corrected?.captureTime).toBe(1000);
		expect(corrected?.sequence).toBe(1);
	});
});

describe('timeline content', () => {
	it('merges radio, events and incidents alongside observations', () => {
		const radio: RadioMessage[] = [
			{
				id: 'rad1',
				createdAt: 0,
				updatedAt: 0,
				voided: false,
				eventId: 'ev1',
				sessionId: 'ses1',
				heatId: null,
				direction: 'received',
				fromParty: 'Race control',
				toParty: '',
				channel: '72',
				boatNumbers: ['12'],
				message: 'Hold the course',
				priority: 'priority',
				acknowledged: false,
				followUpRequired: true,
				captureTime: 1500,
				receivedTime: 1500,
				reportedTime: null,
				effectiveTime: 1500,
				captureOffsetMinutes: 0,
				sequence: 3,
				incidentId: null
			}
		];
		const entries = timelineOf([observation('o1', { captureTime: 1000 })], { radio });
		expect(entries.map((e) => e.kind)).toEqual(['observation', 'radio']);
		expect(entries[1].title).toContain('Race control');
		expect(entries[1].needsReview).toBe(true);
	});

	it('allows a general radio message with no heat', () => {
		const entries = timelineOf([], {
			radio: [
				{
					id: 'rad1',
					createdAt: 0,
					updatedAt: 0,
					voided: false,
					eventId: 'ev1',
					sessionId: 'ses1',
					heatId: null,
					direction: 'sent',
					fromParty: '',
					toParty: 'Race control',
					channel: '',
					boatNumbers: [],
					message: 'Radio check',
					priority: 'routine',
					acknowledged: true,
					followUpRequired: false,
					captureTime: 1,
					receivedTime: null,
					reportedTime: null,
					effectiveTime: 1,
					captureOffsetMinutes: 0,
					sequence: 1,
					incidentId: null
				}
			]
		});
		expect(entries).toHaveLength(1);
		expect(entries[0].heatId).toBeNull();
	});

	it('shows a heat close as its own entry that creates no observation', () => {
		const entries = timelineOf([], { heats: [heat('h1', { closedAt: 9000, closedBy: 'Op' })] });
		expect(entries).toHaveLength(1);
		expect(entries[0].kind).toBe('heat-transition');
		expect(entries[0].detail).toMatch(/No observations were created/);
	});

	it('keeps received time separate from a later reported occurrence time', () => {
		const entries = timelineOf([
			observation('o1', {
				type: 'checkpoint-pass',
				source: 'radio',
				captureTime: 5000,
				receivedTime: 5000,
				reportedTime: 4000
			})
		]);
		expect(entries[0].receivedTime).toBe(5000);
		expect(entries[0].reportedTime).toBe(4000);
		expect(entries[0].captureTime).toBe(5000);
	});

	it('marks an entry linked to an open incident as unresolved', () => {
		const incident: Incident = {
			id: 'i1',
			createdAt: 0,
			updatedAt: 0,
			voided: false,
			eventId: 'ev1',
			sessionId: 'ses1',
			heatId: null,
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
			captureTime: 100,
			effectiveTime: 100,
			captureOffsetMinutes: 0,
			sequence: 1,
			resolvedAt: null,
			incidentLocation: null,
			initialDeviceFix: null,
			checkpointLocation: null
		};
		const entries = timelineOf([], { incidents: [incident] });
		expect(entries[0].unresolvedIncident).toBe(true);
	});
});

describe('timeline filters', () => {
	const entries = timelineOf([
		observation('o1', { participantId: 'p1', captureTime: 1000 }),
		observation('o2', { participantId: null, captureTime: 2000, checkpointName: 'CP9' }),
		observation('o3', { captureTime: 3000, voided: true })
	]);

	it('hides voided records unless asked for', () => {
		expect(filterTimeline(entries, {}).map((e) => e.id)).toEqual(['o1', 'o2']);
		expect(filterTimeline(entries, { includeVoided: true })).toHaveLength(3);
	});

	it('filters by boat, checkpoint and type', () => {
		expect(filterTimeline(entries, { boatNumber: '007' }).map((e) => e.id)).toEqual(['o1']);
		expect(filterTimeline(entries, { checkpointName: 'CP9' }).map((e) => e.id)).toEqual(['o2']);
		expect(filterTimeline(entries, { kinds: ['radio'] })).toHaveLength(0);
	});

	it('filters to records that need review', () => {
		expect(filterTimeline(entries, { needsReviewOnly: true }).map((e) => e.id)).toEqual(['o2']);
	});
});

describe('review prompts', () => {
	const legs = [leg('l1', 1), leg('l2', 2)];
	const racers = [racer('r1', '007'), racer('r2', '12')];
	const participants = [participant('p1', 'r1', 1), participant('p2', 'r2', 2)];

	function accOf(observations: ReturnType<typeof observation>[], checkpoints = []) {
		return buildAccountability({
			heat: heat(),
			legs,
			participants,
			racers,
			observations,
			checkpoints
		});
	}

	it('prompts about unassigned captures', () => {
		const prompts = buildReviewPrompts({
			legs,
			observations: [observation('o1', { participantId: null })],
			now: 0
		});
		expect(prompts.some((p) => p.title.includes('unassigned'))).toBe(true);
	});

	it('surfaces a repeated pass without suppressing either record', () => {
		const observations = [
			observation('o1', { participantId: 'p1', legId: 'l1', captureTime: 1000 }),
			observation('o2', { participantId: 'p1', legId: 'l1', captureTime: 2000 })
		];
		const prompts = buildReviewPrompts({ legs, observations, now: 3000 });
		expect(prompts.some((p) => p.title.includes('Repeated pass'))).toBe(true);
		expect(accOf(observations).rows[0].passes[0].observations).toHaveLength(2);
	});

	it('flags an observation whose corrected time is out of capture order', () => {
		const prompts = buildReviewPrompts({
			legs,
			observations: [
				observation('o1', { captureTime: 1000, sequence: 1, participantId: 'p1' }),
				observation('o2', {
					captureTime: 2000,
					sequence: 2,
					effectiveTime: 500,
					participantId: 'p2'
				})
			],
			now: 3000
		});
		expect(prompts.some((p) => p.title.includes('out of capture order'))).toBe(true);
	});

	it('raises no overdue prompt when no threshold is configured', () => {
		const observations = [
			observation('s1', { type: 'start', participantId: 'p1', captureTime: 0 })
		];
		const prompts = buildReviewPrompts({
			legs,
			observations,
			accountability: accOf(observations),
			now: 60 * 60_000,
			overdueThresholdMs: null
		});
		expect(prompts.some((p) => p.key.startsWith('unobserved:'))).toBe(false);
	});

	it('raises an overdue prompt only once a threshold is configured', () => {
		const observations = [
			observation('s1', { type: 'start', participantId: 'p1', captureTime: 0 })
		];
		const prompts = buildReviewPrompts({
			legs,
			observations,
			accountability: accOf(observations),
			now: 20 * 60_000,
			overdueThresholdMs: 10 * 60_000
		});
		const overdue = prompts.find((p) => p.key === 'unobserved:p1');
		expect(overdue).toBeDefined();
		expect(overdue?.detail).toMatch(/prompt to look, not a conclusion/);
	});

	it('never infers a missing racer from starting order alone', () => {
		// Boat 2 passed, boat 1 did not. With no start heard and no threshold,
		// nothing may conclude that boat 1 is missing.
		const observations = [observation('o1', { participantId: 'p2', legId: 'l1' })];
		const prompts = buildReviewPrompts({
			legs,
			observations,
			accountability: accOf(observations),
			now: 10 * 60_000,
			overdueThresholdMs: 60_000
		});
		expect(prompts.some((p) => p.key === 'unobserved:p1')).toBe(false);
	});

	it('prompts when the sweep has passed with unresolved accountability', () => {
		const observations = [
			observation('s1', { type: 'sweep', legId: 'l1' }),
			observation('s2', { type: 'sweep', legId: 'l2' })
		];
		const prompts = buildReviewPrompts({
			legs,
			observations,
			accountability: accOf(observations),
			now: 0
		});
		expect(prompts.some((p) => p.title.includes('Sweep passed'))).toBe(true);
	});

	it('does not prompt about a checkpoint that never reports', () => {
		const cps = [checkpoint('c1', 'Landing', false)];
		const observations: ReturnType<typeof observation>[] = [];
		const prompts = buildReviewPrompts({
			legs,
			observations,
			accountability: buildAccountability({
				heat: heat(),
				legs,
				participants,
				racers,
				observations,
				checkpoints: cps
			}),
			now: 60 * 60_000,
			overdueThresholdMs: 60_000
		});
		expect(prompts.some((p) => p.detail.toLowerCase().includes('landing'))).toBe(false);
	});

	it('reports a clock jump without claiming records were changed', () => {
		const prompts = buildReviewPrompts({ legs, observations: [], now: 0, clockDriftMs: 65_000 });
		const drift = prompts.find((p) => p.title.includes('clock changed'));
		expect(drift?.detail).toMatch(/Existing records were not altered/);
	});

	it('flags a stale GPS fix only while the watch is running', () => {
		const base = { legs, observations: [], now: 200_000, staleGpsFixTime: 0 };
		expect(buildReviewPrompts({ ...base, gpsWatchActive: false })).toHaveLength(0);
		expect(
			buildReviewPrompts({ ...base, gpsWatchActive: true }).some((p) => p.title.includes('stale'))
		).toBe(true);
	});
});
