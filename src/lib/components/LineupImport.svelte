<script lang="ts">
	import { app } from '$lib/stores/app.svelte';
	import {
		buildLineupPreview,
		guessMapping,
		LINEUP_FIELD_LABELS,
		readTabularFile,
		resolveStartOrder,
		type Grid,
		type LineupField,
		type LineupPreview
	} from '$lib/import/tabular';
	import { addParticipant, ensureRacer } from '$lib/services/setup';
	import type { Id } from '$lib/domain/types';

	interface Props {
		onDone?: (count: number) => void;
	}
	let { onDone }: Props = $props();

	let grid = $state<Grid>([]);
	let mapping = $state<LineupField[]>([]);
	let hasHeaderRow = $state(true);
	let fileName = $state('');
	let readError = $state<string | null>(null);
	let importing = $state(false);

	const preview = $derived<LineupPreview | null>(
		grid.length > 0 ? buildLineupPreview(grid, mapping, hasHeaderRow) : null
	);

	const fields: LineupField[] = ['boatNumber', 'className', 'startOrder', 'notes', 'ignore'];

	async function onFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		readError = null;
		fileName = file.name;
		try {
			grid = await readTabularFile(file);
			mapping = guessMapping(grid[0] ?? []);
		} catch (err) {
			grid = [];
			readError = err instanceof Error ? err.message : 'The file could not be read.';
		}
	}

	/** Nothing is written until the operator confirms the mapped preview. */
	async function confirmImport() {
		if (!preview?.valid || !app.eventId || !app.heatId) return;
		importing = true;
		try {
			const rows = resolveStartOrder(preview.rows);
			let order = app.participants.length;
			for (const row of rows) {
				const racer = await ensureRacer(app.eventId as Id, row.boatNumber, row.className);
				order += 1;
				await addParticipant(app.eventId as Id, app.heatId as Id, racer.id, order, row.className);
			}
			onDone?.(rows.length);
			grid = [];
			fileName = '';
		} catch (err) {
			readError = err instanceof Error ? err.message : String(err);
		} finally {
			importing = false;
		}
	}
</script>

<details>
	<summary>Import a lineup from CSV or XLSX</summary>
	<p class="small muted">
		Any layout works — map the columns yourself. The file does not have to match the printed
		checklist.
	</p>
	<div class="field">
		<label for="lineup-file">Choose a .csv, .tsv or .xlsx file</label>
		<input id="lineup-file" type="file" accept=".csv,.tsv,.txt,.xlsx,.xlsm" onchange={onFile} />
	</div>
	{#if readError}
		<div class="notice bad">{readError}</div>
	{/if}

	{#if grid.length > 0}
		<p class="small">
			<strong>{fileName}</strong> — {grid.length} row(s), {grid[0]?.length ?? 0} column(s)
		</p>
		<label class="inline">
			<input type="checkbox" bind:checked={hasHeaderRow} /> First row is a header
		</label>

		<div class="scroll-x">
			<table>
				<thead>
					<tr>
						{#each grid[0] ?? [] as _cell, index (index)}
							<th>
								<select
									aria-label={`Map column ${index + 1}`}
									value={mapping[index] ?? 'ignore'}
									onchange={(e) => {
										const next = [...mapping];
										next[index] = e.currentTarget.value as LineupField;
										mapping = next;
									}}
								>
									{#each fields as field (field)}
										<option value={field}>{LINEUP_FIELD_LABELS[field]}</option>
									{/each}
								</select>
								{#if hasHeaderRow}
									<div class="small muted">{grid[0][index]}</div>
								{/if}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each grid.slice(hasHeaderRow ? 1 : 0, hasHeaderRow ? 6 : 5) as row, r (r)}
						<tr>
							{#each grid[0] ?? [] as _c, c (c)}
								<td class="mono small">{row[c] ?? ''}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if preview}
			<p class="small">
				{preview.rows.length} boat(s) ready to import.
				{#if !preview.valid}<span class="badge bad">Not importable yet</span>{/if}
			</p>
			{#if preview.issues.length > 0}
				<ul class="plain small">
					{#each preview.issues as issue, i (i)}
						<li class:bad={issue.severity === 'error'}>
							{issue.rowIndex >= 0 ? `Row ${issue.rowIndex + 1}: ` : ''}{issue.message}
						</li>
					{/each}
				</ul>
			{/if}
			<button
				type="button"
				class="primary"
				disabled={!preview.valid || importing || !app.heatId}
				onclick={confirmImport}
			>
				{importing ? 'Importing…' : `Confirm import of ${preview.rows.length} boat(s)`}
			</button>
		{/if}
	{/if}
</details>

<style>
	details {
		margin: 0.6rem 0;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0.5rem 0.7rem;
	}
	summary {
		cursor: pointer;
		font-weight: 700;
		min-height: 2.4rem;
		display: flex;
		align-items: center;
	}
	.inline {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.inline input {
		width: 1.4rem;
		min-height: 1.4rem;
	}
	th select {
		min-width: 8rem;
		min-height: 2.4rem;
	}
	.bad {
		color: var(--bad);
	}
</style>
