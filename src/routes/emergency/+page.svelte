<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { app } from '$lib/stores/app.svelte';
	import { geoWatcher, wakeLock, GEO_STATUS_LABELS } from '$lib/services/geolocation.svelte';
	import {
		addIncidentAction,
		reopenIncident,
		resolveIncident,
		setIncidentLocation,
		updateIncident
	} from '$lib/services/incidents';
	import { beginCapture } from '$lib/services/capture';
	import CaptureButton from '$lib/components/CaptureButton.svelte';
	import {
		FORMAT_LABELS,
		LOCATION_SOURCE_LABELS,
		accuracyLabel,
		buildResponderText,
		formatCoordinates,
		isStale,
		parseCoordinateText
	} from '$lib/geo/coordinates';
	import { formatAge, formatDateTime, formatTimeHundredths, nowMs } from '$lib/time/clock';
	import { QUICK_PHRASE_DISCLAIMER } from '$lib/domain/phrases';
	import type { CoordinateFormat, Id, Incident, RecordedLocation } from '$lib/domain/types';

	let selectedId = $state<Id | null>(null);
	let manualCoords = $state('');
	let actionText = $state('');
	let copyState = $state<string | null>(null);
	let locationError = $state<string | null>(null);
	let resolutionText = $state('');

	const incident = $derived<Incident | undefined>(
		app.incidents.find((i) => i.id === (selectedId ?? page.url.searchParams.get('id'))) ??
			app.openIncidents[0] ??
			app.incidents[0]
	);

	onMount(() => {
		// Watching starts here, in the foreground, only while this screen is open.
		geoWatcher.start();
		if (app.quickPhrases.length > 0) wakeLock.request();
		return () => {
			// Battery-conscious: stop as soon as the operator leaves tracking mode.
			geoWatcher.stop();
			wakeLock.release();
		};
	});

	function field(name: keyof Incident, value: string) {
		if (!incident) return;
		updateIncident({ ...incident, [name]: value } as Incident, `Updated ${String(name)}`);
	}

	async function useDeviceFix() {
		locationError = null;
		const snapshot = geoWatcher.snapshot();
		if (!snapshot) {
			locationError =
				'No device fix is available yet. The incident location is left as pending rather than guessed.';
			return;
		}
		if (!incident) return;
		await setIncidentLocation(
			incident,
			{ ...snapshot, source: 'device-fix', capturedAt: nowMs() },
			'Incident location set to current device position'
		);
	}

	async function useManual() {
		locationError = null;
		const parsed = parseCoordinateText(manualCoords);
		if (!parsed) {
			locationError = 'Those coordinates could not be read. Nothing was changed.';
			return;
		}
		if (!incident) return;
		const location: RecordedLocation = {
			source: 'manual-entry',
			latitude: parsed.latitude,
			longitude: parsed.longitude,
			accuracyMeters: null,
			fixTime: null,
			capturedAt: nowMs()
		};
		await setIncidentLocation(incident, location, 'Incident location entered manually');
		manualCoords = '';
	}

	function responderText(kind: string, location: RecordedLocation | null): string {
		if (!location) return 'No location recorded.';
		return buildResponderText({
			locationType: kind,
			location,
			format: app.coordinateFormat,
			now: geoWatcher.tick,
			timeLabel: location.fixTime
				? formatDateTime(location.fixTime, app.timezone, true)
				: `not from a GPS fix (recorded ${formatDateTime(location.capturedAt, app.timezone, true)})`,
			stationLabel: `${app.session?.checkpointName ?? 'Checkpoint'} — safety boat ${app.session?.safetyBoatNumber ?? '?'}`
		});
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copyState = 'Copied to the clipboard.';
		} catch {
			copyState = 'Copy was blocked. Select the text and copy it by hand.';
		}
	}

	async function logAction(instant: ReturnType<typeof beginCapture>, text: string) {
		if (!incident || !text.trim()) return;
		await addIncidentAction(instant, incident.id, text.trim());
		actionText = '';
	}

	const formats: CoordinateFormat[] = ['dd', 'ddm', 'dms'];
</script>

<svelte:head><title>Emergency — Jet Boat Safety Log</title></svelte:head>

<h1>Emergency</h1>

{#if !incident}
	<div class="notice warn">
		No incident recorded yet. Press EMERGENCY in the bottom bar — the marker is written immediately,
		before any field is filled in.
	</div>
{:else}
	{#if app.incidents.length > 1}
		<div class="field no-print">
			<label for="inc-pick">Incident</label>
			<select
				id="inc-pick"
				value={incident.id}
				onchange={(e) => (selectedId = e.currentTarget.value)}
			>
				{#each app.incidents as i (i.id)}
					<option value={i.id}>
						{formatDateTime(i.captureTime, app.timezone)} — {i.status}{i.incidentType
							? ` — ${i.incidentType}`
							: ''}
					</option>
				{/each}
			</select>
		</div>
	{/if}

	<div class="card marker">
		<h2>
			Incident marker saved {formatDateTime(incident.captureTime, app.timezone, true)}
			<span class="badge" class:bad={incident.status === 'open'}>{incident.status}</span>
		</h2>
		<p class="small muted">
			Every field below is optional and can be filled in at any time while the incident is open.
		</p>
	</div>

	<div class="card">
		<h2>Locations</h2>
		<div class="field no-print">
			<label for="fmt">Coordinate format</label>
			<select
				id="fmt"
				value={app.coordinateFormat}
				onchange={(e) => app.setCoordinateFormat(e.currentTarget.value as CoordinateFormat)}
			>
				{#each formats as f (f)}<option value={f}>{FORMAT_LABELS[f]}</option>{/each}
			</select>
			<p class="small muted">
				No format is universally preferred by dispatch — read whichever they ask for. The number of
				digits shown is not a statement of accuracy.
			</p>
		</div>

		{#if locationError}<div class="notice bad">{locationError}</div>{/if}
		{#if copyState}<div class="notice good small">{copyState}</div>{/if}

		<section class="loc">
			<h3>1 · Incident location</h3>
			{#if incident.incidentLocation && incident.incidentLocation.latitude != null}
				<p class="mono big">
					{formatCoordinates(
						{
							latitude: incident.incidentLocation.latitude,
							longitude: incident.incidentLocation.longitude as number
						},
						app.coordinateFormat
					)}
				</p>
				<p class="small">
					{LOCATION_SOURCE_LABELS[incident.incidentLocation.source]} ·
					{accuracyLabel(incident.incidentLocation.accuracyMeters)} · recorded
					{formatTimeHundredths(incident.incidentLocation.capturedAt, app.timezone)}
				</p>
			{:else}
				<p class="warn">
					Pending — no coordinates recorded yet. Nothing has been invented in their place.
				</p>
			{/if}
			<div class="row tight no-print">
				<CaptureButton
					variant="primary"
					label="Set incident location to current position"
					onCapture={useDeviceFix}
				/>
				<button
					type="button"
					onclick={() =>
						copy(responderText('Incident location', incident.incidentLocation ?? null))}
				>
					Copy responder text
				</button>
			</div>
			<div class="row no-print">
				<div class="field">
					<label for="manual">Enter coordinates manually</label>
					<input
						id="manual"
						bind:value={manualCoords}
						placeholder="45 31.404 N  122 40.572 W"
						class="mono"
					/>
				</div>
				<div class="field" style="flex: 0 0 auto">
					<button type="button" onclick={useManual}>Save entered location</button>
				</div>
			</div>
			<p class="small muted">
				Live device movement never moves this. Only an explicit action here changes it, and each
				change is saved with its source and time.
			</p>
			<pre class="responder">{responderText(
					'Incident location',
					incident.incidentLocation ?? null
				)}</pre>
		</section>

		<section class="loc">
			<h3>2 · Current device location</h3>
			<p class="small">
				{GEO_STATUS_LABELS[geoWatcher.status]}
				{#if geoWatcher.errorMessage}<span class="muted"> — {geoWatcher.errorMessage}</span>{/if}
			</p>
			{#if geoWatcher.lastFix?.latitude != null}
				<p class="mono big">
					{formatCoordinates(
						{
							latitude: geoWatcher.lastFix.latitude,
							longitude: geoWatcher.lastFix.longitude as number
						},
						app.coordinateFormat
					)}
				</p>
				<p class="small">
					{accuracyLabel(geoWatcher.lastFix.accuracyMeters)} ·
					{geoWatcher.fixAgeMs !== null ? formatAge(geoWatcher.fixAgeMs) : 'age unknown'}
					{#if geoWatcher.isStale}<span class="badge bad">STALE</span>{/if}
				</p>
				<button
					type="button"
					class="no-print"
					onclick={() => copy(responderText('Current device location', geoWatcher.snapshot()))}
				>
					Copy responder text
				</button>
			{:else}
				<p class="warn">No fix yet. Logging is unaffected — GPS is optional.</p>
			{/if}
			<p class="small muted">
				Position updates only while this screen is in the foreground. The app does not track
				position with the screen locked or in the background.
			</p>
			<div class="row tight no-print">
				<button type="button" onclick={() => geoWatcher.restart()}>Reacquire fix</button>
				<button
					type="button"
					onclick={() => (wakeLock.active ? wakeLock.release() : wakeLock.request())}
				>
					{wakeLock.active ? 'Release screen wake lock' : 'Keep screen awake'}
				</button>
			</div>
			{#if wakeLock.message}<p class="small muted">{wakeLock.message}</p>{/if}
		</section>

		<section class="loc">
			<h3>3 · Saved checkpoint location</h3>
			{#if incident.checkpointLocation?.latitude != null}
				<p class="mono big">
					{formatCoordinates(
						{
							latitude: incident.checkpointLocation.latitude,
							longitude: incident.checkpointLocation.longitude as number
						},
						app.coordinateFormat
					)}
				</p>
				<p class="small">Reference position for this station, saved during setup.</p>
			{:else}
				<p class="muted small">No checkpoint coordinates were saved for this session.</p>
			{/if}
		</section>

		{#if incident.initialDeviceFix?.latitude != null}
			<section class="loc">
				<h3>Provenance — first device fix at activation</h3>
				<p class="mono small">
					{formatCoordinates(
						{
							latitude: incident.initialDeviceFix.latitude,
							longitude: incident.initialDeviceFix.longitude as number
						},
						app.coordinateFormat
					)}
					· {accuracyLabel(incident.initialDeviceFix.accuracyMeters)}
					{#if isStale(incident.initialDeviceFix.fixTime, incident.captureTime)}
						<span class="badge warn">was a cached fix</span>
					{:else}
						<span class="badge good">fresh at activation</span>
					{/if}
				</p>
			</section>
		{/if}
	</div>

	<div class="card">
		<h2>Incident details</h2>
		<div class="row">
			<div class="field">
				<label for="i-type">Incident type</label>
				<input
					id="i-type"
					value={incident.incidentType}
					onchange={(e) => field('incidentType', e.currentTarget.value)}
				/>
			</div>
			<div class="field">
				<label for="i-sev">Severity</label>
				<input
					id="i-sev"
					value={incident.severity}
					onchange={(e) => field('severity', e.currentTarget.value)}
				/>
			</div>
			<div class="field">
				<label for="i-boats">Boat(s)</label>
				<input
					id="i-boats"
					value={incident.boatNumbers.join(' ')}
					onchange={(e) =>
						incident &&
						updateIncident(
							{
								...incident,
								boatNumbers: e.currentTarget.value.split(/[\s,]+/).filter(Boolean)
							},
							'Updated boats involved'
						)}
				/>
			</div>
		</div>
		<div class="row">
			<div class="field">
				<label for="i-side">River side</label>
				<input
					id="i-side"
					value={incident.riverSide}
					onchange={(e) => field('riverSide', e.currentTarget.value)}
				/>
			</div>
			<div class="field">
				<label for="i-locnotes">Location notes</label>
				<input
					id="i-locnotes"
					value={incident.locationNotes}
					onchange={(e) => field('locationNotes', e.currentTarget.value)}
				/>
			</div>
		</div>
		<div class="field">
			<label for="i-hazards">Hazards</label>
			<textarea
				id="i-hazards"
				value={incident.hazards}
				onchange={(e) => field('hazards', e.currentTarget.value)}
			></textarea>
		</div>
		<div class="row">
			<div class="field">
				<label for="i-people">People involved</label>
				<textarea
					id="i-people"
					value={incident.peopleInvolved}
					onchange={(e) => field('peopleInvolved', e.currentTarget.value)}
				></textarea>
			</div>
			<div class="field">
				<label for="i-injuries">Reported injuries</label>
				<textarea
					id="i-injuries"
					value={incident.reportedInjuries}
					onchange={(e) => field('reportedInjuries', e.currentTarget.value)}
				></textarea>
			</div>
		</div>
		<div class="row">
			<div class="field">
				<label for="i-res">Resources</label>
				<textarea
					id="i-res"
					value={incident.resources}
					onchange={(e) => field('resources', e.currentTarget.value)}
				></textarea>
			</div>
			<div class="field">
				<label for="i-notif">Notifications made</label>
				<textarea
					id="i-notif"
					value={incident.notificationsMade}
					onchange={(e) => field('notificationsMade', e.currentTarget.value)}
				></textarea>
			</div>
		</div>
		<div class="field">
			<label for="i-follow">Follow-up</label>
			<textarea
				id="i-follow"
				value={incident.followUp}
				onchange={(e) => field('followUp', e.currentTarget.value)}
			></textarea>
		</div>
	</div>

	<div class="card">
		<h2>Actions</h2>
		<p class="small muted">{QUICK_PHRASE_DISCLAIMER}</p>
		<div class="phrases no-print">
			{#each app.quickPhrases.filter((p) => p.group === 'emergency') as phrase (phrase.id)}
				<CaptureButton
					variant="danger"
					label={phrase.text}
					onCapture={(i) => logAction(i, phrase.text)}
				/>
			{/each}
		</div>
		<div class="row no-print" style="margin-top:0.6rem">
			<div class="field">
				<label for="a-text">Custom action</label>
				<input id="a-text" bind:value={actionText} />
			</div>
			<div class="field" style="flex:0 0 auto">
				<CaptureButton
					variant="primary"
					label="Log action"
					onCapture={(i) => logAction(i, actionText)}
				/>
			</div>
		</div>
		<ul class="plain small">
			{#each app.actionsFor(incident.id) as action (action.id)}
				<li>
					<span class="mono">{formatTimeHundredths(action.effectiveTime, app.timezone)}</span> —
					{action.text}
				</li>
			{/each}
		</ul>
	</div>

	<div class="card">
		<h2>Resolution</h2>
		<div class="field">
			<label for="i-resolution">Resolution</label>
			<textarea id="i-resolution" bind:value={resolutionText} placeholder={incident.resolution}
			></textarea>
		</div>
		<div class="row tight">
			{#if incident.status === 'open'}
				<button
					type="button"
					class="primary"
					onclick={() =>
						incident && resolveIncident(incident, resolutionText || incident.resolution)}
				>
					Mark resolved and stop GPS tracking
				</button>
			{:else}
				<button type="button" onclick={() => incident && reopenIncident(incident)}
					>Reopen incident</button
				>
			{/if}
		</div>
		<p class="small muted">
			Resolving records what you observed and reported. It makes no claim about anyone's medical or
			physical condition.
		</p>
	</div>
{/if}

<style>
	.marker {
		border-color: var(--bad);
	}
	.loc {
		border-top: 1px solid var(--line);
		padding-top: 0.7rem;
		margin-top: 0.7rem;
	}
	.loc:first-of-type {
		border-top: none;
		margin-top: 0;
	}
	.big {
		font-size: 1.25rem;
		font-weight: 700;
		word-break: break-word;
	}
	.warn {
		color: var(--warn);
	}
	.responder {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0.6rem;
		font-family: ui-monospace, Menlo, Consolas, monospace;
		font-size: 0.78rem;
		white-space: pre-wrap;
		overflow-x: auto;
		user-select: all;
	}
	.phrases {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.4rem;
	}
</style>
