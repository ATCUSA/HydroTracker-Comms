import type { Sheet } from '$lib/export/csv';
import type { AccountabilityResult } from '$lib/domain/accountability';
import { CELL_STATE_LABELS } from '$lib/domain/accountability';
import { DIRECTION_SHORT } from '$lib/domain/legs';
import { formatIsoWithOffset, formatTimeHundredths } from '$lib/time/clock';
import { formatCoordinates } from '$lib/geo/coordinates';
import type { TimelineEntry } from '$lib/domain/timeline';
import type {
	AuditRevision,
	CoordinateFormat,
	Heat,
	Incident,
	IncidentAction,
	Leg,
	RaceEvent,
	ReportingCheckpoint,
	StationSession
} from '$lib/domain/types';

export interface ReportContext {
	event: RaceEvent;
	session: StationSession | undefined;
	timezone: string;
	generatedAt: number;
	coordinateFormat: CoordinateFormat;
}

/** The header every report carries so a printed page is self-describing. */
export function reportHeaderRows(ctx: ReportContext): string[][] {
	return [
		['Event', ctx.event.name],
		['Event dates', ctx.event.dates.join(', ')],
		['Event timezone', ctx.timezone],
		['Station / checkpoint', ctx.session?.checkpointName ?? 'unknown'],
		['Safety boat', ctx.session?.safetyBoatNumber ?? 'unknown'],
		['Operator', ctx.session?.operatorName ?? 'unknown'],
		['Call sign', ctx.session?.callSign ?? 'unknown'],
		['Device', ctx.session?.deviceId ?? 'unknown'],
		['Generated', formatIsoWithOffset(ctx.generatedAt, ctx.timezone)],
		[
			'Source of observations',
			'This station only. Directly observed unless a row says otherwise; radio-confirmed rows came from another station.'
		],
		[
			'Scope',
			ctx.event.isDemo
				? 'DEMO DATA — not a real log'
				: 'Observation and accountability record. Not official timing or scoring.'
		]
	];
}

const UNKNOWN = '(unknown)';

/**
 * Per-heat checklist modelled on the printed Check List.xlsx: starting order,
 * boat, scratched, time passed with direction, finished, and a sweep row.
 * Start and optional checkpoint reports are added as extra columns.
 */
export function heatChecklistSheet(
	ctx: ReportContext,
	heat: Heat,
	legs: Leg[],
	checkpoints: ReportingCheckpoint[],
	acc: AccountabilityResult
): Sheet {
	const header = [
		'Starting order',
		'Boat #',
		'Class',
		'Scratched',
		'Start heard',
		...legs.map((l) => `Time passed position — ${l.name} (${DIRECTION_SHORT[l.direction]})`),
		...checkpoints.map((c) => `${c.name}${c.expectedToReport ? '' : ' (does not report)'}`),
		'Finished (finish heard)',
		'DNF',
		'Notes'
	];

	const rows: unknown[][] = [header];

	for (const row of acc.rows) {
		const scratched =
			row.participant.participation === 'scratched' || row.participant.participation === 'dns';
		rows.push([
			row.startOrder,
			row.boatNumber,
			row.className,
			scratched ? 'YES' : 'NO',
			cellValue(row.start, ctx.timezone),
			...row.passes.map((p) => cellValue(p, ctx.timezone)),
			...row.checkpointReports.map((r) => cellValue(r, ctx.timezone)),
			// "No finish heard" is not the same as DNF and is never printed as one.
			row.finish.observations.length > 0
				? `YES — ${formatTimeHundredths(row.finish.firstTime as number, ctx.timezone)}`
				: 'No finish heard',
			row.participant.participation === 'dnf' ? 'DNF' : '',
			row.notes
		]);
	}

	rows.push([]);
	rows.push(['Sweep boat']);
	for (const s of acc.summary.sweep) {
		rows.push([
			'',
			`${s.legName} (${DIRECTION_SHORT[s.direction]})`,
			'',
			'',
			'',
			s.observed ? formatTimeHundredths(s.time as number, ctx.timezone) : 'Not recorded'
		]);
	}

	rows.push([]);
	rows.push(['Observed at this checkpoint', acc.summary.observedHereCount]);
	rows.push(['Not observed at this checkpoint', acc.summary.unobservedHereCount]);
	rows.push([
		'Note',
		'These counts describe what was observed and recorded here. They are not a statement that anyone is physically safe.'
	]);

	return { name: `Heat ${heat.name}`.slice(0, 31), rows };
}

function cellValue(
	cell: { state: string; observations: Array<{ effectiveTime: number }>; uncertain: boolean },
	timezone: string
): string {
	if (cell.observations.length === 0) return CELL_STATE_LABELS[cell.state as never] ?? UNKNOWN;
	const times = cell.observations.map((o) => formatTimeHundredths(o.effectiveTime, timezone));
	return times.join(' | ') + (cell.uncertain ? ' (uncertain ID)' : '');
}

/** Chronological activity and radio log. */
export function activityLogSheet(ctx: ReportContext, entries: TimelineEntry[]): Sheet {
	const rows: unknown[][] = [
		[
			'Effective time',
			'Original capture time',
			'Received time',
			'Reported occurrence time',
			'Corrected?',
			'Sequence',
			'Kind',
			'Type',
			'Source',
			'Heat',
			'Boat(s)',
			'Checkpoint',
			'Title',
			'Detail',
			'Voided'
		]
	];
	for (const e of entries) {
		rows.push([
			formatIsoWithOffset(e.effectiveTime, ctx.timezone),
			formatIsoWithOffset(e.captureTime, ctx.timezone),
			e.receivedTime ? formatIsoWithOffset(e.receivedTime, ctx.timezone) : '',
			e.reportedTime ? formatIsoWithOffset(e.reportedTime, ctx.timezone) : '',
			e.effectiveTime !== e.captureTime ? 'CORRECTED' : '',
			e.sequence,
			e.kind,
			e.typeTag,
			e.source,
			e.heatId ?? '',
			e.boatNumbers.join(' '),
			e.checkpointName,
			e.title,
			e.detail,
			e.voided ? 'VOIDED' : ''
		]);
	}
	return { name: 'Activity log', rows };
}

/** Incident report with coordinate provenance and the action timeline. */
export function incidentSheet(
	ctx: ReportContext,
	incidents: Incident[],
	actions: IncidentAction[]
): Sheet {
	const rows: unknown[][] = [];
	for (const incident of incidents) {
		rows.push([`Incident ${incident.id}`, incident.status.toUpperCase()]);
		rows.push(['Marker saved', formatIsoWithOffset(incident.captureTime, ctx.timezone)]);
		rows.push(['Type', incident.incidentType || UNKNOWN]);
		rows.push(['Severity', incident.severity || UNKNOWN]);
		rows.push(['Boats', incident.boatNumbers.join(' ') || UNKNOWN]);
		for (const [label, loc] of [
			['Incident location', incident.incidentLocation],
			['First device fix at activation', incident.initialDeviceFix],
			['Saved checkpoint location', incident.checkpointLocation]
		] as const) {
			if (!loc) {
				rows.push([label, 'not recorded']);
				continue;
			}
			rows.push([
				label,
				loc.latitude != null && loc.longitude != null
					? formatCoordinates(
							{ latitude: loc.latitude, longitude: loc.longitude },
							ctx.coordinateFormat
						)
					: 'PENDING — no coordinates',
				`source: ${loc.source}`,
				loc.accuracyMeters != null
					? `accuracy ±${Math.round(loc.accuracyMeters)} m`
					: 'accuracy unavailable',
				loc.fixTime
					? `fix time ${formatIsoWithOffset(loc.fixTime, ctx.timezone)}`
					: 'not from a GPS fix',
				`recorded ${formatIsoWithOffset(loc.capturedAt, ctx.timezone)}`
			]);
		}
		rows.push(['Location notes', incident.locationNotes]);
		rows.push(['River side', incident.riverSide]);
		rows.push(['Hazards', incident.hazards]);
		rows.push(['People involved', incident.peopleInvolved]);
		rows.push(['Reported injuries', incident.reportedInjuries]);
		rows.push(['Resources', incident.resources]);
		rows.push(['Notifications made', incident.notificationsMade]);
		rows.push(['Follow-up', incident.followUp]);
		rows.push(['Resolution', incident.resolution]);
		rows.push([
			'Resolved at',
			incident.resolvedAt ? formatIsoWithOffset(incident.resolvedAt, ctx.timezone) : 'still open'
		]);
		rows.push(['Actions', 'Time', 'Text']);
		for (const action of actions.filter((a) => a.incidentId === incident.id && !a.voided)) {
			rows.push(['', formatIsoWithOffset(action.effectiveTime, ctx.timezone), action.text]);
		}
		rows.push([]);
	}
	if (rows.length === 0) rows.push(['No incidents recorded.']);
	return { name: 'Incidents', rows };
}

/** Correction and void history, straight from the audit trail. */
export function correctionsSheet(ctx: ReportContext, revisions: AuditRevision[]): Sheet {
	const rows: unknown[][] = [
		[
			'When',
			'Operator',
			'Device',
			'Table',
			'Record',
			'Action',
			'Reason',
			'Field',
			'Before',
			'After'
		]
	];
	for (const rev of revisions) {
		if (rev.action === 'create' && rev.changes.length === 0) continue;
		if (rev.changes.length === 0) {
			rows.push([
				formatIsoWithOffset(rev.at, ctx.timezone),
				rev.operatorName,
				rev.deviceId,
				rev.table,
				rev.recordId,
				rev.action,
				rev.reason,
				'',
				'',
				''
			]);
			continue;
		}
		for (const change of rev.changes) {
			rows.push([
				formatIsoWithOffset(rev.at, ctx.timezone),
				rev.operatorName,
				rev.deviceId,
				rev.table,
				rev.recordId,
				rev.action,
				rev.reason,
				change.field,
				JSON.stringify(change.before ?? null),
				JSON.stringify(change.after ?? null)
			]);
		}
	}
	if (rows.length === 1) rows.push(['No corrections or voids recorded.']);
	return { name: 'Corrections', rows };
}

export function contextSheet(ctx: ReportContext): Sheet {
	return { name: 'Report info', rows: reportHeaderRows(ctx) };
}
