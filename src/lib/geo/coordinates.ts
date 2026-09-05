import type { CoordinateFormat, Coordinates, RecordedLocation } from '$lib/domain/types';

/**
 * Coordinates are stored as WGS84 decimal degrees and converted for display
 * only. Conversion rounds at the smallest displayed unit and carries the
 * rounding upward (59.9996 minutes becomes 1 degree, 0 minutes), so a rounded
 * value never displays an out-of-range minute or second.
 *
 * The number of digits shown says nothing about accuracy; accuracy is reported
 * separately from the GPS fix.
 */

export const LAT_RANGE = { min: -90, max: 90 };
export const LON_RANGE = { min: -180, max: 180 };

export function isValidLatitude(value: number): boolean {
	return Number.isFinite(value) && value >= LAT_RANGE.min && value <= LAT_RANGE.max;
}

export function isValidLongitude(value: number): boolean {
	return Number.isFinite(value) && value >= LON_RANGE.min && value <= LON_RANGE.max;
}

export type Axis = 'lat' | 'lon';

export function hemisphere(value: number, axis: Axis): string {
	if (axis === 'lat') return value < 0 ? 'S' : 'N';
	return value < 0 ? 'W' : 'E';
}

function degreeDigits(axis: Axis): number {
	return axis === 'lat' ? 2 : 3;
}

function padDegrees(deg: number, axis: Axis): string {
	return String(deg).padStart(degreeDigits(axis), '0');
}

function padFixed(value: number, intDigits: number, decimals: number): string {
	const text = value.toFixed(decimals);
	const [whole, frac] = text.split('.');
	const padded = whole.padStart(intDigits, '0');
	return frac ? `${padded}.${frac}` : padded;
}

/** Decimal degrees, e.g. "N 45.523400°". */
export function toDecimalDegrees(value: number, axis: Axis, decimals = 6): string {
	const h = hemisphere(value, axis);
	const abs = Math.abs(value);
	return `${h} ${padFixed(abs, degreeDigits(axis), decimals)}°`;
}

/** Degrees and decimal minutes, e.g. "N 45° 31.404'". */
export function toDegreesDecimalMinutes(value: number, axis: Axis, decimals = 3): string {
	const h = hemisphere(value, axis);
	const abs = Math.abs(value);
	let deg = Math.floor(abs);
	let minutes = (abs - deg) * 60;
	// Round first, then carry, so 59.9996' never prints as 60.000'.
	const factor = 10 ** decimals;
	minutes = Math.round(minutes * factor) / factor;
	if (minutes >= 60) {
		minutes -= 60;
		deg += 1;
	}
	return `${h} ${padDegrees(deg, axis)}° ${padFixed(minutes, 2, decimals)}'`;
}

/** Degrees, minutes, seconds, e.g. "N 45° 31' 24.24\"". */
export function toDegreesMinutesSeconds(value: number, axis: Axis, decimals = 2): string {
	const h = hemisphere(value, axis);
	const abs = Math.abs(value);
	let deg = Math.floor(abs);
	let minutes = Math.floor((abs - deg) * 60);
	let seconds = (abs - deg - minutes / 60) * 3600;
	const factor = 10 ** decimals;
	seconds = Math.round(seconds * factor) / factor;
	if (seconds >= 60) {
		seconds -= 60;
		minutes += 1;
	}
	if (minutes >= 60) {
		minutes -= 60;
		deg += 1;
	}
	return `${h} ${padDegrees(deg, axis)}° ${String(minutes).padStart(2, '0')}' ${padFixed(seconds, 2, decimals)}"`;
}

export function formatAxis(value: number, axis: Axis, format: CoordinateFormat): string {
	switch (format) {
		case 'ddm':
			return toDegreesDecimalMinutes(value, axis);
		case 'dms':
			return toDegreesMinutesSeconds(value, axis);
		case 'dd':
		default:
			return toDecimalDegrees(value, axis);
	}
}

export const FORMAT_LABELS: Record<CoordinateFormat, string> = {
	dd: 'Decimal degrees',
	ddm: 'Degrees and decimal minutes',
	dms: 'Degrees, minutes, seconds'
};

/** Latitude first, then longitude, always with the format named. */
export function formatCoordinates(
	coords: Pick<Coordinates, 'latitude' | 'longitude'>,
	format: CoordinateFormat
): string {
	return `${formatAxis(coords.latitude, 'lat', format)}  ${formatAxis(coords.longitude, 'lon', format)}`;
}

/**
 * Accepts the three display formats plus bare decimal pairs, in either
 * "hemisphere-prefix" or "trailing-hemisphere" order. Returns null when the
 * text cannot be read as a coordinate pair.
 */
export function parseCoordinateText(text: string): Coordinates | null {
	const cleaned = text
		.replace(/[°′″]/g, (c) => (c === '°' ? ' ' : c === '′' ? "'" : '"'))
		.replace(/,/g, ' ')
		.trim();
	if (!cleaned) return null;

	const tokenRe =
		/([NSEW])?\s*(-?\d+(?:\.\d+)?)\s*(?:[^\dNSEW\-]*?(\d+(?:\.\d+)?)\s*'?)?\s*(?:(\d+(?:\.\d+)?)\s*"?)?\s*([NSEW])?/gi;
	const found: Array<{ value: number; letter: string | null }> = [];
	let m: RegExpExecArray | null;
	while ((m = tokenRe.exec(cleaned)) !== null) {
		if (!m[2]) continue;
		if (m[0].trim() === '') continue;
		const sign = m[2].startsWith('-') ? -1 : 1;
		let value = Math.abs(Number(m[2]));
		if (m[3] !== undefined) value += Number(m[3]) / 60;
		if (m[4] !== undefined) value += Number(m[4]) / 3600;
		const letter = (m[1] || m[5] || null)?.toUpperCase() ?? null;
		found.push({ value: sign * value, letter });
		if (found.length === 2) break;
	}
	if (found.length < 2) return null;

	let latEntry = found[0];
	let lonEntry = found[1];
	// Respect explicit hemisphere letters if they arrive in the other order.
	if (latEntry.letter && 'EW'.includes(latEntry.letter)) {
		[latEntry, lonEntry] = [lonEntry, latEntry];
	}

	const applySign = (entry: { value: number; letter: string | null }, negLetter: string) => {
		if (!entry.letter) return entry.value;
		const magnitude = Math.abs(entry.value);
		return entry.letter === negLetter ? -magnitude : magnitude;
	};

	const latitude = applySign(latEntry, 'S');
	const longitude = applySign(lonEntry, 'W');
	if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return null;
	return { latitude, longitude };
}

export const LOCATION_SOURCE_LABELS: Record<string, string> = {
	'checkpoint-estimate': 'Checkpoint-based estimate (not a confirmed incident fix)',
	'device-fix': 'Device GPS fix',
	'manual-entry': 'Manually entered by operator',
	pending: 'Pending — no coordinates available yet'
};

export function accuracyLabel(accuracyMeters?: number | null): string {
	if (accuracyMeters == null || !Number.isFinite(accuracyMeters)) return 'accuracy unavailable';
	return `accuracy ±${Math.round(accuracyMeters)} m`;
}

/** Fixes older than this are labelled stale rather than presented as current. */
export const STALE_FIX_MS = 60_000;

export function isStale(fixTime: number | null | undefined, now: number): boolean {
	if (fixTime == null) return true;
	return now - fixTime > STALE_FIX_MS;
}

export interface ResponderTextInput {
	locationType: string;
	location: RecordedLocation;
	format: CoordinateFormat;
	now: number;
	timeLabel: string;
	stationLabel?: string;
}

/**
 * The block the operator reads or pastes to responders. It always names what
 * kind of location this is, which format the numbers are in, and how old the
 * fix is — never a bare pair of numbers.
 */
export function buildResponderText(input: ResponderTextInput): string {
	const { location, format, now, timeLabel, locationType, stationLabel } = input;
	const lines: string[] = [];
	if (stationLabel) lines.push(stationLabel);
	lines.push(`Location type: ${locationType}`);
	lines.push(`Source: ${LOCATION_SOURCE_LABELS[location.source] ?? location.source}`);
	if (location.latitude == null || location.longitude == null) {
		lines.push('Coordinates: NOT AVAILABLE');
	} else {
		lines.push(`Format: ${FORMAT_LABELS[format]} (WGS84)`);
		lines.push(
			`Latitude:  ${formatAxis(location.latitude, 'lat', format)}`,
			`Longitude: ${formatAxis(location.longitude, 'lon', format)}`
		);
		lines.push(`Reported ${accuracyLabel(location.accuracyMeters)}`);
	}
	const fixAgeSource = location.fixTime ?? location.capturedAt;
	lines.push(`Fix time: ${timeLabel}`);
	const ageSeconds = Math.max(0, Math.round((now - fixAgeSource) / 1000));
	lines.push(`Fix age: ${ageSeconds} s${isStale(fixAgeSource, now) ? ' (STALE)' : ''}`);
	if (location.note) lines.push(`Notes: ${location.note}`);
	return lines.join('\n');
}
