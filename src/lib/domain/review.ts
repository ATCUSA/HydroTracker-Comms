import type { AccountabilityResult } from './accountability';
import type { EpochMs, Heat, Leg, Observation } from './types';

/**
 * Review prompts are advisory. They never block capture, never fire an alarm,
 * and never change a record on their own. They also never infer a missing racer
 * from starting order alone: overtaking and mass starts make order a poor
 * proxy for who should have passed.
 */
export type PromptSeverity = 'info' | 'attention';

export interface ReviewPrompt {
	/** Stable across recomputation so a dismissal sticks. */
	key: string;
	severity: PromptSeverity;
	title: string;
	detail: string;
	/** Route the operator to the right screen. */
	target?: { screen: 'live' | 'accountability' | 'timeline' | 'setup'; recordId?: string };
}

export interface ReviewInput {
	heat?: Heat;
	legs: Leg[];
	observations: Observation[];
	accountability?: AccountabilityResult;
	/** Only set when the operator has configured an overdue threshold. */
	overdueThresholdMs?: number | null;
	now: EpochMs;
	staleGpsFixTime?: EpochMs | null;
	gpsWatchActive?: boolean;
	clockDriftMs?: number | null;
}

export function buildReviewPrompts(input: ReviewInput): ReviewPrompt[] {
	const prompts: ReviewPrompt[] = [];
	const live = input.observations.filter((o) => !o.voided);

	const unassigned = live.filter(
		(o) =>
			!o.participantId && !o.unassignedBoatText && o.type !== 'sweep' && o.type !== 'heat-complete'
	);
	if (unassigned.length > 0) {
		prompts.push({
			key: `unassigned:${unassigned.length}:${unassigned[unassigned.length - 1].id}`,
			severity: 'attention',
			title: `${unassigned.length} unassigned record${unassigned.length === 1 ? '' : 's'}`,
			detail: 'Captured with a time but no boat yet. Assign when you have a moment.',
			target: { screen: 'live' }
		});
	}

	// Repeated passes are legitimate; they are surfaced, never suppressed.
	const passCounts = new Map<string, Observation[]>();
	for (const o of live) {
		if (o.type !== 'pass' || !o.participantId) continue;
		const key = `${o.participantId}|${o.legId ?? 'no-leg'}|${o.direction}`;
		const list = passCounts.get(key) ?? [];
		list.push(o);
		passCounts.set(key, list);
	}
	for (const [key, list] of passCounts) {
		if (list.length > 1) {
			prompts.push({
				key: `repeat:${key}:${list.length}`,
				severity: 'info',
				title: 'Repeated pass on the same leg and direction',
				detail: `${list.length} passes recorded. Legitimate repeats are kept — check that none was a mis-tap.`,
				target: { screen: 'timeline', recordId: list[list.length - 1].id }
			});
		}
	}

	// Effective time out of step with capture order, usually after a correction.
	const ordered = [...live].sort((a, b) => a.sequence - b.sequence);
	for (let i = 1; i < ordered.length; i += 1) {
		if (ordered[i].effectiveTime < ordered[i - 1].effectiveTime) {
			prompts.push({
				key: `out-of-order:${ordered[i].id}`,
				severity: 'info',
				title: 'Observation out of capture order',
				detail: 'Its corrected time is earlier than the record captured before it.',
				target: { screen: 'timeline', recordId: ordered[i].id }
			});
		}
	}

	const acc = input.accountability;
	if (acc) {
		// Only raised when the operator configured a threshold. No invented deadlines.
		if (input.overdueThresholdMs && input.overdueThresholdMs > 0) {
			for (const row of acc.rows) {
				if (row.start.observations.length === 0) continue;
				const startedAt = row.start.firstTime;
				if (startedAt == null) continue;
				const seenHere = row.passes.some((p) => p.observations.length > 0);
				if (!seenHere && input.now - startedAt > input.overdueThresholdMs) {
					prompts.push({
						key: `unobserved:${row.participant.id}`,
						severity: 'attention',
						title: `Boat ${row.boatNumber} started but not observed here`,
						detail: `No pass recorded at this checkpoint since the start was heard. This is a prompt to look, not a conclusion.`,
						target: { screen: 'accountability', recordId: row.participant.id }
					});
				}
			}
		}

		if (acc.summary.sweepComplete && acc.summary.unobservedHereCount > 0) {
			prompts.push({
				key: `sweep-unresolved:${acc.summary.unobservedHereCount}`,
				severity: 'attention',
				title: 'Sweep passed with unresolved accountability',
				detail: `${acc.summary.unobservedHereCount} racer(s) on the lineup have no pass recorded at this checkpoint.`,
				target: { screen: 'accountability' }
			});
		}

		if (acc.unassigned.length > 0) {
			prompts.push({
				key: `heat-unassigned:${acc.unassigned.length}`,
				severity: 'info',
				title: `${acc.unassigned.length} record(s) in this heat without a boat`,
				detail: 'Assign them so the accountability table is complete.',
				target: { screen: 'accountability' }
			});
		}
	}

	if (input.gpsWatchActive && input.staleGpsFixTime != null) {
		const age = input.now - input.staleGpsFixTime;
		if (age > 60_000) {
			prompts.push({
				key: `stale-gps:${Math.floor(age / 60_000)}`,
				severity: 'attention',
				title: 'GPS fix is stale',
				detail: `Last fix is ${Math.round(age / 1000)} s old. Coordinates shown are the last known position.`
			});
		}
	}

	if (input.clockDriftMs != null && Math.abs(input.clockDriftMs) >= 5000) {
		prompts.push({
			key: `clock-drift:${Math.round(input.clockDriftMs / 1000)}`,
			severity: 'attention',
			title: 'Device clock changed during this session',
			detail: `Wall clock moved ${Math.round(input.clockDriftMs / 1000)} s against elapsed time. Existing records were not altered — review times captured around this point.`,
			target: { screen: 'timeline' }
		});
	}

	return prompts;
}
