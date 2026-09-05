<script lang="ts">
	import { base } from '$app/paths';
	import { app } from '$lib/stores/app.svelte';
	import { CELL_STATE_LABELS, type AccountabilityCell } from '$lib/domain/accountability';
	import { DIRECTION_SHORT } from '$lib/domain/legs';
	import { formatTimeHundredths } from '$lib/time/clock';
	import { setParticipation } from '$lib/services/setup';
	import { assignObservation } from '$lib/services/capture';
	import type { Id, ParticipationState } from '$lib/domain/types';

	let view = $state<'table' | 'cards'>('table');
	const acc = $derived(app.accountability);
	const participationOptions: ParticipationState[] = ['entered', 'scratched', 'dns', 'dnf'];

	function cellText(cell: AccountabilityCell): string {
		if (cell.observations.length === 0) return CELL_STATE_LABELS[cell.state];
		const times = cell.observations
			.map((o) => formatTimeHundredths(o.effectiveTime, app.timezone))
			.join(', ');
		return times;
	}

	function cellClass(cell: AccountabilityCell): string {
		switch (cell.state) {
			case 'directly-observed':
				return 'good';
			case 'radio-confirmed':
				return 'radio';
			case 'not-expected':
				return 'dim';
			case 'not-applicable':
				return 'dim';
			default:
				return 'warn';
		}
	}
</script>

<svelte:head><title>Accountability — Jet Boat Safety Log</title></svelte:head>

<h1>Accountability</h1>

{#if !acc}
	<div class="notice warn">
		Select a heat on the <a href="{base}/setup">Setup</a> screen to see its accountability.
	</div>
{:else}
	<div class="card">
		<h2>{app.heat?.name}</h2>
		<p class="small">
			<span class="badge dim">{acc.summary.expectedCount} on the lineup</span>
			<span class="badge good">{acc.summary.observedHereCount} seen at this checkpoint</span>
			<span class="badge warn">{acc.summary.unobservedHereCount} not seen here</span>
			<span class="badge radio">{acc.summary.finishHeardCount} finish heard</span>
			<span class="badge bad">{acc.summary.dnfCount} DNF</span>
			<span class="badge dim">{acc.summary.scratchedCount} scratched / DNS</span>
		</p>
		<p class="small muted">
			These counts describe what has been observed and recorded at this station. They are not a
			statement that anyone is physically safe or accounted for.
		</p>

		<h3>Sweep</h3>
		<ul class="plain small">
			{#each acc.summary.sweep as s (s.legId)}
				<li>
					{s.legName} ({DIRECTION_SHORT[s.direction]}):
					{#if s.observed}
						<span class="good mono">{formatTimeHundredths(s.time as number, app.timezone)}</span>
					{:else}
						<span class="muted">not recorded</span>
					{/if}
				</li>
			{/each}
			{#if acc.summary.sweep.length === 0}<li class="muted">No legs configured.</li>{/if}
		</ul>
		{#if acc.summary.sweepComplete && acc.summary.unobservedHereCount > 0}
			<div class="notice warn">
				Sweep has passed on every leg while {acc.summary.unobservedHereCount} boat(s) on the lineup have
				no pass recorded here. Worth resolving before the heat is closed.
			</div>
		{/if}
	</div>

	{#if acc.unassigned.length > 0}
		<div class="card">
			<h3>Unassigned records in this heat ({acc.unassigned.length})</h3>
			<ul class="plain small">
				{#each acc.unassigned as obs (obs.id)}
					<li class="line">
						<span class="mono">{formatTimeHundredths(obs.effectiveTime, app.timezone)}</span>
						<span class="badge dim">{obs.type}</span>
						<span class="badge dim">{obs.direction}</span>
						{#if obs.unassignedBoatText}<span class="badge warn">"{obs.unassignedBoatText}"</span
							>{/if}
						<select
							aria-label="Assign a boat to this record"
							onchange={(e) => assignObservation(obs.id, (e.currentTarget.value as Id) || null)}
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

	<div class="row tight no-print" style="margin-bottom:0.6rem">
		<button type="button" class:primary={view === 'table'} onclick={() => (view = 'table')}>
			Table
		</button>
		<button type="button" class:primary={view === 'cards'} onclick={() => (view = 'cards')}>
			Cards
		</button>
		<a href="{base}/reports" class="linkbtn">Printable checklist</a>
	</div>

	{#if view === 'table'}
		<div class="card scroll-x">
			<table>
				<thead>
					<tr>
						<th>Ord</th>
						<th>Boat</th>
						<th>Class</th>
						<th>Participation</th>
						<th>Start heard</th>
						{#each app.legs as leg (leg.id)}
							<th>{leg.name} ({DIRECTION_SHORT[leg.direction]})</th>
						{/each}
						{#each app.checkpoints as cp (cp.id)}
							<th>{cp.name}{cp.expectedToReport ? '' : ' *'}</th>
						{/each}
						<th>Finish heard</th>
						<th>Note</th>
					</tr>
				</thead>
				<tbody>
					{#each acc.rows as row (row.participant.id)}
						<tr class:scratched={row.participant.participation !== 'entered'}>
							<td class="mono">{row.startOrder}</td>
							<td><strong>{row.boatNumber}</strong></td>
							<td>{row.className}</td>
							<td>
								<select
									aria-label={`Participation for boat ${row.boatNumber}`}
									value={row.participant.participation}
									onchange={(e) =>
										setParticipation(
											app.eventId as Id,
											row.participant,
											e.currentTarget.value as ParticipationState,
											row.participant.participationNote
										)}
								>
									{#each participationOptions as opt (opt)}
										<option value={opt}>{opt.toUpperCase()}</option>
									{/each}
								</select>
							</td>
							<td class={cellClass(row.start)} title={CELL_STATE_LABELS[row.start.state]}>
								<span class="mono">{cellText(row.start)}</span>
								{#if row.start.uncertain}<span class="badge warn">uncertain</span>{/if}
							</td>
							{#each row.passes as pass (pass.legId)}
								<td class={cellClass(pass)} title={CELL_STATE_LABELS[pass.state]}>
									<span class="mono">{cellText(pass)}</span>
									{#if pass.observations.length > 1}
										<span class="badge dim">{pass.observations.length} passes</span>
									{/if}
									{#if pass.uncertain}<span class="badge warn">uncertain</span>{/if}
								</td>
							{/each}
							{#each row.checkpointReports as report (report.checkpoint.id)}
								<td class={cellClass(report)} title={CELL_STATE_LABELS[report.state]}>
									<span class="mono">{cellText(report)}</span>
								</td>
							{/each}
							<td class={cellClass(row.finish)} title={CELL_STATE_LABELS[row.finish.state]}>
								<span class="mono">{cellText(row.finish)}</span>
							</td>
							<td class="small">{row.notes}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="small muted">
			* This checkpoint is not expected to call passages, so silence from it is recorded as "not
			expected to report", never as a missing observation.
		</p>
		<p class="small muted">
			"Finish heard" means the finish-line announcement was heard on the radio. A boat passing this
			checkpoint does not imply it finished, and no finish is ever filled in automatically.
		</p>
	{:else}
		{#each acc.rows as row (row.participant.id)}
			<div class="card">
				<h3>
					#{row.startOrder} · Boat {row.boatNumber}
					{#if row.className}<span class="badge dim">{row.className}</span>{/if}
					<span
						class="badge"
						class:bad={row.participant.participation === 'dnf'}
						class:dim={row.participant.participation !== 'entered' &&
							row.participant.participation !== 'dnf'}
					>
						{row.participant.participation}
					</span>
				</h3>
				<ul class="plain small">
					<li>
						Start heard: <span class={cellClass(row.start)}>{cellText(row.start)}</span>
					</li>
					{#each row.passes as pass (pass.legId)}
						<li>
							{pass.legName} ({DIRECTION_SHORT[pass.direction]}):
							<span class={cellClass(pass)}>{cellText(pass)}</span>
						</li>
					{/each}
					{#each row.checkpointReports as report (report.checkpoint.id)}
						<li>
							{report.checkpoint.name}:
							<span class={cellClass(report)}>{cellText(report)}</span>
							<span class="muted">({CELL_STATE_LABELS[report.state]})</span>
						</li>
					{/each}
					<li>Finish heard: <span class={cellClass(row.finish)}>{cellText(row.finish)}</span></li>
					{#if row.notes}<li>Note: {row.notes}</li>{/if}
				</ul>
			</div>
		{/each}
	{/if}
{/if}

<style>
	.good {
		color: var(--good);
	}
	.warn {
		color: var(--warn);
	}
	.radio {
		color: var(--radio);
	}
	.dim {
		color: var(--text-dim);
	}
	tr.scratched td {
		opacity: 0.65;
	}
	td select {
		min-height: 2.4rem;
		min-width: 6.5rem;
	}
	.line {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.25rem 0;
		border-bottom: 1px solid var(--line);
	}
	.line select {
		width: auto;
		min-width: 9rem;
		min-height: 2.6rem;
	}
	.linkbtn {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0.5rem 0.9rem;
		border: 2px solid var(--line-strong);
		border-radius: var(--radius);
		text-decoration: none;
		color: var(--text);
		font-weight: 600;
	}
</style>
