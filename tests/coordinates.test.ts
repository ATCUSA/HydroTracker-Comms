import { describe, expect, it } from 'vitest';
import {
	buildResponderText,
	formatCoordinates,
	isStale,
	isValidLatitude,
	isValidLongitude,
	parseCoordinateText,
	toDecimalDegrees,
	toDegreesDecimalMinutes,
	toDegreesMinutesSeconds
} from '../src/lib/geo/coordinates';

describe('coordinate formatting', () => {
	it('labels both hemispheres on each axis', () => {
		expect(toDecimalDegrees(45.5234, 'lat', 4)).toBe('N 45.5234°');
		expect(toDecimalDegrees(-45.5234, 'lat', 4)).toBe('S 45.5234°');
		expect(toDecimalDegrees(122.6762, 'lon', 4)).toBe('E 122.6762°');
		expect(toDecimalDegrees(-122.6762, 'lon', 4)).toBe('W 122.6762°');
	});

	it('treats the equator and prime meridian as positive hemispheres', () => {
		expect(toDecimalDegrees(0, 'lat', 2)).toBe('N 00.00°');
		expect(toDecimalDegrees(0, 'lon', 2)).toBe('E 000.00°');
	});

	it('pads degrees to two digits for latitude and three for longitude', () => {
		expect(toDegreesDecimalMinutes(5.5, 'lat')).toBe("N 05° 30.000'");
		expect(toDegreesDecimalMinutes(5.5, 'lon')).toBe("E 005° 30.000'");
	});

	it('converts to degrees and decimal minutes', () => {
		expect(toDegreesDecimalMinutes(45.5234, 'lat')).toBe("N 45° 31.404'");
		expect(toDegreesDecimalMinutes(-122.6762, 'lon')).toBe("W 122° 40.572'");
	});

	it('converts to degrees, minutes and seconds', () => {
		expect(toDegreesMinutesSeconds(45.5234, 'lat')).toBe('N 45° 31\' 24.24"');
		expect(toDegreesMinutesSeconds(-122.6762, 'lon')).toBe('W 122° 40\' 34.32"');
	});

	it('carries rounding upward instead of printing 60 minutes', () => {
		// 45.99999999° is 59.9999994 minutes, which must round to 46° 00.000'.
		expect(toDegreesDecimalMinutes(45.99999999, 'lat')).toBe("N 46° 00.000'");
	});

	it('carries rounding upward instead of printing 60 seconds', () => {
		// 45.9999999° is 59' 59.99964", which must round to 46° 00' 00.00".
		expect(toDegreesMinutesSeconds(45.9999999, 'lat')).toBe('N 46° 00\' 00.00"');
	});

	it('carries seconds into minutes without touching degrees', () => {
		// 45.51666666° is 31' 00.00" after rounding 59.9999...".
		expect(toDegreesMinutesSeconds(45.5166666666, 'lat')).toBe('N 45° 31\' 00.00"');
	});

	it('renders the extremes of the coordinate ranges', () => {
		expect(toDegreesMinutesSeconds(90, 'lat')).toBe('N 90° 00\' 00.00"');
		expect(toDegreesMinutesSeconds(-90, 'lat')).toBe('S 90° 00\' 00.00"');
		expect(toDegreesDecimalMinutes(180, 'lon')).toBe("E 180° 00.000'");
		expect(toDegreesDecimalMinutes(-180, 'lon')).toBe("W 180° 00.000'");
	});

	it('rejects out-of-range values', () => {
		expect(isValidLatitude(90.0001)).toBe(false);
		expect(isValidLatitude(-90.0001)).toBe(false);
		expect(isValidLongitude(180.0001)).toBe(false);
		expect(isValidLongitude(-180.0001)).toBe(false);
		expect(isValidLatitude(Number.NaN)).toBe(false);
	});

	it('puts latitude before longitude', () => {
		expect(formatCoordinates({ latitude: 45.5, longitude: -122.5 }, 'dd')).toBe(
			'N 45.500000°  W 122.500000°'
		);
	});
});

describe('coordinate parsing', () => {
	it('reads a bare decimal pair', () => {
		expect(parseCoordinateText('45.5234 -122.6762')).toEqual({
			latitude: 45.5234,
			longitude: -122.6762
		});
	});

	it('reads a comma separated pair', () => {
		expect(parseCoordinateText('45.5234, -122.6762')).toEqual({
			latitude: 45.5234,
			longitude: -122.6762
		});
	});

	it('reads degrees and decimal minutes with hemisphere letters', () => {
		const parsed = parseCoordinateText("N 45° 31.404' W 122° 40.572'");
		expect(parsed?.latitude).toBeCloseTo(45.5234, 6);
		expect(parsed?.longitude).toBeCloseTo(-122.6762, 6);
	});

	it('reads degrees, minutes and seconds', () => {
		const parsed = parseCoordinateText('45 31 24.24 N 122 40 34.32 W');
		expect(parsed?.latitude).toBeCloseTo(45.5234, 5);
		expect(parsed?.longitude).toBeCloseTo(-122.6762, 5);
	});

	it('accepts the axes in either order when hemispheres are given', () => {
		const parsed = parseCoordinateText('W 122.6762 N 45.5234');
		expect(parsed?.latitude).toBeCloseTo(45.5234, 6);
		expect(parsed?.longitude).toBeCloseTo(-122.6762, 6);
	});

	it('round-trips through every display format', () => {
		const original = { latitude: -33.86785, longitude: 151.20732 };
		for (const format of ['dd', 'ddm', 'dms'] as const) {
			const parsed = parseCoordinateText(formatCoordinates(original, format));
			expect(parsed?.latitude).toBeCloseTo(original.latitude, 3);
			expect(parsed?.longitude).toBeCloseTo(original.longitude, 3);
		}
	});

	it('rejects text that is not a coordinate pair', () => {
		expect(parseCoordinateText('')).toBeNull();
		expect(parseCoordinateText('somewhere near the bridge')).toBeNull();
		expect(parseCoordinateText('45.5')).toBeNull();
		expect(parseCoordinateText('91.0 200.0')).toBeNull();
	});
});

describe('fix staleness and responder text', () => {
	it('treats a missing fix time as stale', () => {
		expect(isStale(null, 1000)).toBe(true);
	});

	it('marks a fix older than a minute as stale', () => {
		expect(isStale(0, 59_000)).toBe(false);
		expect(isStale(0, 61_000)).toBe(true);
	});

	it('names the location type, format, accuracy and fix age', () => {
		const text = buildResponderText({
			locationType: 'Incident location',
			location: {
				source: 'device-fix',
				latitude: 45.5234,
				longitude: -122.6762,
				accuracyMeters: 8,
				fixTime: 1000,
				capturedAt: 1000
			},
			format: 'ddm',
			now: 31_000,
			timeLabel: '2026-09-05 10:00:00.00',
			stationLabel: 'Checkpoint 2'
		});
		expect(text).toContain('Location type: Incident location');
		expect(text).toContain('Degrees and decimal minutes');
		expect(text).toContain("Latitude:  N 45° 31.404'");
		expect(text).toContain("Longitude: W 122° 40.572'");
		expect(text).toContain('accuracy ±8 m');
		expect(text).toContain('Fix age: 30 s');
		expect(text).not.toContain('STALE');
	});

	it('says coordinates are unavailable rather than inventing them', () => {
		const text = buildResponderText({
			locationType: 'Incident location',
			location: { source: 'pending', capturedAt: 0 },
			format: 'dd',
			now: 0,
			timeLabel: 'unknown'
		});
		expect(text).toContain('Coordinates: NOT AVAILABLE');
	});

	it('flags a stale fix in the responder block', () => {
		const text = buildResponderText({
			locationType: 'Current device location',
			location: {
				source: 'device-fix',
				latitude: 1,
				longitude: 1,
				accuracyMeters: null,
				fixTime: 0,
				capturedAt: 0
			},
			format: 'dd',
			now: 300_000,
			timeLabel: 'earlier'
		});
		expect(text).toContain('STALE');
		expect(text).toContain('accuracy unavailable');
	});
});
