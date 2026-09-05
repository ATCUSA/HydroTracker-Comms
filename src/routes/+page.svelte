<script lang="ts">
	import { base } from '$app/paths';
	import { app } from '$lib/stores/app.svelte';
	import { saveQueue } from '$lib/stores/saveQueue.svelte';
	import CaptureButton from '$lib/components/CaptureButton.svelte';
	import BoatChips from '$lib/components/BoatChips.svelte';
	import {
		beginCapture,
		captureEventLog,
		captureMassStart,
		captureObservation,
		captureRadio,
		assignObservation
	} from '$lib/services/capture';
	import { formatTimeHundredths } from '$lib/time/clock';
	import { DIRECTION_LABELS } from '$lib/domain/legs';
	import { QUICK_PHRASE_DISCLAIMER } from '$lib/domain/phrases';
	import type { Direction, Id } from '$lib/domain/types';
	import type { Instant as ClockInstant } from '$lib/time/clock';

	// Capture options. All are optional: the default path is a single tap that
	// writes a timestamp with no racer attached.
	let selectedParticipant = $state<Id | null>(null);
	let classFilter = $state('');
	let customBoat = $state('');
	let notes = $state('');
	let uncertain = $state(false);
	let directionOverride = $state<Direction | ''>('');
	let massSelection = $state<Id[]>([]);
	let showMassStart = $state(false);
	let radioOpen = $state(false);
	let radioText = $state('');
	let radioFrom = $state('');
	let radioBoats = $state('');
	let radioPriority = $state<'routine' | 'priority' | 'emergency'>('routine');
	let checkpointPassOpen = $state(false);
	let checkpointId = $state<Id | ''>('');
	let checkpointBoat = $state('');
	let noteOpen = $state(false);
	let noteText = $state('');
	let lastMessage = $state<string | null>(null);

	const classes = $derived(
		Array.from(
			new Set(
				app.participants
					.map((p) => p.className || app.racerById(p.racerId)?.className || '')
					.filter(Boolean)
			)
		).sort()
	);

	const ready = $derived(Boolean(app.eventId && app.sessionId));
	const locked = $derived(app.readOnlyBecauseOtherTab);

	const currentDirection = $derived<Direction>(
		(directionOverride || app.leg?.direction || 'unknown') as Direction
	);

	/** Options shared by every pass-like capture on this screen. */
	function common() {
		return {
			participantId: selectedParticipant,
			unassignedBoatText: selectedParticipant ? null : customBoat.trim() || null,
			direction: currentDirection,
			notes: notes.trim(),
			uncertainIdentification: uncertain
		};
	}

	/**
	 * Clears only the per-capture fields. Selection and filters survive so the
	 * operator can fire repeatedly without re-choosing anything.
	 */
	function clearAfterCapture() {
		customBoat = '';
		notes = '';
		uncertain = false;
	}

	async function record(instant: ClockInstant, type: 'pass' | 'start' | 'finish' | 'sweep') {
		const draft =
			type === 'sweep'
				? {
						type,
						direction: currentDirection,
						notes: notes.trim(),
						participantId: null,
						unassignedBoatText: null
					}
				: { type, ...common() };
		const ok = await captureObservation(instant, draft);
		lastMessage = ok
			? `${type} recorded at ${formatTimeHundredths(instant.epoch, app.timezone)}`
			: `${type} FAILED to save — see the banner above`;
		if (ok) clearAfterCapture();
	}

	async function recordHeatComplete(instant: ClockInstant) {
		const ok = await captureObservation(instant, {
			type: 'heat-complete',
			source: 'radio',
			participantId: null,
			unassignedBoatText: null,
			notes: notes.trim()
		});
		lastMessage = ok
			? 'Heat-complete radio call recorded. It does not close the heat or fill in any missing observation.'
			: 'Heat-complete call FAILED to save.';
		if (ok) clearAfterCapture();
	}

	async function recordMassStart(instant: ClockInstant) {
		if (massSelection.length === 0) {
			lastMessage = 'Select the boats included in the mass start first.';
			return;
		}
		const ok = await captureMassStart(instant, massSelection, {
			direction: currentDirection,
			notes: notes.trim()
		});
		lastMessage = ok
			? `Mass start recorded for ${massSelection.length} boat(s) with one shared time.`
			: 'Mass start FAILED to save.';
		if (ok) {
			massSelection = [];
			showMassStart = false;
			clearAfterCapture();
		}
	}

	async function submitRadio(instant: ClockInstant) {
		const ok = await captureRadio(instant, {
			direction: 'received',
			fromParty: radioFrom.trim(),
			message: radioText.trim(),
			boatNumbers: radioBoats
				.split(/[\s,]+/)
				.map((s) => s.trim())
				.filter(Boolean),
			priority: radioPriority,
			heatId: app.heatId
		});
		lastMessage = ok ? 'Radio message logged.' : 'Radio message FAILED to save.';
		if (ok) {
			radioText = '';
			radioBoats = '';
			radioFrom = '';
			radioPriority = 'routine';
			radioOpen = false;
		}
	}

	async function submitCheckpointPass(instant: ClockInstant) {
		const ok = await captureObservation(instant, {
			type: 'checkpoint-pass',
			source: 'radio',
			reportingCheckpointId: checkpointId || null,
			checkpointName: app.checkpoints.find((c) => c.id === checkpointId)?.name ?? '',
			unassignedBoatText: checkpointBoat.trim() || null,
			participantId: null,
			notes: notes.trim()
		});
		lastMessage = ok
			? 'Checkpoint report logged with the time you received it. Add the reported occurrence time later if given.'
			: 'Checkpoint report FAILED to save.';
		if (ok) {
			checkpointBoat = '';
			checkpointPassOpen = false;
			clearAfterCapture();
		}
	}

	async function submitNote(instant: ClockInstant) {
		const ok = await captureEventLog(instant, 'note', noteText.trim());
		lastMessage = ok ? 'Event logged.' : 'Event log entry FAILED to save.';
		if (ok) {
			noteText = '';
			noteOpen = false;
		}
	}

	async function quickPhrase(instant: ClockInstant, text: string) {
		const ok = await captureEventLog(instant, 'status', text);
		lastMessage = ok ? `Logged: ${text}` : `"${text}" FAILED to save.`;
	}

	function toggleMass(id: Id) {
		massSelection = massSelection.includes(id)
			? massSelection.filter((x) => x !== id)
			: [...massSelection, id];
	}

	async function assignTo(observationId: Id, participantId: Id | null, text: string) {
		await assignObservation(observationId, participantId, { unassignedBoatText: text || null });
	}
</script>

<svelte:head><title>Live — Jet Boat Safety Log</title></svelte:head>

{#if !ready}
	<div class="notice warn">
		No event and station session yet. <a href="{base}/setup">Open Setup</a> to name the event, the checkpoint,
		and the operator before logging.
	</div>
{/if}

<CaptureButton
	variant="huge"
	label="Record pass at this checkpoint"
	disabled={!ready || locked}
	onCapture={(i) => record(i, 'pass')}
>
	RECORD PASS
	<br />
	<span class="sub"
		>{selectedParticipant
			? `Boat ${app.boatNumberFor(selectedParticipant)}`
			: customBoat
				? `Boat ${customBoat}`
				: 'Unassigned — add the boat later'}</span
	>
</CaptureButton>

{#if lastMessage}
	<p class="small" class:bad={lastMessage.includes('FAILED')} aria-live="polite">{lastMessage}</p>
{/if}

<div class="quick no-print">
	<CaptureButton
		label="Start heard"
		disabled={!ready || locked}
		onCapture={(i) => record(i, 'start')}
	/>
	<CaptureButton
		label="Finish heard"
		disabled={!ready || locked}
		onCapture={(i) => record(i, 'finish')}
	/>
	<CaptureButton label="Sweep" disabled={!ready || locked} onCapture={(i) => record(i, 'sweep')} />
	<CaptureButton
		label="Heat complete call"
		disabled={!ready || locked}
		onCapture={recordHeatComplete}
	/>
	<button type="button" onclick={() => (radioOpen = !radioOpen)} disabled={!ready || locked}>
		Radio…
	</button>
	<button
		type="button"
		onclick={() => (checkpointPassOpen = !checkpointPassOpen)}
		disabled={!ready || locked}
	>
		Checkpoint report…
	</button>
	<button type="button" onclick={() => (noteOpen = !noteOpen)} disabled={!ready || locked}>
		Event note…
	</button>
	<button
		type="button"
		onclick={() => (showMassStart = !showMassStart)}
		disabled={!ready || locked}
	>
		Mass start…
	</button>
</div>

<div class="card">
	<h3>Capture options</h3>
	<div class="row">
		<div class="field">
			<label for="leg-select">Leg</label>
			<select
				id="leg-select"
				value={app.legId ?? ''}
				onchange={(e) => app.setLeg(e.currentTarget.value || null)}
			>
				<option value="">— none —</option>
				{#each app.legs as leg (leg.id)}
					<option value={leg.id}>{leg.name} ({leg.direction})</option>
				{/each}
			</select>
		</div>
		<div class="field">
			<label for="dir-select">Direction</label>
			<select id="dir-select" bind:value={directionOverride}>
				<option value="">Use leg default ({app.leg?.direction ?? 'unknown'})</option>
				{#each Object.entries(DIRECTION_LABELS) as [value, label] (value)}
					<option {value}>{label}</option>
				{/each}
			</select>
		</div>
		{#if classes.length > 0}
			<div class="field">
				<label for="class-filter">Class filter</label>
				<select id="class-filter" bind:value={classFilter}>
					<option value="">All classes</option>
					{#each classes as cls (cls)}
						<option value={cls}>{cls}</option>
					{/each}
				</select>
			</div>
		{/if}
	</div>
	<div class="row">
		<div class="field">
			<label for="custom-boat">Boat number (letters allowed)</label>
			<input
				id="custom-boat"
				bind:value={customBoat}
				inputmode="text"
				autocomplete="off"
				autocapitalize="characters"
				placeholder="e.g. 07B"
				oninput={() => (selectedParticipant = null)}
			/>
		</div>
		<div class="field">
			<label for="obs-notes">Observation notes</label>
			<input id="obs-notes" bind:value={notes} placeholder="Optional" />
		</div>
		<div class="field" style="flex: 0 0 auto">
			<label for="uncertain">Uncertain ID</label>
			<button
				id="uncertain"
				type="button"
				class:primary={uncertain}
				aria-pressed={uncertain}
				onclick={() => (uncertain = !uncertain)}>{uncertain ? 'Uncertain' : 'Certain'}</button
			>
		</div>
	</div>
	<p class="small muted">
		Capturing with no boat selected is the normal path: the time is saved immediately and the boat
		can be attached afterwards.
	</p>
</div>

<div class="card">
	<h3>Starting order {selectedParticipant ? '(one selected)' : ''}</h3>
	<BoatChips
		participants={app.participants}
		selected={selectedParticipant}
		{classFilter}
		onPick={(id) => {
			selectedParticipant = selectedParticipant === id ? null : id;
			customBoat = '';
		}}
	/>
</div>

{#if showMassStart}
	<div class="card">
		<h3>Mass start — select participants</h3>
		<p class="small muted">
			One shared timestamp is linked to each selected boat. Boats not selected get nothing.
		</p>
		<BoatChips
			participants={app.participants}
			multi={massSelection}
			{classFilter}
			onPick={toggleMass}
		/>
		<div class="row tight" style="margin-top:0.6rem">
			<CaptureButton
				variant="primary"
				label={`Record mass start for ${massSelection.length} boat(s)`}
				disabled={massSelection.length === 0 || locked}
				onCapture={recordMassStart}
			/>
			<button type="button" class="ghost" onclick={() => (massSelection = [])}>Clear</button>
		</div>
	</div>
{/if}

{#if radioOpen}
	<div class="card">
		<h3>Radio message received</h3>
		<div class="field">
			<label for="radio-from">From</label>
			<input id="radio-from" bind:value={radioFrom} placeholder="Race control / Checkpoint 3" />
		</div>
		<div class="field">
			<label for="radio-boats">Boat number(s)</label>
			<input id="radio-boats" bind:value={radioBoats} placeholder="Space or comma separated" />
		</div>
		<div class="field">
			<label for="radio-text">Message</label>
			<textarea id="radio-text" bind:value={radioText}></textarea>
		</div>
		<div class="field">
			<label for="radio-priority">Priority</label>
			<select id="radio-priority" bind:value={radioPriority}>
				<option value="routine">Routine</option>
				<option value="priority">Priority</option>
				<option value="emergency">Emergency</option>
			</select>
		</div>
		<CaptureButton variant="primary" label="Log radio message" onCapture={submitRadio} />
	</div>
{/if}

{#if checkpointPassOpen}
	<div class="card">
		<h3>Radio checkpoint pass</h3>
		<p class="small muted">
			Records the time you received the call. Any actual occurrence time the station gives you can
			be added later from the Timeline.
		</p>
		<div class="row">
			<div class="field">
				<label for="cp-select">Reporting checkpoint</label>
				<select id="cp-select" bind:value={checkpointId}>
					<option value="">— choose —</option>
					{#each app.checkpoints as cp (cp.id)}
						<option value={cp.id}
							>{cp.name}{cp.expectedToReport ? '' : ' (does not normally report)'}</option
						>
					{/each}
				</select>
			</div>
			<div class="field">
				<label for="cp-boat">Boat</label>
				<input id="cp-boat" bind:value={checkpointBoat} autocapitalize="characters" />
			</div>
		</div>
		<CaptureButton
			variant="primary"
			label="Log checkpoint report"
			onCapture={submitCheckpointPass}
		/>
	</div>
{/if}

{#if noteOpen}
	<div class="card">
		<h3>Event note</h3>
		<div class="field">
			<label for="note-text">What happened</label>
			<textarea id="note-text" bind:value={noteText}></textarea>
		</div>
		<CaptureButton variant="primary" label="Log event" onCapture={submitNote} />
	</div>
{/if}

<div class="card no-print">
	<h3>Quick phrases</h3>
	<p class="small muted">{QUICK_PHRASE_DISCLAIMER}</p>
	<div class="phrases">
		{#each app.quickPhrases as phrase (phrase.id)}
			<CaptureButton
				variant={phrase.group === 'emergency' ? 'danger' : 'normal'}
				label={phrase.text}
				disabled={!ready || locked}
				onCapture={(i) => quickPhrase(i, phrase.text)}
			/>
		{/each}
	</div>
</div>

{#if app.unassignedObservations.length > 0}
	<div class="card">
		<h3>Unassigned captures ({app.unassignedObservations.length})</h3>
		<p class="small muted">
			In capture order. Each keeps its own time; assigning one never disturbs the others.
		</p>
		<ul class="plain">
			{#each app.unassignedObservations as obs (obs.id)}
				<li class="unassigned">
					<span class="mono">{formatTimeHundredths(obs.effectiveTime, app.timezone)}</span>
					<span class="badge dim">{obs.type}</span>
					<span class="badge dim">{obs.direction}</span>
					<select
						aria-label="Assign boat to this record"
						onchange={(e) => assignTo(obs.id, e.currentTarget.value || null, '')}
					>
						<option value="">Assign boat…</option>
						{#each app.participants as p (p.id)}
							<option value={p.id}>{app.racerById(p.racerId)?.boatNumber}</option>
						{/each}
					</select>
				</li>
			{/each}
		</ul>
	</div>
{/if}

{#if saveQueue.entries.length > 0}
	<div class="card no-print">
		<h3>Save log</h3>
		<ul class="plain small">
			{#each saveQueue.entries.slice(-8).reverse() as entry (entry.id)}
				<li>
					<span class="mono">{formatTimeHundredths(entry.captureTime, app.timezone)}</span>
					<span
						class="badge"
						class:good={entry.state === 'saved'}
						class:warn={entry.state === 'pending'}
						class:bad={entry.state === 'failed'}>{entry.state}</span
					>
					{entry.label}
					{#if entry.state === 'failed'}
						<button class="small" onclick={() => saveQueue.attempt(entry.id)}>Retry</button>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.sub {
		display: block;
		font-size: 0.85rem;
		font-weight: 600;
		opacity: 0.75;
		letter-spacing: 0;
	}
	.quick {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.4rem;
		margin: 0.6rem 0 0.9rem;
	}
	.phrases {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.4rem;
	}
	.unassigned {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.3rem 0;
		border-bottom: 1px solid var(--line);
	}
	.unassigned select {
		width: auto;
		min-width: 9rem;
		min-height: 2.6rem;
	}
	.bad {
		color: var(--bad);
	}
</style>
