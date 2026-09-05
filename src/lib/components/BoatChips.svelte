<script lang="ts">
	import { app } from '$lib/stores/app.svelte';
	import type { HeatParticipant, Id } from '$lib/domain/types';

	interface Props {
		participants: HeatParticipant[];
		selected?: Id | null;
		multi?: Id[];
		classFilter?: string;
		onPick: (participantId: Id) => void;
	}

	let { participants, selected = null, multi = [], classFilter = '', onPick }: Props = $props();

	const visible = $derived(
		participants.filter((p) => {
			if (!classFilter) return true;
			const cls = p.className || app.racerById(p.racerId)?.className || '';
			return cls === classFilter;
		})
	);
</script>

<div class="chips" role="group" aria-label="Boats in starting order">
	{#each visible as participant (participant.id)}
		{@const racer = app.racerById(participant.racerId)}
		<button
			type="button"
			class="chip"
			class:selected={selected === participant.id || multi.includes(participant.id)}
			class:scratched={participant.participation === 'scratched' ||
				participant.participation === 'dns'}
			class:dnf={participant.participation === 'dnf'}
			aria-pressed={selected === participant.id || multi.includes(participant.id)}
			onclick={() => onPick(participant.id)}
		>
			<span class="order">{participant.startOrder}</span>
			<span class="num">{racer?.boatNumber ?? '?'}</span>
			{#if participant.participation !== 'entered'}
				<span class="state">{participant.participation}</span>
			{/if}
		</button>
	{/each}
	{#if visible.length === 0}
		<p class="muted small">No boats in this lineup yet. Add them on the Setup screen.</p>
	{/if}
</div>

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.chip {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-width: 4.2rem;
		min-height: 3.6rem;
		padding: 0.2rem 0.5rem;
		gap: 0;
	}
	.chip.selected {
		background: var(--accent);
		color: var(--accent-ink);
		border-color: var(--accent);
	}
	.chip.scratched {
		opacity: 0.55;
		text-decoration: line-through;
	}
	.chip.dnf {
		border-color: var(--bad);
	}
	.order {
		font-size: 0.6rem;
		color: var(--text-dim);
		line-height: 1;
	}
	.chip.selected .order {
		color: var(--accent-ink);
	}
	.num {
		font-size: 1.25rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}
	.state {
		font-size: 0.58rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		line-height: 1;
	}
</style>
