<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import { app } from '$lib/stores/app.svelte';
	import { readiness } from '$lib/services/readiness.svelte';
	import { saveQueue } from '$lib/stores/saveQueue.svelte';
	import { claimLoggingTab, releaseLoggingTab } from '$lib/services/tabLock';
	import { beginCapture } from '$lib/services/capture';
	import { activateEmergency } from '$lib/services/incidents';

	let { children } = $props();

	let emergencyError = $state<string | null>(null);

	const tabs = [
		{ href: '/', label: 'Live' },
		{ href: '/accountability', label: 'Accountability' },
		{ href: '/timeline', label: 'Timeline' },
		{ href: '/setup', label: 'Setup' },
		{ href: '/reports', label: 'Backup & reports' }
	];

	onMount(() => {
		app.loadContext();
		readiness.register().then(() => readiness.check());
		const release = claimLoggingTab(app.tabId, (isOwner) => {
			app.readOnlyBecauseOtherTab = !isOwner;
		});
		return () => {
			release();
			releaseLoggingTab(app.tabId);
		};
	});

	function currentPath(): string {
		return page.url.pathname.replace(base, '') || '/';
	}

	/**
	 * Emergency writes the incident marker from the instant of the press. It does
	 * not wait for permission, a GPS fix, or any field to be filled.
	 */
	async function onEmergency() {
		const instant = beginCapture();
		emergencyError = null;
		try {
			const incident = await activateEmergency(instant);
			await goto(`${base}/emergency${incident ? `?id=${incident.id}` : ''}`);
		} catch (err) {
			emergencyError = err instanceof Error ? err.message : String(err);
		}
	}
</script>

<div class="shell">
	<StatusBar />

	{#if app.readOnlyBecauseOtherTab}
		<div class="notice warn no-print">
			Another tab of this app is the active logger on this device. This tab is read-only to keep one
			clear record. Close the other tab and reload to log here.
		</div>
	{/if}

	{#if saveQueue.hasFailures}
		<div class="notice bad no-print">
			<strong>{saveQueue.failed.length} save(s) failed and are not stored.</strong>
			{#each saveQueue.failed as entry (entry.id)}
				<div class="small">
					{entry.label} — {entry.error}
					<button class="small" onclick={() => saveQueue.attempt(entry.id)}>Retry</button>
				</div>
			{/each}
		</div>
	{/if}

	{#if emergencyError}
		<div class="notice bad no-print">Emergency marker not saved: {emergencyError}</div>
	{/if}

	<main>
		{@render children?.()}
	</main>

	<nav class="no-print" aria-label="Main">
		{#each tabs as tab (tab.href)}
			<a
				href={`${base}${tab.href === '/' ? '/' : tab.href}`}
				class:active={currentPath() === tab.href}
				aria-current={currentPath() === tab.href ? 'page' : undefined}>{tab.label}</a
			>
		{/each}
		<button
			type="button"
			class="emergency"
			onclick={onEmergency}
			aria-label="Record emergency incident now"
		>
			EMERGENCY
		</button>
	</nav>
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}
	main {
		flex: 1;
		/* Reserve the fixed bar's height so no control is ever underneath it. */
		padding: 0.8rem 0.8rem calc(var(--nav-h) + 0.5rem);
		max-width: 60rem;
		width: 100%;
		margin: 0 auto;
	}
	nav {
		/*
		 * Fixed rather than sticky: a sticky bar floats over whatever content
		 * happens to be at the bottom of the viewport mid-scroll, which puts
		 * capture controls out of reach. Fixed, with matching padding on main,
		 * means the bar occupies its own band and covers nothing.
		 */
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		/* Keeps the capture and emergency controls clickable over long content
		   such as the responder text block on a narrow screen. */
		z-index: 10;
		/*
		 * A grid, not a horizontal scroller: on a phone-width screen a scrollable
		 * bar can end up scrolled so that Live or Emergency is off-screen, which
		 * is exactly what must not happen to an operator wearing gloves in the
		 * rain. Every destination is always visible and reachable.
		 */
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.3rem;
		padding: 0.35rem 0.4rem calc(0.35rem + env(safe-area-inset-bottom));
		background: var(--bg-sunken);
		border-top: 1px solid var(--line);
	}
	/*
	 * The page reserves scroll-padding for this bar. Cancel it on the bar's own
	 * controls: scroll-margin is not inherited, and scrolling one of these into
	 * view would otherwise chase a target it can never clear.
	 */
	nav a,
	nav button {
		scroll-margin-bottom: -12rem;
	}
	nav a {
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		min-width: 0;
		min-height: 3rem;
		padding: 0.3rem 0.35rem;
		border-radius: var(--radius);
		border: 2px solid transparent;
		color: var(--text-dim);
		text-decoration: none;
		font-weight: 600;
		font-size: 0.78rem;
		line-height: 1.1;
		overflow-wrap: anywhere;
	}
	nav a.active {
		color: var(--text);
		border-color: var(--line-strong);
		background: var(--bg-raised);
	}
	.emergency {
		/* Full width on its own row so it is never clipped or scrolled away. */
		grid-column: 1 / -1;
		background: var(--bad);
		color: #2b0503;
		border-color: var(--bad);
		font-weight: 800;
		letter-spacing: 0.06em;
	}
	@media (min-width: 40rem) {
		nav {
			grid-template-columns: repeat(5, minmax(0, 1fr)) minmax(8rem, auto);
		}
		.emergency {
			grid-column: auto;
		}
	}
	@media (max-width: 26rem) {
		nav a {
			font-size: 0.7rem;
		}
	}
</style>
