<script lang="ts">
	import { getDb } from '$lib/db/db';
	import { app } from '$lib/stores/app.svelte';
	import { buildAccountability } from '$lib/domain/accountability';
	import { CELL_STATE_LABELS } from '$lib/domain/accountability';
	import { DIRECTION_SHORT } from '$lib/domain/legs';
	import { formatDateTime, formatTimeHundredths } from '$lib/time/clock';
	import { APP_VERSION, exportBackup, exportCsv, exportXlsx } from '$lib/report/exportService';
	import {
		archiveBackup,
		restoreBackup,
		validateBackup,
		type ArchiveResult,
		type BackupDocument,
		type ValidationResult
	} from '$lib/export/backup';
	import { download } from '$lib/export/csv';
	import type { ArchivedLog, Id } from '$lib/domain/types';
	import { liveQuery } from 'dexie';
	import { onMount } from 'svelte';

	let status = $state<string | null>(null);
	let failure = $state<string | null>(null);
	let printHeatId = $state<Id | ''>('');

	let pendingDoc = $state<BackupDocument | null>(null);
	let validation = $state<ValidationResult | null>(null);
	let restoreMode = $state<'copy' | 'replace'>('copy');
	let confirmReplace = $state(false);
	let archives = $state<ArchivedLog[]>([]);

	onMount(() => {
		const sub = liveQuery(() => getDb().archive.toArray()).subscribe({
			next: (rows) => (archives = rows.sort((a, b) => b.importedAt - a.importedAt))
		});
		return () => sub.unsubscribe();
	});

	const printHeat = $derived(app.heats.find((h) => h.id === (printHeatId || app.heatId)));
	const printAcc = $derived(
		printHeat
			? buildAccountability({
					heat: printHeat,
					legs: app.legsOf(printHeat.id),
					participants: app.participantsOf(printHeat.id),
					racers: app.racers,
					observations: app.observations.filter((o) => o.heatId === printHeat.id),
					checkpoints: app.checkpoints
				})
			: null
	);
	const printLegs = $derived(printHeat ? app.legsOf(printHeat.id) : []);

	/** Every export reports its real outcome; a failure is never shown as success. */
	async function attempt(label: string, fn: () => Promise<unknown>) {
		status = null;
		failure = null;
		try {
			await fn();
			status = `${label} completed.`;
		} catch (err) {
			failure = `${label} FAILED: ${err instanceof Error ? err.message : String(err)}. Nothing was written.`;
		}
	}

	async function onPickBackup(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		status = null;
		failure = null;
		pendingDoc = null;
		validation = null;
		confirmReplace = false;
		try {
			const parsed = JSON.parse(await file.text());
			const result = validateBackup(parsed);
			validation = result;
			if (result.valid) pendingDoc = parsed as BackupDocument;
			else failure = 'This backup was rejected. Your existing records are untouched.';
		} catch (err) {
			validation = {
				valid: false,
				errors: [err instanceof Error ? err.message : 'The file is not valid JSON.'],
				warnings: []
			};
			failure = 'The file could not be read. Your existing records are untouched.';
		} finally {
			// Clear the picker so choosing the same file again re-runs validation —
			// re-importing one station's log is a normal thing to do.
			input.value = '';
		}
	}

	async function doRestore() {
		if (!pendingDoc) return;
		if (restoreMode === 'replace' && !confirmReplace) {
			failure = 'Tick the confirmation before replacing existing data.';
			return;
		}
		await attempt('Restore', async () => {
			const result = await restoreBackup(pendingDoc as BackupDocument, restoreMode, APP_VERSION);
			if (result.preReplaceBackup) {
				// The data that was replaced is handed back immediately as a file.
				download(
					`replaced-before-restore_${Date.now()}.json`,
					JSON.stringify(result.preReplaceBackup, null, 2),
					'application/json'
				);
			}
			await app.setEvent(result.eventId);
			pendingDoc = null;
			validation = null;
		});
	}

	async function doArchive() {
		if (!pendingDoc) return;
		let outcome: ArchiveResult | null = null;
		await attempt('Archive import', async () => {
			outcome = await archiveBackup(pendingDoc as BackupDocument);
			pendingDoc = null;
			validation = null;
		});
		// Set after attempt() so its generic message does not overwrite the
		// outcome, which is the part the operator actually needs to read.
		if (outcome && !failure) {
			const { entry, outcome: kind } = outcome as ArchiveResult;
			status =
				kind === 'duplicate'
					? `Identical backup already in the archive (imported ${formatDateTime(entry.importedAt, app.timezone)}). Nothing was added.`
					: kind === 'new-version'
						? `Changed snapshot from ${entry.stationLabel} stored as version ${entry.snapshotVersion}. Earlier versions are kept.`
						: `Log from ${entry.stationLabel} added to the archive.`;
		}
	}

	function exportArchived(entry: ArchivedLog) {
		download(
			`archive_${entry.stationLabel}_v${entry.snapshotVersion}.json`,
			JSON.stringify(entry.payload, null, 2),
			'application/json'
		);
	}
</script>

<svelte:head><title>Backup & reports — Jet Boat Safety Log</title></svelte:head>

<h1 class="no-print">Backup &amp; reports</h1>

{#if status}<div class="notice good no-print">{status}</div>{/if}
{#if failure}<div class="notice bad no-print">{failure}</div>{/if}

{#if !app.eventId}
	<div class="notice warn no-print">Select an event on the Setup screen first.</div>
{:else}
	<div class="card no-print">
		<h2>Exports</h2>
		<p class="small muted">
			Reports label the station, operator, timezone, generation time and the source of each
			observation. Corrected times are shown alongside the original capture time, and unknown values
			are labelled rather than guessed.
		</p>
		<div class="row tight">
			<button type="button" onclick={() => attempt('CSV export', exportCsv)}>Export CSV</button>
			<button type="button" onclick={() => attempt('XLSX export', exportXlsx)}>Export XLSX</button>
			<button type="button" class="primary" onclick={() => attempt('JSON backup', exportBackup)}>
				Export full JSON backup
			</button>
			<button type="button" onclick={() => window.print()}>Print this page</button>
		</div>
		<p class="small muted">
			Text that would otherwise be read as a spreadsheet formula is escaped on export, so notes and
			boat numbers survive intact.
		</p>
	</div>

	<div class="card no-print">
		<h2>Restore or archive a backup</h2>
		<p class="small muted">
			A backup is fully validated before anything changes. Restoring lands in a separate recoverable
			workspace by default; replacing existing data has to be confirmed and takes a backup of what
			was there first.
		</p>
		<div class="field">
			<label for="backup-file">Choose a backup .json file</label>
			<input id="backup-file" type="file" accept=".json,application/json" onchange={onPickBackup} />
		</div>

		{#if validation}
			<div class="notice" class:bad={!validation.valid} class:good={validation.valid}>
				<strong>{validation.valid ? 'Backup is valid.' : 'Backup rejected.'}</strong>
				{#if validation.summary}
					<div class="small">
						{validation.summary.eventName} · {validation.summary.station} · generated
						{formatDateTime(validation.summary.generatedAt, app.timezone)}
					</div>
					<ul class="plain small">
						{#each Object.entries(validation.summary.counts) as [name, count] (name)}
							<li>{name}: {count}</li>
						{/each}
					</ul>
				{/if}
				{#each validation.errors as err, i (i)}<div class="small">✗ {err}</div>{/each}
				{#each validation.warnings as warn, i (i)}<div class="small">! {warn}</div>{/each}
			</div>
		{/if}

		{#if pendingDoc}
			<div class="field">
				<label for="restore-mode">What to do with it</label>
				<select id="restore-mode" bind:value={restoreMode}>
					<option value="copy">Restore into a separate workspace copy (recommended)</option>
					<option value="replace">Replace the existing event with the same id</option>
				</select>
			</div>
			{#if restoreMode === 'replace'}
				<label class="inline">
					<input type="checkbox" bind:checked={confirmReplace} />
					I understand this replaces existing records. A backup of them will be downloaded first.
				</label>
			{/if}
			<div class="row tight" style="margin-top:0.6rem">
				<button type="button" class="primary" onclick={doRestore}>Restore</button>
				<button type="button" onclick={doArchive}> Add to read-only archive instead </button>
			</div>
		{/if}
	</div>

	<div class="card no-print">
		<h2>Collected station logs ({archives.length})</h2>
		<p class="small muted">
			Each station's log is kept whole and separate. Nothing is merged, deduplicated across
			stations, or combined into a single accountability claim.
		</p>
		<ul class="plain small">
			{#each archives as entry (entry.id)}
				<li class="line">
					<strong>{entry.stationLabel}</strong>
					<span class="muted">{entry.eventName}</span>
					<span class="badge dim">v{entry.snapshotVersion}</span>
					<span class="muted">
						generated {formatDateTime(entry.generatedAt, app.timezone)} · imported
						{formatDateTime(entry.importedAt, app.timezone)}
					</span>
					<button class="small" onclick={() => exportArchived(entry)}>Export copy</button>
				</li>
			{/each}
			{#if archives.length === 0}<li class="muted">No other station logs collected yet.</li>{/if}
		</ul>
	</div>

	<div class="card">
		<div class="no-print">
			<h2>Printable per-heat checklist</h2>
			<div class="field">
				<label for="print-heat">Heat</label>
				<select id="print-heat" bind:value={printHeatId}>
					<option value="">Current heat</option>
					{#each app.heats as heat (heat.id)}<option value={heat.id}>{heat.name}</option>{/each}
				</select>
			</div>
		</div>

		{#if printHeat && printAcc}
			<div class="printable">
				<h2>JET BOAT RACES CHECKLIST — {printHeat.name}</h2>
				<p class="small">
					{app.event?.name} · {app.event?.dates.join(', ')} · {app.timezone}<br />
					Station: {app.session?.checkpointName ?? '(unknown)'} · Safety boat
					{app.session?.safetyBoatNumber ?? '(unknown)'} · Operator
					{app.session?.operatorName ?? '(unknown)'} ({app.session?.callSign ?? ''})<br />
					Generated {formatDateTime(Date.now(), app.timezone)} · App v{APP_VERSION}
					{#if app.event?.isDemo}<strong> · DEMO DATA — NOT A REAL LOG</strong>{/if}
				</p>
				<p class="small">
					Times are as observed and recorded at this station. Directly observed unless marked radio.
					This is an observation record, not official timing or scoring.
				</p>

				<table>
					<thead>
						<tr>
							<th>Order</th>
							<th>Boat #</th>
							<th>Class</th>
							<th>Scratched</th>
							<th>Start heard</th>
							{#each printLegs as leg (leg.id)}
								<th>Time passed — {leg.name} [{DIRECTION_SHORT[leg.direction]}]</th>
							{/each}
							{#each app.checkpoints as cp (cp.id)}
								<th>{cp.name}{cp.expectedToReport ? '' : ' (silent)'}</th>
							{/each}
							<th>Finished</th>
							<th>Notes</th>
						</tr>
					</thead>
					<tbody>
						{#each printAcc.rows as row (row.participant.id)}
							<tr>
								<td>{row.startOrder}</td>
								<td><strong>{row.boatNumber}</strong></td>
								<td>{row.className}</td>
								<td>
									{row.participant.participation === 'scratched' ||
									row.participant.participation === 'dns'
										? 'YES'
										: 'NO'}
								</td>
								<td class="mono">
									{row.start.observations.length > 0
										? formatTimeHundredths(row.start.firstTime as number, app.timezone)
										: CELL_STATE_LABELS[row.start.state]}
								</td>
								{#each row.passes as pass (pass.legId)}
									<td class="mono">
										{pass.observations.length > 0
											? pass.observations
													.map((o) => formatTimeHundredths(o.effectiveTime, app.timezone))
													.join(' | ')
											: CELL_STATE_LABELS[pass.state]}
									</td>
								{/each}
								{#each row.checkpointReports as report (report.checkpoint.id)}
									<td class="mono small">
										{report.observations.length > 0
											? formatTimeHundredths(report.firstTime as number, app.timezone)
											: CELL_STATE_LABELS[report.state]}
									</td>
								{/each}
								<td>
									{#if row.finish.observations.length > 0}
										YES — {formatTimeHundredths(row.finish.firstTime as number, app.timezone)}
									{:else if row.participant.participation === 'dnf'}
										DNF (no finish heard)
									{:else}
										No finish heard
									{/if}
								</td>
								<td class="small">{row.notes}</td>
							</tr>
						{/each}
						<tr>
							<td colspan="4"><strong>Sweep boat</strong></td>
							<td></td>
							{#each printAcc.summary.sweep as s (s.legId)}
								<td class="mono">
									{s.observed
										? formatTimeHundredths(s.time as number, app.timezone)
										: 'Not recorded'}
								</td>
							{/each}
							<td colspan={app.checkpoints.length + 2}></td>
						</tr>
					</tbody>
				</table>

				<p class="small">
					Observed at this checkpoint: {printAcc.summary.observedHereCount} · Not observed here: {printAcc
						.summary.unobservedHereCount} · Finish heard: {printAcc.summary.finishHeardCount} · DNF: {printAcc
						.summary.dnfCount}
				</p>
				<p class="small">
					These counts describe what was observed and recorded here. They are not a statement that
					anyone is physically safe or accounted for.
				</p>
				<p class="small">"No finish heard" is not the same as DNF.</p>
			</div>
		{:else}
			<p class="muted small no-print">Select a heat to render its checklist.</p>
		{/if}
	</div>
{/if}

<style>
	.line {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		padding: 0.3rem 0;
		border-bottom: 1px solid var(--line);
	}
	.inline {
		display: inline-flex;
		align-items: flex-start;
		gap: 0.4rem;
		font-size: 0.85rem;
	}
	.inline input {
		width: 1.4rem;
		min-height: 1.4rem;
		flex: 0 0 auto;
	}
	.printable {
		overflow-x: auto;
	}
</style>
