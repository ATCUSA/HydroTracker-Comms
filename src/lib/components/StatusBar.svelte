<script lang="ts">
	import { app } from '$lib/stores/app.svelte';
	import { readiness } from '$lib/services/readiness.svelte';
	import { saveQueue } from '$lib/stores/saveQueue.svelte';
	import { formatTimeHundredths, nowMs } from '$lib/time/clock';
	import { onMount } from 'svelte';

	let clock = $state(nowMs());

	onMount(() => {
		// Hundredths are shown so consecutive captures are distinguishable, not
		// because the clock is accurate to 0.01 s.
		let raf = 0;
		const tick = () => {
			clock = nowMs();
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		const stop = readiness.bindConnectivity();
		const drift = setInterval(() => app.checkClockDrift(), 10_000);
		return () => {
			cancelAnimationFrame(raf);
			clearInterval(drift);
			stop();
		};
	});

	const saveLabel = $derived(
		saveQueue.hasFailures
			? `${saveQueue.failed.length} FAILED`
			: saveQueue.pending.length > 0
				? `Saving ${saveQueue.pending.length}…`
				: saveQueue.lastState === 'saved'
					? 'Saved'
					: 'Idle'
	);
</script>

<div class="status" role="status" aria-live="polite">
	<span class="cell">
		<span class="k">Checkpoint</span>
		<span class="v">{app.session?.checkpointName || '— not set —'}</span>
	</span>
	<span class="cell">
		<span class="k">Heat / Leg</span>
		<span class="v">
			{app.heat?.name || '—'}{app.leg ? ` · ${app.leg.name}` : ''}
		</span>
	</span>
	<span class="cell">
		<span class="k">Direction</span>
		<span class="v">{app.leg?.direction ?? 'unknown'}</span>
	</span>
	<span class="cell">
		<span class="k">Local ({app.timezone})</span>
		<span class="v mono big">{formatTimeHundredths(clock, app.timezone)}</span>
	</span>
	<span class="cell">
		<span class="k">UTC</span>
		<span class="v mono">{formatTimeHundredths(clock, 'UTC')}</span>
	</span>
	<span class="cell">
		<span class="k">Offline</span>
		<span
			class="v"
			class:good={readiness.level === 'ready'}
			class:warn={readiness.level === 'partial'}
			class:bad={readiness.level === 'not-ready'}>{readiness.levelLabel}</span
		>
	</span>
	<span class="cell">
		<span class="k">Network</span>
		<span class="v">{readiness.online ? 'Online' : 'Offline'}</span>
	</span>
	<span class="cell">
		<span class="k">Save state</span>
		<span class="v" class:bad={saveQueue.hasFailures} class:good={saveLabel === 'Saved'}
			>{saveLabel}</span
		>
	</span>
</div>

<style>
	.status {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 1rem;
		padding: 0.4rem 0.7rem;
		background: var(--bg-sunken);
		border-bottom: 1px solid var(--line);
		font-size: 0.78rem;
	}
	.cell {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.k {
		color: var(--text-dim);
		font-size: 0.64rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.v {
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.v.big {
		font-size: 1rem;
	}
	.good {
		color: var(--good);
	}
	.warn {
		color: var(--warn);
	}
	.bad {
		color: var(--bad);
	}
</style>
