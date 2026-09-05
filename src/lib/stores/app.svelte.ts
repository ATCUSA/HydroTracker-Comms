import { liveQuery, type Observable } from 'dexie';
import { getDb } from '$lib/db/db';
import { SETTINGS_KEYS, getSetting, setSetting } from '$lib/db/settings';
import { getDeviceId, newId } from '$lib/domain/ids';
import {
	CLOCK_DRIFT_THRESHOLD_MS,
	captureInstant,
	clockDriftMs,
	deviceTimezone,
	nowMs,
	type Instant
} from '$lib/time/clock';
import type {
	CoordinateFormat,
	EventLogEntry,
	Heat,
	HeatParticipant,
	Id,
	Incident,
	IncidentAction,
	Leg,
	Observation,
	RaceEvent,
	Racer,
	RadioMessage,
	ReportingCheckpoint,
	StationSession
} from '$lib/domain/types';
import { buildAccountability, type AccountabilityResult } from '$lib/domain/accountability';
import { buildReviewPrompts, type ReviewPrompt } from '$lib/domain/review';
import { DEFAULT_QUICK_PHRASES, type QuickPhrase } from '$lib/domain/phrases';

function track<T>(query: () => Promise<T>, initial: T) {
	const holder = $state<{ value: T; loaded: boolean }>({ value: initial, loaded: false });
	if (typeof window !== 'undefined') {
		const obs = liveQuery(query) as Observable<T>;
		obs.subscribe({
			next: (value) => {
				holder.value = value;
				holder.loaded = true;
			},
			error: (err) => console.error('liveQuery failed', err)
		});
	}
	return holder;
}

/**
 * Central reactive context. Everything here reads from IndexedDB through
 * liveQuery, so a write from any part of the app (or another tab) is reflected
 * without manual refresh plumbing.
 */
export class AppState {
	deviceId = getDeviceId();
	tabId = newId('tab-');

	eventId = $state<Id | null>(null);
	sessionId = $state<Id | null>(null);
	heatId = $state<Id | null>(null);
	legId = $state<Id | null>(null);

	coordinateFormat = $state<CoordinateFormat>('ddm');
	overdueThresholdMs = $state<number | null>(null);
	quickPhrases = $state<QuickPhrase[]>(DEFAULT_QUICK_PHRASES);
	contextLoaded = $state(false);

	/** Wall-clock reference taken when the session screen first loaded. */
	clockReference: Instant = captureInstant();
	clockDrift = $state<number | null>(null);
	clockAnomalyLogged = $state(false);

	/** Set when another tab holds the logging lock. */
	readOnlyBecauseOtherTab = $state(false);

	#events = track<RaceEvent[]>(() => getDb().events.toArray(), []);
	#sessions = track<StationSession[]>(() => getDb().sessions.toArray(), []);
	#racers = track<Racer[]>(() => getDb().racers.toArray(), []);
	#heats = track<Heat[]>(() => getDb().heats.toArray(), []);
	#legs = track<Leg[]>(() => getDb().legs.toArray(), []);
	#participants = track<HeatParticipant[]>(() => getDb().participants.toArray(), []);
	#checkpoints = track<ReportingCheckpoint[]>(() => getDb().checkpoints.toArray(), []);
	#observations = track<Observation[]>(() => getDb().observations.toArray(), []);
	#radio = track<RadioMessage[]>(() => getDb().radio.toArray(), []);
	#eventLog = track<EventLogEntry[]>(() => getDb().eventLog.toArray(), []);
	#incidents = track<Incident[]>(() => getDb().incidents.toArray(), []);
	#incidentActions = track<IncidentAction[]>(() => getDb().incidentActions.toArray(), []);

	get allEvents(): RaceEvent[] {
		return this.#events.value;
	}
	get event(): RaceEvent | undefined {
		return this.#events.value.find((e) => e.id === this.eventId);
	}
	get session(): StationSession | undefined {
		return this.#sessions.value.find((s) => s.id === this.sessionId);
	}
	get sessions(): StationSession[] {
		return this.#sessions.value.filter((s) => s.eventId === this.eventId);
	}
	get timezone(): string {
		return this.event?.timezone ?? deviceTimezone();
	}
	get racers(): Racer[] {
		return this.#racers.value
			.filter((r) => r.eventId === this.eventId && !r.voided)
			.sort((a, b) => a.boatNumber.localeCompare(b.boatNumber, undefined, { numeric: true }));
	}
	get heats(): Heat[] {
		return this.#heats.value
			.filter((h) => h.eventId === this.eventId && !h.voided)
			.sort((a, b) => a.sortIndex - b.sortIndex);
	}
	get heat(): Heat | undefined {
		return this.#heats.value.find((h) => h.id === this.heatId);
	}
	get legs(): Leg[] {
		return this.#legs.value
			.filter((l) => l.heatId === this.heatId && !l.voided)
			.sort((a, b) => a.sortIndex - b.sortIndex);
	}
	legsOf(heatId: Id): Leg[] {
		return this.#legs.value
			.filter((l) => l.heatId === heatId && !l.voided)
			.sort((a, b) => a.sortIndex - b.sortIndex);
	}
	get leg(): Leg | undefined {
		return this.#legs.value.find((l) => l.id === this.legId);
	}
	get participants(): HeatParticipant[] {
		return this.#participants.value
			.filter((p) => p.heatId === this.heatId && !p.voided)
			.sort((a, b) => a.startOrder - b.startOrder);
	}
	participantsOf(heatId: Id): HeatParticipant[] {
		return this.#participants.value
			.filter((p) => p.heatId === heatId && !p.voided)
			.sort((a, b) => a.startOrder - b.startOrder);
	}
	get checkpoints(): ReportingCheckpoint[] {
		return this.#checkpoints.value
			.filter((c) => c.eventId === this.eventId && !c.voided)
			.sort((a, b) => a.sortIndex - b.sortIndex);
	}
	get observations(): Observation[] {
		return this.#observations.value
			.filter((o) => o.eventId === this.eventId)
			.sort((a, b) => a.sequence - b.sequence);
	}
	get heatObservations(): Observation[] {
		return this.observations.filter((o) => o.heatId === this.heatId);
	}
	get unassignedObservations(): Observation[] {
		return this.observations.filter(
			(o) => !o.voided && !o.participantId && o.type !== 'sweep' && o.type !== 'heat-complete'
		);
	}
	get radioMessages(): RadioMessage[] {
		return this.#radio.value
			.filter((r) => r.eventId === this.eventId)
			.sort((a, b) => a.sequence - b.sequence);
	}
	get eventLogEntries(): EventLogEntry[] {
		return this.#eventLog.value
			.filter((e) => e.eventId === this.eventId)
			.sort((a, b) => a.sequence - b.sequence);
	}
	get incidents(): Incident[] {
		return this.#incidents.value
			.filter((i) => i.eventId === this.eventId)
			.sort((a, b) => b.sequence - a.sequence);
	}
	get openIncidents(): Incident[] {
		return this.incidents.filter((i) => i.status === 'open' && !i.voided);
	}
	get incidentActions(): IncidentAction[] {
		return this.#incidentActions.value.sort((a, b) => a.sequence - b.sequence);
	}
	actionsFor(incidentId: Id): IncidentAction[] {
		return this.incidentActions.filter((a) => a.incidentId === incidentId && !a.voided);
	}

	racerById(id: Id): Racer | undefined {
		return this.#racers.value.find((r) => r.id === id);
	}
	participantById(id: Id): HeatParticipant | undefined {
		return this.#participants.value.find((p) => p.id === id);
	}
	boatNumberFor(participantId: Id | null | undefined): string | null {
		if (!participantId) return null;
		const p = this.participantById(participantId);
		if (!p) return null;
		return this.racerById(p.racerId)?.boatNumber ?? null;
	}

	get accountability(): AccountabilityResult | null {
		const heat = this.heat;
		if (!heat) return null;
		return buildAccountability({
			heat,
			legs: this.legs,
			participants: this.participants,
			racers: this.racers,
			observations: this.heatObservations,
			checkpoints: this.checkpoints
		});
	}

	get reviewPrompts(): ReviewPrompt[] {
		return buildReviewPrompts({
			heat: this.heat,
			legs: this.legs,
			observations: this.heatId ? this.heatObservations : this.observations,
			accountability: this.accountability ?? undefined,
			overdueThresholdMs: this.overdueThresholdMs,
			now: nowMs(),
			clockDriftMs: this.clockDrift
		});
	}

	get writeContext() {
		return {
			eventId: this.eventId ?? '',
			operatorName: this.session?.operatorName ?? 'unknown operator',
			deviceId: this.deviceId
		};
	}

	async loadContext(): Promise<void> {
		this.eventId = await getSetting<Id | null>(SETTINGS_KEYS.currentEventId, null);
		this.sessionId = await getSetting<Id | null>(SETTINGS_KEYS.currentSessionId, null);
		this.heatId = await getSetting<Id | null>(SETTINGS_KEYS.currentHeatId, null);
		this.legId = await getSetting<Id | null>(SETTINGS_KEYS.currentLegId, null);
		this.coordinateFormat = await getSetting<CoordinateFormat>(
			SETTINGS_KEYS.coordinateFormat,
			'ddm'
		);
		this.overdueThresholdMs = await getSetting<number | null>(
			SETTINGS_KEYS.overdueThresholdMs,
			null
		);
		this.quickPhrases = await getSetting<QuickPhrase[]>(
			SETTINGS_KEYS.quickPhrases,
			DEFAULT_QUICK_PHRASES
		);
		this.contextLoaded = true;
	}

	async setEvent(id: Id | null): Promise<void> {
		this.eventId = id;
		await setSetting(SETTINGS_KEYS.currentEventId, id);
	}
	async setSession(id: Id | null): Promise<void> {
		this.sessionId = id;
		await setSetting(SETTINGS_KEYS.currentSessionId, id);
	}
	async setHeat(id: Id | null): Promise<void> {
		this.heatId = id;
		await setSetting(SETTINGS_KEYS.currentHeatId, id);
		const legs = id ? this.legsOf(id) : [];
		await this.setLeg(legs[0]?.id ?? null);
	}
	async setLeg(id: Id | null): Promise<void> {
		this.legId = id;
		await setSetting(SETTINGS_KEYS.currentLegId, id);
	}
	async setCoordinateFormat(format: CoordinateFormat): Promise<void> {
		this.coordinateFormat = format;
		await setSetting(SETTINGS_KEYS.coordinateFormat, format);
	}
	async setOverdueThreshold(ms: number | null): Promise<void> {
		this.overdueThresholdMs = ms;
		await setSetting(SETTINGS_KEYS.overdueThresholdMs, ms);
	}
	async setQuickPhrases(phrases: QuickPhrase[]): Promise<void> {
		this.quickPhrases = phrases;
		await setSetting(SETTINGS_KEYS.quickPhrases, phrases);
	}

	/**
	 * Compares wall-clock against monotonic elapsed time. A jump is logged and
	 * surfaced for review; historical records are never rewritten.
	 */
	async checkClockDrift(): Promise<void> {
		const drift = clockDriftMs(this.clockReference, captureInstant());
		this.clockDrift = Math.abs(drift) >= CLOCK_DRIFT_THRESHOLD_MS ? drift : null;
		if (this.clockDrift !== null && !this.clockAnomalyLogged && this.eventId) {
			this.clockAnomalyLogged = true;
			await getDb().clockAnomalies.add({
				id: newId('clk-'),
				eventId: this.eventId,
				detectedAt: nowMs(),
				driftMs: drift,
				acknowledgedAt: null,
				note: ''
			});
		}
	}
}

export const app = new AppState();
