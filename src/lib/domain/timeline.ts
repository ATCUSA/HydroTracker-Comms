import type {
	EpochMs,
	EventLogEntry,
	Heat,
	Id,
	Incident,
	IncidentAction,
	Observation,
	RadioMessage
} from './types';

export type TimelineKind =
	'observation' | 'radio' | 'event' | 'incident' | 'incident-action' | 'heat-transition';

export interface TimelineEntry {
	id: Id;
	kind: TimelineKind;
	/** Dexie table this came from, so edits know where to write. */
	table: string;
	captureTime: EpochMs;
	effectiveTime: EpochMs;
	reportedTime: EpochMs | null;
	receivedTime: EpochMs | null;
	sequence: number;
	heatId: Id | null;
	participantId: Id | null;
	boatNumbers: string[];
	checkpointName: string;
	title: string;
	detail: string;
	voided: boolean;
	incidentId: Id | null;
	unresolvedIncident: boolean;
	needsReview: boolean;
	source: string;
	typeTag: string;
}

export interface TimelineInput {
	observations: Observation[];
	radio: RadioMessage[];
	eventLog: EventLogEntry[];
	incidents: Incident[];
	incidentActions: IncidentAction[];
	heats: Heat[];
	boatNumberFor: (participantId: Id | null | undefined) => string | null;
}

export interface TimelineFilters {
	heatId?: Id | null;
	boatNumber?: string;
	checkpointName?: string;
	kinds?: TimelineKind[];
	unresolvedIncidentsOnly?: boolean;
	needsReviewOnly?: boolean;
	includeVoided?: boolean;
	text?: string;
}

const OBSERVATION_TITLES: Record<string, string> = {
	start: 'Start heard',
	pass: 'Pass at this checkpoint',
	'checkpoint-pass': 'Checkpoint report (radio)',
	finish: 'Finish heard',
	sweep: 'Sweep passed',
	'heat-complete': 'Heat-complete call heard'
};

/**
 * Builds the unified timeline. Entries are ordered by effective time, with the
 * durable capture sequence breaking ties — so a corrected time reorders the
 * display without losing the order things were actually captured in.
 */
export function buildTimeline(input: TimelineInput): TimelineEntry[] {
	const entries: TimelineEntry[] = [];
	const openIncidentIds = new Set(
		input.incidents.filter((i) => i.status === 'open' && !i.voided).map((i) => i.id)
	);

	for (const o of input.observations) {
		const boat = input.boatNumberFor(o.participantId) ?? o.unassignedBoatText ?? '';
		entries.push({
			id: o.id,
			kind: 'observation',
			table: 'observations',
			captureTime: o.captureTime,
			effectiveTime: o.effectiveTime,
			reportedTime: o.reportedTime ?? null,
			receivedTime: o.receivedTime ?? null,
			sequence: o.sequence,
			heatId: o.heatId ?? null,
			participantId: o.participantId ?? null,
			boatNumbers: boat ? [boat] : [],
			checkpointName: o.checkpointName,
			title: OBSERVATION_TITLES[o.type] ?? o.type,
			detail: [
				boat ? `Boat ${boat}` : 'Unassigned',
				o.direction !== 'unknown' ? o.direction : '',
				o.uncertainIdentification ? 'uncertain ID' : '',
				o.notes
			]
				.filter(Boolean)
				.join(' · '),
			voided: o.voided,
			incidentId: null,
			unresolvedIncident: false,
			needsReview:
				(!o.participantId &&
					!o.unassignedBoatText &&
					o.type !== 'sweep' &&
					o.type !== 'heat-complete') ||
				o.effectiveTime !== o.captureTime,
			source: o.source,
			typeTag: o.type
		});
	}

	for (const r of input.radio) {
		entries.push({
			id: r.id,
			kind: 'radio',
			table: 'radio',
			captureTime: r.captureTime,
			effectiveTime: r.effectiveTime,
			reportedTime: r.reportedTime ?? null,
			receivedTime: r.receivedTime ?? null,
			sequence: r.sequence,
			heatId: r.heatId ?? null,
			participantId: null,
			boatNumbers: r.boatNumbers,
			checkpointName: '',
			title: `Radio ${r.direction}${r.fromParty ? ` from ${r.fromParty}` : ''}`,
			detail: [
				r.message,
				r.channel ? `Ch ${r.channel}` : '',
				r.priority !== 'routine' ? r.priority : ''
			]
				.filter(Boolean)
				.join(' · '),
			voided: r.voided,
			incidentId: r.incidentId ?? null,
			unresolvedIncident: r.incidentId ? openIncidentIds.has(r.incidentId) : false,
			needsReview: r.followUpRequired && !r.acknowledged,
			source: 'radio',
			typeTag: r.priority
		});
	}

	for (const e of input.eventLog) {
		entries.push({
			id: e.id,
			kind: 'event',
			table: 'eventLog',
			captureTime: e.captureTime,
			effectiveTime: e.effectiveTime,
			reportedTime: e.reportedTime ?? null,
			receivedTime: null,
			sequence: e.sequence,
			heatId: e.heatId ?? null,
			participantId: null,
			boatNumbers: [],
			checkpointName: '',
			title: `Event — ${e.kind}`,
			detail: e.message,
			voided: e.voided,
			incidentId: e.incidentId ?? null,
			unresolvedIncident: e.incidentId ? openIncidentIds.has(e.incidentId) : false,
			needsReview: false,
			source: 'operator',
			typeTag: e.kind
		});
	}

	for (const i of input.incidents) {
		entries.push({
			id: i.id,
			kind: 'incident',
			table: 'incidents',
			captureTime: i.captureTime,
			effectiveTime: i.effectiveTime,
			reportedTime: null,
			receivedTime: null,
			sequence: i.sequence,
			heatId: i.heatId ?? null,
			participantId: null,
			boatNumbers: i.boatNumbers,
			checkpointName: '',
			title: `Incident ${i.status === 'open' ? 'OPEN' : 'resolved'}${i.incidentType ? ` — ${i.incidentType}` : ''}`,
			detail: [i.severity, i.locationNotes, i.resolution].filter(Boolean).join(' · '),
			voided: i.voided,
			incidentId: i.id,
			unresolvedIncident: i.status === 'open' && !i.voided,
			needsReview: i.status === 'open' && !i.voided,
			source: 'operator',
			typeTag: i.severity || 'incident'
		});
	}

	for (const a of input.incidentActions) {
		entries.push({
			id: a.id,
			kind: 'incident-action',
			table: 'incidentActions',
			captureTime: a.captureTime,
			effectiveTime: a.effectiveTime,
			reportedTime: a.reportedTime ?? null,
			receivedTime: null,
			sequence: a.sequence,
			heatId: null,
			participantId: null,
			boatNumbers: [],
			checkpointName: '',
			title: 'Incident action',
			detail: a.text,
			voided: a.voided,
			incidentId: a.incidentId,
			unresolvedIncident: openIncidentIds.has(a.incidentId),
			needsReview: false,
			source: 'operator',
			typeTag: 'action'
		});
	}

	for (const h of input.heats) {
		if (h.closedAt) {
			entries.push({
				id: `${h.id}-closed`,
				kind: 'heat-transition',
				table: 'heats',
				captureTime: h.closedAt,
				effectiveTime: h.closedAt,
				reportedTime: null,
				receivedTime: null,
				sequence: Number.MAX_SAFE_INTEGER - 1,
				heatId: h.id,
				participantId: null,
				boatNumbers: [],
				checkpointName: '',
				title: `Heat closed — ${h.name}`,
				detail: `Administrative close by ${h.closedBy ?? 'operator'}. No observations were created or filled in.`,
				voided: false,
				incidentId: null,
				unresolvedIncident: false,
				needsReview: false,
				source: 'operator',
				typeTag: 'close'
			});
		}
	}

	return entries.sort((a, b) => a.effectiveTime - b.effectiveTime || a.sequence - b.sequence);
}

export function filterTimeline(
	entries: TimelineEntry[],
	filters: TimelineFilters
): TimelineEntry[] {
	const text = filters.text?.trim().toLowerCase() ?? '';
	return entries.filter((e) => {
		if (!filters.includeVoided && e.voided) return false;
		if (filters.heatId && e.heatId !== filters.heatId) return false;
		if (filters.kinds && filters.kinds.length > 0 && !filters.kinds.includes(e.kind)) return false;
		if (filters.checkpointName && e.checkpointName !== filters.checkpointName) return false;
		if (filters.boatNumber) {
			const wanted = filters.boatNumber.trim();
			if (!e.boatNumbers.some((b) => b === wanted)) return false;
		}
		if (filters.unresolvedIncidentsOnly && !e.unresolvedIncident) return false;
		if (filters.needsReviewOnly && !e.needsReview) return false;
		if (text && !`${e.title} ${e.detail}`.toLowerCase().includes(text)) return false;
		return true;
	});
}
