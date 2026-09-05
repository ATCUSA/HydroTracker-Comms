import { describe, expect, it } from 'vitest';
import {
	CLOCK_DRIFT_THRESHOLD_MS,
	clockDriftMs,
	formatAge,
	formatDateTime,
	formatIsoWithOffset,
	formatOffset,
	formatTimeHundredths,
	parseLocalTimeOnDay,
	zonedParts
} from '../src/lib/time/clock';

// 2026-07-04T18:30:45.678Z — inside US daylight time.
const SUMMER = Date.UTC(2026, 6, 4, 18, 30, 45, 678);
// 2026-01-04T18:30:45.678Z — standard time.
const WINTER = Date.UTC(2026, 0, 4, 18, 30, 45, 678);

describe('timezone-aware display', () => {
	it('renders hundredths without rounding up to the next second', () => {
		expect(formatTimeHundredths(SUMMER, 'UTC')).toBe('18:30:45.67');
	});

	it('renders the event timezone, not the device timezone', () => {
		expect(formatTimeHundredths(SUMMER, 'America/Los_Angeles')).toBe('11:30:45.67');
		expect(formatTimeHundredths(SUMMER, 'Pacific/Auckland')).toBe('06:30:45.67');
	});

	it('follows daylight saving for the same wall time', () => {
		expect(zonedParts(SUMMER, 'America/Los_Angeles').offsetMinutes).toBe(-420);
		expect(zonedParts(WINTER, 'America/Los_Angeles').offsetMinutes).toBe(-480);
	});

	it('formats the offset with a sign and two-digit parts', () => {
		expect(formatOffset(-420)).toBe('-07:00');
		expect(formatOffset(330)).toBe('+05:30');
		expect(formatOffset(0)).toBe('+00:00');
	});

	it('exports ISO timestamps that keep the original offset', () => {
		expect(formatIsoWithOffset(SUMMER, 'America/Los_Angeles')).toBe(
			'2026-07-04T11:30:45.678-07:00'
		);
		expect(formatIsoWithOffset(WINTER, 'America/Los_Angeles')).toBe(
			'2026-01-04T10:30:45.678-08:00'
		);
	});

	it('handles a zone crossing the date line at midnight', () => {
		expect(formatDateTime(Date.UTC(2026, 6, 4, 23, 30), 'Pacific/Auckland')).toBe(
			'2026-07-05 11:30:00'
		);
	});

	it('falls back to UTC for an unknown timezone rather than throwing', () => {
		expect(formatTimeHundredths(SUMMER, 'Not/AZone')).toBe('18:30:45.67');
	});
});

describe('operator-typed time parsing', () => {
	it('accepts HH:MM, HH:MM:SS and HH:MM:SS.hh', () => {
		expect(parseLocalTimeOnDay('11:30', SUMMER, 'America/Los_Angeles')).toBe(
			Date.UTC(2026, 6, 4, 18, 30)
		);
		expect(parseLocalTimeOnDay('11:30:45', SUMMER, 'America/Los_Angeles')).toBe(
			Date.UTC(2026, 6, 4, 18, 30, 45)
		);
		expect(parseLocalTimeOnDay('11:30:45.67', SUMMER, 'America/Los_Angeles')).toBe(
			Date.UTC(2026, 6, 4, 18, 30, 45, 670)
		);
	});

	it('places the time on the same event-local day as the record', () => {
		const parsed = parseLocalTimeOnDay('23:59:59', SUMMER, 'America/Los_Angeles');
		expect(formatDateTime(parsed as number, 'America/Los_Angeles')).toBe('2026-07-04 23:59:59');
	});

	it('rejects text that is not a time', () => {
		expect(parseLocalTimeOnDay('', SUMMER, 'UTC')).toBeNull();
		expect(parseLocalTimeOnDay('later', SUMMER, 'UTC')).toBeNull();
		expect(parseLocalTimeOnDay('25:00', SUMMER, 'UTC')).toBeNull();
		expect(parseLocalTimeOnDay('11:60', SUMMER, 'UTC')).toBeNull();
		expect(parseLocalTimeOnDay('11:30:75', SUMMER, 'UTC')).toBeNull();
	});
});

describe('wall-clock drift detection', () => {
	it('reports no drift when both clocks advance together', () => {
		const reference = { epoch: 1_000_000, monotonic: 500 };
		const current = { epoch: 1_010_000, monotonic: 10_500 };
		expect(clockDriftMs(reference, current)).toBe(0);
	});

	it('detects a forward jump of the wall clock', () => {
		const reference = { epoch: 1_000_000, monotonic: 500 };
		// Monotonic says 10 s elapsed; the wall clock says 70 s.
		const current = { epoch: 1_070_000, monotonic: 10_500 };
		expect(clockDriftMs(reference, current)).toBe(60_000);
		expect(Math.abs(clockDriftMs(reference, current))).toBeGreaterThan(CLOCK_DRIFT_THRESHOLD_MS);
	});

	it('detects a backward jump of the wall clock', () => {
		const reference = { epoch: 1_000_000, monotonic: 500 };
		const current = { epoch: 970_000, monotonic: 10_500 };
		expect(clockDriftMs(reference, current)).toBe(-40_000);
	});

	it('ignores drift below the review threshold', () => {
		const reference = { epoch: 1_000_000, monotonic: 500 };
		const current = { epoch: 1_010_900, monotonic: 10_500 };
		expect(Math.abs(clockDriftMs(reference, current))).toBeLessThan(CLOCK_DRIFT_THRESHOLD_MS);
	});
});

describe('age labels', () => {
	it('reads in seconds, minutes then hours', () => {
		expect(formatAge(4_000)).toBe('4 s ago');
		expect(formatAge(125_000)).toBe('2 min 5 s ago');
		expect(formatAge(3_725_000)).toBe('1 h 2 min ago');
	});
});
