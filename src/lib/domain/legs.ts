import type { Direction, LegFormat } from './types';

export interface LegTemplate {
	name: string;
	direction: Direction;
	hasStart: boolean;
	hasFinish: boolean;
}

export const LEG_FORMAT_LABELS: Record<LegFormat, string> = {
	'one-way': 'One-way run',
	'continuous-down-and-back': 'Continuous down-and-back (one start)',
	'separate-legs': 'Separate legs (each with its own start/finish)'
};

export const LEG_FORMAT_NOTES: Record<LegFormat, string> = {
	'one-way': 'A single leg past this checkpoint, with one start and one finish.',
	'continuous-down-and-back':
		'One start only. Boats pass this checkpoint outbound and again on the return; no intermediate finish is created.',
	'separate-legs':
		'Each leg has its own start and finish where the operator uses them. Starting order carries through by default and can be edited.'
};

/**
 * Leg layouts per format. Continuous down-and-back deliberately gets one
 * start on the outbound leg and one finish on the return: the app must not
 * invent a second start or an intermediate finish.
 */
export function legTemplatesFor(format: LegFormat, legCount = 2): LegTemplate[] {
	switch (format) {
		case 'continuous-down-and-back':
			return [
				{ name: 'Outbound', direction: 'downstream', hasStart: true, hasFinish: false },
				{ name: 'Return', direction: 'upstream', hasStart: false, hasFinish: true }
			];
		case 'separate-legs': {
			const count = Math.max(1, legCount);
			return Array.from({ length: count }, (_, i) => ({
				name: `Leg ${i + 1}`,
				direction: i % 2 === 0 ? ('downstream' as Direction) : ('upstream' as Direction),
				hasStart: true,
				hasFinish: true
			}));
		}
		case 'one-way':
		default:
			return [{ name: 'Run', direction: 'downstream', hasStart: true, hasFinish: true }];
	}
}

export const DIRECTION_LABELS: Record<Direction, string> = {
	upstream: 'Upstream',
	downstream: 'Downstream',
	unknown: 'Direction not recorded'
};

export const DIRECTION_SHORT: Record<Direction, string> = {
	upstream: 'UP',
	downstream: 'DOWN',
	unknown: '—'
};
