<script lang="ts">
	import { app } from '$lib/stores/app.svelte';
	import {
		buildTimeline,
		filterTimeline,
		type TimelineEntry,
		type TimelineKind
	} from '$lib/domain/timeline';
	import { formatDateTime, formatTimeHundredths, parseLocalTimeOnDay } from '$lib/time/clock';
	import {
		correctEntryTimes,
		correctObservation,
		restoreEntry,
		voidEntry,
		type TimelineTable
	} from '$lib/services/capture';
	import { revisionsFor } from '$lib/db/repo';
	import type { AuditRevision, Direction, Id } from '$lib/domain/types';
	import { DIRECTION_LABELS } from '$lib/domain/legs';

	let heatFilter = $state<Id | ''>('');
	let boatFilter = $state('');
	let checkpointFilter = $state('');
	let kindFilter = $state<TimelineKind | ''>('');
	let unresolvedOnly = $state(false);
	let reviewOnly = $state(false);
	let includeVoided = $state(false);
	let textFilter = $state('');

	let editing = $state<TimelineEntry | null>(null);
	let editTime = $state('');
	let editReported = $state('');
	let editParticipant = $state<Id | ''>('');
	let editHeat = $state<Id | ''>('');
	let editLeg = $state<Id | ''>('');
	let editDirection = $state<Direction>('unknown');
	let editNotes = $state('');
	let editReason = $state('');
	let editError = $state<string | null>(null);
	let history = $state<AuditRevision[]>([]);

	const entries = $derived(
		buildTimeline({
			observations: app.observations,
			radio: app.radioMessages,
			eventLog: app.eventLogEntries,
			incidents: app.incidents,
			incidentActions: app.incidentActions.filter((a) => a.eventId === app.eventId),
			heats: app.heats,
			boatNumberFor: (id) => app.boatNumberFor(id)
		})
	);

	const visible = $derived(
		filterTimeline(entries, {
			heatId: heatFilter || null,
			boatNumber: boatFilter,
			checkpointName: checkpointFilter,
			kinds: kindFilter ? [kindFilter] : undefined,
			unresolvedIncidentsOnly: unresolvedOnly,
			needsReviewOnly: reviewOnly,
			includeVoided,
			text: textFilter
		})
	);

	const checkpointNames = $derived(
		Array.from(new Set(entries.map((e) => e.checkpointName).filter(Boolean))).sort()
	);

	async function openEdit(entry: TimelineEntry) {
		editing = entry;
		editError = null;
		editReason = '';
		editTime = formatTimeHundredths(entry.effectiveTime, app.timezone);
		editReported = entry.reportedTime ? formatTimeHundredths(entry.reportedTime, app.timezone) : '';
		const obs = app.observations.find((o) => o.id === entry.id);
		editParticipant = (obs?.participantId as Id) ?? '';
		editHeat = (obs?.heatId as Id) ?? '';
		editLeg = (obs?.legId as Id) ?? '';
		editDirection = obs?.direction ?? 'unknown';
		editNotes = obs?.notes ?? '';
		history = await revisionsFor(entry.id);
	}

	/** Records the timeline can correct, void and restore. */
	const EDITABLE: TimelineTable[] = ['observations', 'radio', 'eventLog', 'incidentActions'];
	const isEditable = (table: string) => EDITABLE.includes(table as TimelineTable);

	async function saveEdit() {
		if (!editing) return;
		if (!editReason.trim()) {
			editError = 'Give a reason for the correction — it becomes part of the record.';
			return;
		}
		const effective = parseLocalTimeOnDay(editTime, editing.captureTime, app.timezone);
		if (editTime && effective === null) {
			editError = 'Time must look like HH:MM, HH:MM:SS or HH:MM:SS.hh.';
			return;
		}
		const reported = editReported
			? parseLocalTimeOnDay(editReported, editing.captureTime, app.timezone)
			: null;
		if (editReported && reported === null) {
			editError = 'Reported occurrence time must look like HH:MM, HH:MM:SS or HH:MM:SS.hh.';
			return;
		}
		const ok =
			editing.table === 'observations'
				? await correctObservation(
						editing.id,
						{
							effectiveTime: effective ?? editing.effectiveTime,
							reportedTime: reported,
							participantId: editParticipant || null,
							heatId: editHeat || null,
							legId: editLeg || null,
							direction: editDirection,
							notes: editNotes
						},
						editReason.trim()
					)
				: await correctEntryTimes(
						editing.table as 'radio' | 'eventLog' | 'incidentActions',
						editing.id,
						{
							effectiveTime: effective ?? editing.effectiveTime,
							reportedTime: reported
						},
						editReason.trim()
					);
		if (!ok) {
			editError = 'The correction did not save. It has not been applied.';
			return;
		}
		history = await revisionsFor(editing.id);
		editing = null;
	}

	async function onVoid(entry: TimelineEntry) {
		const reason = prompt('Reason for voiding this record? It stays reviewable and restorable.');
		if (reason === null) return;
		await voidEntry(entry.table as TimelineTable, entry.id, reason || 'No reason given');
	}

	async function onRestore(entry: TimelineEntry) {
		await restoreEntry(entry.table as TimelineTable, entry.id, 'Restored by operator');
	}

	const kinds: TimelineKind[] = [
		'observation',
		'radio',
		'event',
		'incident',
		'incident-action',
		'heat-transition'
	];
</script>

<svelte:head><title>Timeline — Jet Boat Safety Log</title></svelte:head>

<h1>Timeline</h1>

<div class="card no-print">
	<h3>Filters</h3>
	<div class="row">
		<div class="field">
			<label for="f-heat">Heat</label>
			<select id="f-heat" bind:value={heatFilter}>
				<option value="">All heats</option>
				{#each app.heats as heat (heat.id)}<option value={heat.id}>{heat.name}</option>{/each}
			</select>
		</div>
		<div class="field">
			<label for="f-boat">Boat</label>
			<input id="f-boat" bind:value={boatFilter} placeholder="Exact boat number" />
		</div>
		<div class="field">
			<label for="f-cp">Checkpoint</label>
			<select id="f-cp" bind:value={checkpointFilter}>
				<option value="">All checkpoints</option>
				{#each checkpointNames as name (name)}<option value={name}>{name}</option>{/each}
			</select>
		</div>
		<div class="field">
			<label for="f-kind">Type</label>
			<select id="f-kind" bind:value={kindFilter}>
				<option value="">All types</option>
				{#each kinds as kind (kind)}<option value={kind}>{kind}</option>{/each}
			</select>
		</div>
		<div class="field">
			<label for="f-text">Text</label>
			<input id="f-text" bind:value={textFilter} placeholder="Search titles and details" />
		</div>
	</div>
	<div class="row tight">
		<label class="inline"
			><input type="checkbox" bind:checked={unresolvedOnly} /> Unresolved incidents</label
		>
		<label class="inline"><input type="checkbox" bind:checked={reviewOnly} /> Needs review</label>
		<label class="inline"><input type="checkbox" bind:checked={includeVoided} /> Show voided</label>
	</div>
	<p class="small muted">Showing {visible.length} of {entries.length} entries.</p>
</div>

{#if app.reviewPrompts.length > 0}
	<div class="card no-print">
		<h3>Review prompts</h3>
		<ul class="plain small">
			{#each app.reviewPrompts as prompt (prompt.key)}
				<li class="prompt" class:attention={prompt.severity === 'attention'}>
					<strong>{prompt.title}</strong> — {prompt.detail}
				</li>
			{/each}
		</ul>
		<p class="small muted">
			Prompts are advisory. Nothing is changed on your behalf and nothing here blocks capture.
		</p>
	</div>
{/if}

<div class="card">
	<ul class="plain">
		{#each visible as entry (entry.id)}
			<li class="entry" class:voided={entry.voided}>
				<div class="times">
					<span class="mono strong">{formatTimeHundredths(entry.effectiveTime, app.timezone)}</span>
					{#if entry.effectiveTime !== entry.captureTime}
						<span class="small muted mono" title="Original capture time, never changed">
							captured {formatTimeHundredths(entry.captureTime, app.timezone)}
						</span>
					{/if}
					{#if entry.receivedTime && entry.receivedTime !== entry.effectiveTime}
						<span class="small muted mono"
							>received {formatTimeHundredths(entry.receivedTime, app.timezone)}</span
						>
					{/if}
					{#if entry.reportedTime}
						<span class="small muted mono"
							>reported {formatTimeHundredths(entry.reportedTime, app.timezone)}</span
						>
					{/if}
					<span class="small muted">#{entry.sequence}</span>
				</div>
				<div class="body">
					<div>
						<span class="badge dim">{entry.kind}</span>
						{#if entry.source === 'radio'}<span class="badge radio">radio</span>{/if}
						{#if entry.unresolvedIncident}<span class="badge bad">unresolved</span>{/if}
						{#if entry.needsReview}<span class="badge warn">review</span>{/if}
						{#if entry.voided}<span class="badge bad">voided</span>{/if}
						<strong>{entry.title}</strong>
					</div>
					{#if entry.detail}<div class="small">{entry.detail}</div>{/if}
				</div>
				<div class="actions no-print">
					{#if isEditable(entry.table)}
						<button class="small" onclick={() => openEdit(entry)}>Edit…</button>
						{#if entry.voided}
							<button class="small" onclick={() => onRestore(entry)}>Restore</button>
						{:else}
							<button class="small ghost" onclick={() => onVoid(entry)}>Void</button>
						{/if}
					{/if}
				</div>
			</li>
		{/each}
		{#if visible.length === 0}
			<li class="muted small">Nothing matches these filters.</li>
		{/if}
	</ul>
</div>

{#if editing}
	<div class="card edit">
		<h2>Correct record</h2>
		<p class="small muted">
			The original capture time ({formatDateTime(editing.captureTime, app.timezone, true)}) is
			permanent. A correction changes the effective time and details, and is recorded with your
			reason.
		</p>
		{#if editError}<div class="notice bad">{editError}</div>{/if}
		<div class="row">
			<div class="field">
				<label for="e-time">Effective time (HH:MM:SS.hh)</label>
				<input id="e-time" bind:value={editTime} class="mono" />
			</div>
			<div class="field">
				<label for="e-reported">Reported occurrence time (optional)</label>
				<input
					id="e-reported"
					bind:value={editReported}
					class="mono"
					placeholder="If given later"
				/>
			</div>
		</div>
		{#if editing.table === 'observations'}
			<div class="row">
				<div class="field">
					<label for="e-heat">Heat</label>
					<select id="e-heat" bind:value={editHeat}>
						<option value="">— none —</option>
						{#each app.heats as heat (heat.id)}<option value={heat.id}>{heat.name}</option>{/each}
					</select>
				</div>
				<div class="field">
					<label for="e-leg">Leg</label>
					<select id="e-leg" bind:value={editLeg}>
						<option value="">— none —</option>
						{#each editHeat ? app.legsOf(editHeat) : [] as leg (leg.id)}
							<option value={leg.id}>{leg.name}</option>
						{/each}
					</select>
				</div>
				<div class="field">
					<label for="e-boat">Boat</label>
					<select id="e-boat" bind:value={editParticipant}>
						<option value="">— unassigned —</option>
						{#each editHeat ? app.participantsOf(editHeat) : [] as p (p.id)}
							<option value={p.id}>{app.racerById(p.racerId)?.boatNumber}</option>
						{/each}
					</select>
				</div>
				<div class="field">
					<label for="e-dir">Direction</label>
					<select id="e-dir" bind:value={editDirection}>
						{#each Object.entries(DIRECTION_LABELS) as [value, label] (value)}
							<option {value}>{label}</option>
						{/each}
					</select>
				</div>
			</div>
			<div class="field">
				<label for="e-notes">Notes</label>
				<input id="e-notes" bind:value={editNotes} />
			</div>
		{:else}
			<p class="small muted">
				For a {editing.kind} entry the timeline corrects the times. Edit its other fields on the screen
				that created it.
			</p>
		{/if}
		<div class="field">
			<label for="e-reason">Reason for the correction (required)</label>
			<input id="e-reason" bind:value={editReason} />
		</div>
		<div class="row tight">
			<button type="button" class="primary" onclick={saveEdit}>Save correction</button>
			<button type="button" class="ghost" onclick={() => (editing = null)}>Cancel</button>
		</div>

		{#if history.length > 0}
			<h3>Change history</h3>
			<ul class="plain small">
				{#each history as rev (rev.id)}
					<li>
						<span class="mono">{formatDateTime(rev.at, app.timezone, true)}</span>
						<span class="badge dim">{rev.action}</span>
						{rev.operatorName}
						{#if rev.reason}— {rev.reason}{/if}
						{#each rev.changes as change (change.field)}
							<div class="muted">
								{change.field}: <s>{JSON.stringify(change.before)}</s> → {JSON.stringify(
									change.after
								)}
							</div>
						{/each}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

<style>
	.entry {
		display: grid;
		grid-template-columns: minmax(8rem, auto) 1fr auto;
		gap: 0.5rem;
		padding: 0.45rem 0;
		border-bottom: 1px solid var(--line);
		align-items: start;
	}
	.entry.voided {
		opacity: 0.55;
	}
	.times {
		display: flex;
		flex-direction: column;
	}
	.strong {
		font-weight: 700;
	}
	.actions {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
	}
	.inline {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
	}
	.inline input {
		width: 1.4rem;
		min-height: 1.4rem;
	}
	.prompt {
		padding: 0.3rem 0;
		border-bottom: 1px solid var(--line);
	}
	.prompt.attention {
		color: var(--warn);
	}
	.edit {
		border-color: var(--accent);
	}
	@media (max-width: 40rem) {
		.entry {
			grid-template-columns: 1fr;
		}
	}
</style>
