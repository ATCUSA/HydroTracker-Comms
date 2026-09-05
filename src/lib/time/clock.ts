import type { EpochMs } from '$lib/domain/types';

/**
 * Time capture rules:
 *  - The epoch value is read at the moment of the operator's activation, before
 *    any form renders, any GPS is requested, or any database work happens.
 *  - performance.now() gives a monotonic reference so a wall-clock jump can be
 *    detected rather than silently rewriting history.
 */

export function nowMs(): EpochMs {
	return Date.now();
}

export function monotonicMs(): number {
	if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
		return performance.now();
	}
	return Date.now();
}

/** Paired wall-clock and monotonic reading taken at the same instant. */
export interface Instant {
	epoch: EpochMs;
	monotonic: number;
}

export function captureInstant(): Instant {
	return { epoch: nowMs(), monotonic: monotonicMs() };
}

/**
 * Detects a wall-clock change by comparing elapsed wall time against elapsed
 * monotonic time since a reference instant. Returns drift in milliseconds;
 * positive means the wall clock moved forward relative to monotonic time.
 */
export function clockDriftMs(reference: Instant, current: Instant): number {
	const wall = current.epoch - reference.epoch;
	const mono = current.monotonic - reference.monotonic;
	return wall - mono;
}

/** Threshold above which a drift is worth telling the operator about. */
export const CLOCK_DRIFT_THRESHOLD_MS = 5000;

export function utcOffsetMinutes(at: EpochMs = nowMs()): number {
	// getTimezoneOffset is minutes *behind* UTC; invert so east is positive.
	return -new Date(at).getTimezoneOffset();
}

function pad(value: number, width = 2): string {
	return String(Math.floor(Math.abs(value))).padStart(width, '0');
}

export interface ZonedParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
	millisecond: number;
	offsetMinutes: number;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
	let fmt = partsCache.get(timezone);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat('en-US', {
			timeZone: timezone,
			hour12: false,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		partsCache.set(timezone, fmt);
	}
	return fmt;
}

/** Breaks an epoch value into calendar parts in the given IANA timezone. */
export function zonedParts(at: EpochMs, timezone: string): ZonedParts {
	let raw: Intl.DateTimeFormatPart[];
	try {
		raw = formatterFor(timezone).formatToParts(new Date(at));
	} catch {
		raw = formatterFor('UTC').formatToParts(new Date(at));
		timezone = 'UTC';
	}
	const get = (type: string) => Number(raw.find((p) => p.type === type)?.value ?? '0');
	const hour = get('hour') === 24 ? 0 : get('hour');
	const parts = {
		year: get('year'),
		month: get('month'),
		day: get('day'),
		hour,
		minute: get('minute'),
		second: get('second'),
		millisecond: ((at % 1000) + 1000) % 1000,
		offsetMinutes: 0
	};
	// Reconstruct the offset from the difference between the zoned wall time and UTC.
	const asUtc = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second,
		parts.millisecond
	);
	parts.offsetMinutes = Math.round((asUtc - at) / 60000);
	return parts;
}

export function formatOffset(offsetMinutes: number): string {
	const sign = offsetMinutes < 0 ? '-' : '+';
	return `${sign}${pad(offsetMinutes / 60)}:${pad(Math.abs(offsetMinutes) % 60)}`;
}

/**
 * Clock display with hundredths. Hundredths are shown because the operator
 * needs to distinguish rapid consecutive captures, not because the underlying
 * time is accurate to 0.01 s.
 */
export function formatTimeHundredths(at: EpochMs, timezone: string): string {
	const p = zonedParts(at, timezone);
	const hundredths = Math.floor(p.millisecond / 10);
	return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}.${pad(hundredths)}`;
}

export function formatTime(at: EpochMs, timezone: string): string {
	const p = zonedParts(at, timezone);
	return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function formatDate(at: EpochMs, timezone: string): string {
	const p = zonedParts(at, timezone);
	return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function formatDateTime(at: EpochMs, timezone: string, withHundredths = false): string {
	const time = withHundredths ? formatTimeHundredths(at, timezone) : formatTime(at, timezone);
	return `${formatDate(at, timezone)} ${time}`;
}

/** ISO 8601 with the event's offset preserved, for exports. */
export function formatIsoWithOffset(at: EpochMs, timezone: string): string {
	const p = zonedParts(at, timezone);
	return (
		`${p.year}-${pad(p.month)}-${pad(p.day)}T` +
		`${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}.${pad(p.millisecond, 3)}` +
		formatOffset(p.offsetMinutes)
	);
}

/**
 * Parses "HH:MM", "HH:MM:SS" or "HH:MM:SS.hh" typed by the operator into an
 * epoch value on the same event-local day as `sameDayAs`. Returns null when the
 * text is not a time.
 */
export function parseLocalTimeOnDay(
	text: string,
	sameDayAs: EpochMs,
	timezone: string
): EpochMs | null {
	const m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*$/.exec(text);
	if (!m) return null;
	const hour = Number(m[1]);
	const minute = Number(m[2]);
	const second = m[3] ? Number(m[3]) : 0;
	const fraction = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
	if (hour > 23 || minute > 59 || second > 59) return null;
	const day = zonedParts(sameDayAs, timezone);
	// Offset can differ across a DST boundary; resolve twice to settle on it.
	let guess =
		Date.UTC(day.year, day.month - 1, day.day, hour, minute, second, fraction) -
		day.offsetMinutes * 60000;
	const check = zonedParts(guess, timezone);
	if (check.offsetMinutes !== day.offsetMinutes) {
		guess =
			Date.UTC(day.year, day.month - 1, day.day, hour, minute, second, fraction) -
			check.offsetMinutes * 60000;
	}
	return guess;
}

/** Human elapsed label, e.g. "12 s ago", "4 min ago". */
export function formatAge(ms: number): string {
	if (!Number.isFinite(ms)) return 'unknown';
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s} s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m} min ${s % 60} s ago`;
	const h = Math.floor(m / 60);
	return `${h} h ${m % 60} min ago`;
}

export function listTimezones(): string[] {
	const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
		.supportedValuesOf;
	if (typeof supported === 'function') {
		try {
			return supported('timeZone');
		} catch {
			/* fall through */
		}
	}
	return ['UTC'];
}

export function deviceTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}
