<script lang="ts">
	import { captureInstant, type Instant } from '$lib/time/clock';
	import type { Snippet } from 'svelte';

	interface Props {
		onCapture: (instant: Instant) => void;
		label?: string;
		variant?: 'huge' | 'primary' | 'normal' | 'danger';
		disabled?: boolean;
		title?: string;
		children?: Snippet;
	}

	let {
		onCapture,
		label = '',
		variant = 'normal',
		disabled = false,
		title = '',
		children
	}: Props = $props();

	/**
	 * One activation must produce exactly one observation. Only `click` commits,
	 * so touch, mouse and keyboard all take the same single path and no
	 * synthesized click can double-fire alongside a pointer handler.
	 *
	 * `pointerdown` is used solely to note the earliest possible instant; if it
	 * never fires (keyboard activation) the click's own instant is used.
	 */
	let pending: Instant | null = null;

	function onpointerdown() {
		pending = captureInstant();
	}

	function onpointercancel() {
		pending = null;
	}

	function onclick() {
		const instant = pending ?? captureInstant();
		pending = null;
		onCapture(instant);
	}
</script>

<button
	type="button"
	class={variant}
	{disabled}
	{title}
	aria-label={label || undefined}
	{onpointerdown}
	{onpointercancel}
	{onclick}
>
	{#if children}{@render children()}{:else}{label}{/if}
</button>

<style>
	button.huge {
		width: 100%;
		min-height: 7.5rem;
		font-size: 1.6rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		background: var(--accent);
		color: var(--accent-ink);
		border-color: var(--accent);
	}
	button.primary {
		background: var(--accent);
		color: var(--accent-ink);
		border-color: var(--accent);
	}
	button.danger {
		background: var(--bad);
		color: #2b0503;
		border-color: var(--bad);
	}
</style>
