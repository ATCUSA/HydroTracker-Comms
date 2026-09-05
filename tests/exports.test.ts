import { describe, expect, it } from 'vitest';
import { csvCell, escapeSpreadsheetText, slug, toCsv } from '../src/lib/export/csv';
import {
	activityLogSheet,
	correctionsSheet,
	heatChecklistSheet,
	incidentSheet,
	reportHeaderRows,
	type ReportContext
} from '../src/lib/report/builders';
import { buildAccountability } from '../src/lib/domain/accountability';
import { buildTimeline } from '../src/lib/domain/timeline';
import { checkpoint, heat, leg, observation, participant, racer } from './factories';
import type { AuditRevision, Incident, RaceEvent, StationSession } from '../src/lib/domain/types';

const event: RaceEvent = {
	id: 'ev1',
	createdAt: 0,
	updatedAt: 0,
	voided: false,
	name: 'River Classic',
	dates: ['2026-09-05'],
	timezone: 'UTC',
	courseNotes: '',
	isDemo: false,
	workspace: 'live',
	importedFrom: null
};

const session: StationSession = {
	id: 'ses1',
	createdAt: 0,
	updatedAt: 0,
	voided: false,
	eventId: 'ev1',
	checkpointName: 'Checkpoint 2',
	safetyBoatNumber: 'SB-2',
	operatorName: 'Operator',
	callSign: 'Safety Two',
	channel: '72',
	checkpointLocation: null,
	deviceId: 'dev1',
	deviceLabel: '',
	startedAt: 0,
	endedAt: null
};

const ctx: ReportContext = {
	event,
	session,
	timezone: 'UTC',
	generatedAt: Date.UTC(2026, 8, 5, 12, 0, 0),
	coordinateFormat: 'ddm'
};

describe('spreadsheet formula escaping', () => {
	it('neutralises every formula-leading character', () => {
		expect(escapeSpreadsheetText('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
		expect(escapeSpreadsheetText('+1')).toBe("'+1");
		expect(escapeSpreadsheetText('-12')).toBe("'-12");
		expect(escapeSpreadsheetText('@boat')).toBe("'@boat");
		expect(escapeSpreadsheetText('\tstart')).toBe("'\tstart");
	});

	it('leaves ordinary text and boat numbers alone', () => {
		expect(escapeSpreadsheetText('007')).toBe('007');
		expect(escapeSpreadsheetText('4B')).toBe('4B');
		expect(escapeSpreadsheetText('pass 2 of 2')).toBe('pass 2 of 2');
		expect(escapeSpreadsheetText('')).toBe('');
		expect(escapeSpreadsheetText(null)).toBe('');
	});

	it('quotes commas, quotes and newlines after escaping', () => {
		expect(csvCell('a,b')).toBe('"a,b"');
		expect(csvCell('say "hi"')).toBe('"say ""hi"""');
		expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
		expect(csvCell('=1,2')).toBe('"\'=1,2"');
	});

	it('joins rows with CRLF', () => {
		expect(toCsv([['a', 'b'], ['c']])).toBe('a,b\r\nc');
	});

	it('produces filesystem-safe names', () => {
		expect(slug('River Classic 2026 / Heat #1')).toBe('River-Classic-2026-Heat-1');
		expect(slug('***')).toBe('log');
	});
});

describe('report headers', () => {
	it('names the station, operator, timezone, generation time and scope', () => {
		const rows = reportHeaderRows(ctx);
		const flat = Object.fromEntries(rows.map((r) => [r[0], r[1]]));
		expect(flat.Event).toBe('River Classic');
		expect(flat['Station / checkpoint']).toBe('Checkpoint 2');
		expect(flat.Operator).toBe('Operator');
		expect(flat['Event timezone']).toBe('UTC');
		expect(flat.Generated).toBe('2026-09-05T12:00:00.000+00:00');
		expect(flat.Scope).toMatch(/Not official timing or scoring/);
	});

	it('marks a demo event as not a real log', () => {
		const rows = reportHeaderRows({ ...ctx, event: { ...event, isDemo: true } });
		expect(rows.find((r) => r[0] === 'Scope')?.[1]).toMatch(/DEMO DATA/);
	});
});

describe('per-heat checklist', () => {
	const legs = [leg('l1', 1), leg('l2', 2)];
	const racers = [racer('r1', '007', 'A'), racer('r2', '12', 'A'), racer('r3', '4B', 'B')];
	const participants = [
		participant('p1', 'r1', 1),
		participant('p2', 'r2', 2, { participation: 'dnf' }),
		participant('p3', 'r3', 3, { participation: 'scratched' })
	];
	const checkpoints = [checkpoint('c1', 'CP1', true), checkpoint('c2', 'Landing', false)];
	const observations = [
		observation('o1', {
			participantId: 'p1',
			legId: 'l1',
			captureTime: Date.UTC(2026, 8, 5, 10, 0, 1, 230)
		}),
		observation('o2', {
			participantId: 'p1',
			legId: 'l2',
			captureTime: Date.UTC(2026, 8, 5, 10, 5, 0)
		}),
		observation('s1', { type: 'sweep', legId: 'l2', captureTime: Date.UTC(2026, 8, 5, 10, 9, 0) })
	];
	const acc = buildAccountability({
		heat: heat(),
		legs,
		participants,
		racers,
		observations,
		checkpoints
	});
	const sheet = heatChecklistSheet(ctx, heat(), legs, checkpoints, acc);

	it('mirrors the printed checklist columns', () => {
		const header = sheet.rows[0] as string[];
		expect(header.slice(0, 5)).toEqual([
			'Starting order',
			'Boat #',
			'Class',
			'Scratched',
			'Start heard'
		]);
		expect(header).toContain('Time passed position — Leg 1 (DOWN)');
		expect(header).toContain('Finished (finish heard)');
	});

	it('prints observed times with hundredths', () => {
		expect(sheet.rows[1][5]).toBe('10:00:01.23');
	});

	it('keeps boat numbers as text', () => {
		expect(sheet.rows[1][1]).toBe('007');
		expect(sheet.rows[3][1]).toBe('4B');
	});

	it('says "No finish heard" rather than implying DNF', () => {
		expect(sheet.rows[1]).toContain('No finish heard');
		// The DNF boat is marked DNF in its own column, not in the finish column.
		expect(sheet.rows[2][sheet.rows[2].length - 2]).toBe('DNF');
	});

	it('labels a non-reporting checkpoint rather than calling it missing', () => {
		const header = sheet.rows[0] as string[];
		const landingIndex = header.indexOf('Landing (does not report)');
		expect(landingIndex).toBeGreaterThan(-1);
		expect(sheet.rows[1][landingIndex]).toBe('Not expected to report');
	});

	it('marks scratched boats', () => {
		expect(sheet.rows[3][3]).toBe('YES');
		expect(sheet.rows[1][3]).toBe('NO');
	});

	it('adds a sweep block and a caveat about what the counts mean', () => {
		const flat = sheet.rows.map((r) => r.join('|')).join('\n');
		expect(flat).toContain('Sweep boat');
		expect(flat).toContain('10:09:00.00');
		expect(flat).toContain('not a statement that anyone is physically safe');
	});
});

describe('activity log', () => {
	it('shows the original capture time next to a corrected effective time', () => {
		const corrected = observation('o1', {
			captureTime: 1_000_000,
			effectiveTime: 1_060_000,
			participantId: null
		});
		const timeline = buildTimeline({
			observations: [corrected],
			radio: [],
			eventLog: [],
			incidents: [],
			incidentActions: [],
			heats: [],
			boatNumberFor: () => null
		});
		const sheet = activityLogSheet(ctx, timeline);
		const row = sheet.rows[1];
		expect(row[0]).not.toBe(row[1]);
		expect(row[4]).toBe('CORRECTED');
	});

	it('labels an unassigned record rather than guessing a boat', () => {
		const timeline = buildTimeline({
			observations: [observation('o1', { participantId: null })],
			radio: [],
			eventLog: [],
			incidents: [],
			incidentActions: [],
			heats: [],
			boatNumberFor: () => null
		});
		expect(activityLogSheet(ctx, timeline).rows[1].join(' | ')).toContain('Unassigned');
	});
});

describe('incident report', () => {
	const incident: Incident = {
		id: 'i1',
		createdAt: 0,
		updatedAt: 0,
		voided: false,
		eventId: 'ev1',
		sessionId: 'ses1',
		heatId: null,
		status: 'open',
		incidentType: 'Person in water',
		severity: 'high',
		boatNumbers: ['007'],
		locationNotes: '',
		riverSide: 'left',
		hazards: '',
		peopleInvolved: '',
		reportedInjuries: '',
		resources: '',
		notificationsMade: '',
		followUp: '',
		resolution: '',
		captureTime: Date.UTC(2026, 8, 5, 11, 0, 0),
		effectiveTime: Date.UTC(2026, 8, 5, 11, 0, 0),
		captureOffsetMinutes: 0,
		sequence: 1,
		resolvedAt: null,
		incidentLocation: {
			source: 'device-fix',
			latitude: 45.5234,
			longitude: -122.6762,
			accuracyMeters: 9,
			fixTime: Date.UTC(2026, 8, 5, 11, 0, 5),
			capturedAt: Date.UTC(2026, 8, 5, 11, 0, 6)
		},
		initialDeviceFix: null,
		checkpointLocation: null
	};

	it('records coordinate provenance alongside the numbers', () => {
		const flat = incidentSheet(ctx, [incident], [])
			.rows.map((r) => r.join(' | '))
			.join('\n');
		expect(flat).toContain("N 45° 31.404'");
		expect(flat).toContain('source: device-fix');
		expect(flat).toContain('accuracy ±9 m');
		expect(flat).toContain('fix time 2026-09-05T11:00:05.000+00:00');
	});

	it('says a location is pending rather than printing invented coordinates', () => {
		const pending: Incident = {
			...incident,
			incidentLocation: { source: 'pending', capturedAt: incident.captureTime }
		};
		const flat = incidentSheet(ctx, [pending], [])
			.rows.map((r) => r.join(' | '))
			.join('\n');
		expect(flat).toContain('PENDING — no coordinates');
	});

	it('reports an empty incident list plainly', () => {
		expect(incidentSheet(ctx, [], []).rows[0]).toEqual(['No incidents recorded.']);
	});
});

describe('correction history', () => {
	it('lists one row per changed field with before and after', () => {
		const revisions: AuditRevision[] = [
			{
				id: 'rev1',
				eventId: 'ev1',
				table: 'observations',
				recordId: 'o1',
				action: 'update',
				changes: [
					{ field: 'effectiveTime', before: 1000, after: 2000 },
					{ field: 'participantId', before: null, after: 'p2' }
				],
				at: Date.UTC(2026, 8, 5, 12, 0, 0),
				operatorName: 'Operator',
				deviceId: 'dev1',
				reason: 'reassigned boat',
				sequence: 5
			}
		];
		const sheet = correctionsSheet(ctx, revisions);
		expect(sheet.rows).toHaveLength(3);
		expect(sheet.rows[1][7]).toBe('effectiveTime');
		expect(sheet.rows[1][6]).toBe('reassigned boat');
		expect(sheet.rows[2][9]).toBe('"p2"');
	});

	it('leaves plain creates out of the correction history', () => {
		const sheet = correctionsSheet(ctx, [
			{
				id: 'rev1',
				eventId: 'ev1',
				table: 'observations',
				recordId: 'o1',
				action: 'create',
				changes: [],
				at: 0,
				operatorName: 'Operator',
				deviceId: 'dev1',
				reason: '',
				sequence: 1
			}
		]);
		expect(sheet.rows[1]).toEqual(['No corrections or voids recorded.']);
	});
});
