<script lang="ts">
	import { app } from '$lib/stores/app.svelte';
	import { readiness } from '$lib/services/readiness.svelte';
	import {
		addCheckpoint,
		addParticipant,
		addRacer,
		closeHeat,
		copyLineupInto,
		createEvent,
		createHeat,
		ensureRacer,
		parseBoatList,
		removeCheckpoint,
		removeFromLineup,
		removeRacer,
		reopenHeat,
		reorderLineup,
		setParticipation,
		startSession,
		updateCheckpoint,
		updateEvent,
		updateLeg,
		updateSession
	} from '$lib/services/setup';
	import { createDemoRace, deleteDemoRace } from '$lib/services/demo';
	import { LEG_FORMAT_LABELS, LEG_FORMAT_NOTES, DIRECTION_LABELS } from '$lib/domain/legs';
	import { deviceTimezone, formatDateTime, listTimezones } from '$lib/time/clock';
	import { parseCoordinateText, formatCoordinates } from '$lib/geo/coordinates';
	import LineupImport from '$lib/components/LineupImport.svelte';
	import type { HeatParticipant, Id, LegFormat, ParticipationState } from '$lib/domain/types';

	let busy = $state(false);
	let message = $state<string | null>(null);
	let error = $state<string | null>(null);

	let evName = $state('');
	let evDate = $state(new Date().toISOString().slice(0, 10));
	let evTz = $state(deviceTimezone());
	let evNotes = $state('');

	let sCheckpoint = $state('');
	let sBoat = $state('');
	let sOperator = $state('');
	let sCallSign = $state('');
	let sChannel = $state('');
	let sCoords = $state('');

	let rosterBoat = $state('');
	let rosterClass = $state('');
	let lineupBoat = $state('');
	let lineupClass = $state('');
	let pasteText = $state('');

	let heatName = $state('');
	let heatFormat = $state<LegFormat>('continuous-down-and-back');
	let heatStartMode = $state<'individual' | 'mass'>('individual');
	let heatLegCount = $state(2);
	let copySourceHeat = $state<Id | ''>('');

	let cpName = $state('');
	let cpReports = $state(true);
	let overdueMinutes = $state<number | ''>('');

	const timezones = listTimezones();
	const participationOptions: ParticipationState[] = ['entered', 'scratched', 'dns', 'dnf'];

	async function run(label: string, fn: () => Promise<unknown>) {
		busy = true;
		error = null;
		try {
			await fn();
			message = label;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
			message = null;
		} finally {
			busy = false;
		}
	}

	async function onCreateEvent() {
		if (!evName.trim()) {
			error = 'Give the event a name.';
			return;
		}
		await run('Event created.', async () => {
			const event = await createEvent({
				name: evName.trim(),
				dates: [evDate],
				timezone: evTz,
				courseNotes: evNotes.trim()
			});
			await app.setEvent(event.id);
			evName = '';
			evNotes = '';
		});
	}

	async function onStartSession() {
		if (!app.eventId) return;
		const coords = sCoords.trim() ? parseCoordinateText(sCoords) : null;
		if (sCoords.trim() && !coords) {
			error = 'Checkpoint coordinates could not be read. Leave blank or use a supported format.';
			return;
		}
		await run('Station session started.', async () => {
			const session = await startSession({
				eventId: app.eventId as Id,
				checkpointName: sCheckpoint.trim(),
				safetyBoatNumber: sBoat.trim(),
				operatorName: sOperator.trim(),
				callSign: sCallSign.trim(),
				channel: sChannel.trim(),
				checkpointLocation: coords ? { ...coords, fixTime: Date.now() } : null
			});
			await app.setSession(session.id);
		});
	}

	async function onAddRoster() {
		if (!app.eventId || !rosterBoat.trim()) return;
		const boat = rosterBoat.trim();
		rosterBoat = '';
		await run(`Boat ${boat} added to the event roster.`, () =>
			addRacer(app.eventId as Id, boat, rosterClass.trim())
		);
	}

	/** Radio lineup entry: type a number, press Enter, the input clears at once. */
	async function onAddToLineup() {
		if (!app.eventId || !app.heatId || !lineupBoat.trim()) return;
		const boat = lineupBoat.trim();
		lineupBoat = '';
		await run(`Boat ${boat} added to the lineup.`, async () => {
			const racer = await ensureRacer(app.eventId as Id, boat, lineupClass.trim());
			await addParticipant(
				app.eventId as Id,
				app.heatId as Id,
				racer.id,
				app.participants.length + 1,
				lineupClass.trim()
			);
		});
	}

	async function onPasteLineup() {
		if (!app.eventId || !app.heatId) return;
		const numbers = parseBoatList(pasteText);
		if (numbers.length === 0) return;
		await run(`${numbers.length} boat(s) added to the lineup.`, async () => {
			let order = app.participants.length;
			for (const boat of numbers) {
				const racer = await ensureRacer(app.eventId as Id, boat, lineupClass.trim());
				order += 1;
				await addParticipant(
					app.eventId as Id,
					app.heatId as Id,
					racer.id,
					order,
					lineupClass.trim()
				);
			}
			pasteText = '';
		});
	}

	async function move(participant: HeatParticipant, delta: number) {
		const list = [...app.participants];
		const index = list.findIndex((p) => p.id === participant.id);
		const target = index + delta;
		if (index < 0 || target < 0 || target >= list.length) return;
		const [moved] = list.splice(index, 1);
		list.splice(target, 0, moved);
		await run('Starting order changed.', () => reorderLineup(app.eventId as Id, list));
	}

	async function onCreateHeat() {
		if (!app.eventId || !heatName.trim()) return;
		let copied: number | null = null;
		await run('Heat created.', async () => {
			const heat = await createHeat({
				eventId: app.eventId as Id,
				name: heatName.trim(),
				legFormat: heatFormat,
				startMode: heatStartMode,
				legCount: heatLegCount
			});
			await app.setHeat(heat.id);
			if (copySourceHeat) {
				copied = await copyLineupInto(app.eventId as Id, copySourceHeat, heat.id);
			}
			heatName = '';
			copySourceHeat = '';
		});
		// Set after run() so its generic success message does not overwrite this.
		if (copied !== null && !error) {
			message = `Heat created and ${copied} boat(s) copied. Times, DNF and scratches were not copied.`;
		}
	}

	async function onAddCheckpoint() {
		if (!app.eventId || !cpName.trim()) return;
		const name = cpName.trim();
		cpName = '';
		await run('Reporting checkpoint added.', () =>
			addCheckpoint(app.eventId as Id, name, cpReports)
		);
	}

	async function saveCheckpointCoords(text: string) {
		const parsed = parseCoordinateText(text);
		if (!parsed) {
			error = 'Coordinates could not be read.';
			return;
		}
		const session = app.session;
		if (!session) return;
		await run('Checkpoint coordinates saved.', () =>
			updateSession({ ...session, checkpointLocation: { ...parsed, fixTime: Date.now() } })
		);
	}
</script>

<svelte:head><title>Setup — Jet Boat Safety Log</title></svelte:head>

<h1>Setup</h1>

{#if message}<div class="notice good">{message}</div>{/if}
{#if error}<div class="notice bad">{error}</div>{/if}

<div class="card">
	<h2>Offline readiness</h2>
	<p class="small muted">
		Readiness describes this device's cache and database, not whether you currently have a signal.
		Prepare the app while online before going out.
	</p>
	<ul class="plain small">
		<li>Status: <strong>{readiness.levelLabel}</strong></li>
		<li>Network right now: {readiness.online ? 'online' : 'offline'}</li>
		<li>Service worker: {readiness.serviceWorkerState}</li>
		<li>
			Cached assets: {readiness.assets
				? `${readiness.assets.total - readiness.assets.missing.length} of ${readiness.assets.total}`
				: 'not checked'}
			{#if readiness.assets && readiness.assets.missing.length > 0}
				<span class="badge bad">{readiness.assets.missing.length} missing</span>
			{/if}
		</li>
		<li>
			Database write/read check: {readiness.databaseWritable === null
				? 'not checked'
				: readiness.databaseWritable
					? 'passed'
					: 'FAILED'}
		</li>
		<li>
			Persistent storage: {readiness.persistentStorage}
			{#if readiness.storageEstimate}
				<span class="muted">
					({Math.round(readiness.storageEstimate.usage / 1024)} KB used of
					{Math.round(readiness.storageEstimate.quota / 1024 / 1024)} MB)
				</span>
			{/if}
		</li>
		<li>
			Last checked: {readiness.lastCheckedAt
				? formatDateTime(readiness.lastCheckedAt, app.timezone)
				: 'never'}
		</li>
	</ul>
	<p class="small muted">
		Browser storage is not a guaranteed permanent backup even when persistence is granted. Export a
		JSON backup after every race.
	</p>
	<div class="row tight">
		<button type="button" onclick={() => readiness.check()} disabled={readiness.checking}>
			Run readiness check
		</button>
		<button type="button" onclick={() => readiness.requestPersistentStorage()}>
			Request persistent storage
		</button>
		{#if readiness.updateWaiting}
			<button type="button" class="primary" onclick={() => readiness.applyStagedUpdate()}>
				Apply staged update and reload
			</button>
		{/if}
	</div>
	{#if readiness.updateWaiting}
		<p class="small warn">
			An app update is downloaded and waiting. It is not applied until you choose it — do this
			between heats, not mid-heat.
		</p>
	{/if}
</div>

<div class="card">
	<h2>Event</h2>
	{#if app.allEvents.length > 0}
		<div class="field">
			<label for="event-pick">Active event</label>
			<select
				id="event-pick"
				value={app.eventId ?? ''}
				onchange={(e) => app.setEvent(e.currentTarget.value || null)}
			>
				<option value="">— none —</option>
				{#each app.allEvents as ev (ev.id)}
					<option value={ev.id}>
						{ev.name}{ev.isDemo ? ' [DEMO]' : ''}{ev.workspace !== 'live'
							? ` [${ev.workspace}]`
							: ''}
					</option>
				{/each}
			</select>
		</div>
	{/if}

	{#if app.event}
		<p class="small">
			<strong>{app.event.name}</strong> · {app.event.dates.join(', ')} · {app.event.timezone}
			{#if app.event.isDemo}<span class="badge warn">Demo data — not a real log</span>{/if}
		</p>
		<div class="field">
			<label for="course-notes">Course notes</label>
			<textarea
				id="course-notes"
				value={app.event.courseNotes}
				onchange={(e) =>
					app.event && updateEvent({ ...app.event, courseNotes: e.currentTarget.value })}
			></textarea>
		</div>
	{/if}

	<details>
		<summary>Create a new event</summary>
		<div class="row">
			<div class="field">
				<label for="ev-name">Event name</label>
				<input id="ev-name" bind:value={evName} />
			</div>
			<div class="field">
				<label for="ev-date">Date</label>
				<input id="ev-date" type="date" bind:value={evDate} />
			</div>
			<div class="field">
				<label for="ev-tz">Event timezone</label>
				<select id="ev-tz" bind:value={evTz}>
					{#each timezones as tz (tz)}<option value={tz}>{tz}</option>{/each}
				</select>
			</div>
		</div>
		<div class="field">
			<label for="ev-notes">Course notes</label>
			<textarea id="ev-notes" bind:value={evNotes}></textarea>
		</div>
		<button type="button" class="primary" onclick={onCreateEvent} disabled={busy}>
			Create event
		</button>
	</details>

	<details>
		<summary>Demo race</summary>
		<p class="small muted">
			A clearly labelled demo event for training and for checking that reports look right. It is
			never mixed into a real log.
		</p>
		<div class="row tight">
			<button
				type="button"
				onclick={() => run('Demo race created.', createDemoRace)}
				disabled={busy}
			>
				Create demo race
			</button>
			{#each app.allEvents.filter((e) => e.isDemo) as demo (demo.id)}
				<button
					type="button"
					class="danger"
					onclick={() =>
						run('Demo race deleted.', async () => {
							await deleteDemoRace(demo.id);
							if (app.eventId === demo.id) await app.setEvent(null);
						})}
				>
					Delete "{demo.name}"
				</button>
			{/each}
		</div>
	</details>
</div>

{#if app.eventId}
	<div class="card">
		<h2>Station session</h2>
		{#if app.session}
			<p class="small">
				{app.session.checkpointName} · Safety boat {app.session.safetyBoatNumber} ·
				{app.session.operatorName} ({app.session.callSign}) · Ch {app.session.channel || '—'}
			</p>
			{#if app.session.checkpointLocation}
				<p class="small mono">
					Saved checkpoint: {formatCoordinates(
						app.session.checkpointLocation,
						app.coordinateFormat
					)}
				</p>
			{:else}
				<p class="small warn">No checkpoint coordinates saved. Add them before the race.</p>
			{/if}
			<div class="field">
				<label for="s-coords-edit">Update checkpoint coordinates</label>
				<input
					id="s-coords-edit"
					placeholder="45.5234 -122.6762   or   N 45 31.404 W 122 40.572"
					onchange={(e) => saveCheckpointCoords(e.currentTarget.value)}
				/>
			</div>
		{/if}
		<details open={!app.session}>
			<summary>{app.session ? 'Start a different session' : 'Start the station session'}</summary>
			<div class="row">
				<div class="field">
					<label for="s-cp">Checkpoint name</label>
					<input id="s-cp" bind:value={sCheckpoint} />
				</div>
				<div class="field">
					<label for="s-boat">Safety boat number</label>
					<input id="s-boat" bind:value={sBoat} />
				</div>
			</div>
			<div class="row">
				<div class="field">
					<label for="s-op">Operator</label>
					<input id="s-op" bind:value={sOperator} />
				</div>
				<div class="field">
					<label for="s-cs">Call sign</label>
					<input id="s-cs" bind:value={sCallSign} />
				</div>
				<div class="field">
					<label for="s-ch">Channel (optional)</label>
					<input id="s-ch" bind:value={sChannel} />
				</div>
			</div>
			<div class="field">
				<label for="s-coords">Checkpoint coordinates (optional)</label>
				<input id="s-coords" bind:value={sCoords} placeholder="45.5234 -122.6762" />
			</div>
			<button type="button" class="primary" onclick={onStartSession} disabled={busy}>
				Start session
			</button>
		</details>
	</div>

	<div class="card">
		<h2>Reporting checkpoints</h2>
		<p class="small muted">
			Mark which stations normally call passages. Silence from a station that never reports is not
			treated as a missing racer.
		</p>
		<ul class="plain small">
			{#each app.checkpoints as cp (cp.id)}
				<li class="line">
					<strong>{cp.name}</strong>
					<label class="inline">
						<input
							type="checkbox"
							checked={cp.expectedToReport}
							onchange={(e) =>
								updateCheckpoint({ ...cp, expectedToReport: e.currentTarget.checked })}
						/>
						expected to report
					</label>
					<button class="small ghost" onclick={() => removeCheckpoint(cp)}>Remove</button>
				</li>
			{/each}
		</ul>
		<div class="row">
			<div class="field">
				<label for="cp-name">Checkpoint name</label>
				<input id="cp-name" bind:value={cpName} />
			</div>
			<div class="field" style="flex:0 0 auto">
				<label class="inline" for="cp-reports">
					<input id="cp-reports" type="checkbox" bind:checked={cpReports} /> Expected to report
				</label>
			</div>
			<div class="field" style="flex:0 0 auto">
				<button type="button" onclick={onAddCheckpoint} disabled={busy}>Add checkpoint</button>
			</div>
		</div>
	</div>

	<div class="card">
		<h2>Event racer roster</h2>
		<p class="small muted">
			The roster is the pool of boats at the event. Removing a boat from a heat lineup never removes
			it from here.
		</p>
		<div class="row">
			<div class="field">
				<label for="r-boat">Boat number (text — leading zeros and letters are kept)</label>
				<input
					id="r-boat"
					bind:value={rosterBoat}
					autocapitalize="characters"
					autocomplete="off"
					onkeydown={(e) => e.key === 'Enter' && onAddRoster()}
				/>
			</div>
			<div class="field">
				<label for="r-class">Class (optional)</label>
				<input id="r-class" bind:value={rosterClass} />
			</div>
			<div class="field" style="flex:0 0 auto">
				<button type="button" onclick={onAddRoster} disabled={busy}>Add to roster</button>
			</div>
		</div>
		<div class="chips small">
			{#each app.racers as racer (racer.id)}
				<span class="rosterchip">
					<strong>{racer.boatNumber}</strong>{racer.className ? ` · ${racer.className}` : ''}
					<button
						class="small ghost"
						aria-label={`Remove ${racer.boatNumber} from the roster`}
						onclick={() => removeRacer(racer)}>×</button
					>
				</span>
			{/each}
		</div>
	</div>

	<div class="card">
		<h2>Heats and legs</h2>
		<div class="field">
			<label for="heat-pick">Active heat</label>
			<select
				id="heat-pick"
				value={app.heatId ?? ''}
				onchange={(e) => app.setHeat(e.currentTarget.value || null)}
			>
				<option value="">— none —</option>
				{#each app.heats as heat (heat.id)}
					<option value={heat.id}>{heat.name}{heat.closedAt ? ' (closed)' : ''}</option>
				{/each}
			</select>
		</div>

		{#if app.heat}
			<p class="small">
				{LEG_FORMAT_LABELS[app.heat.legFormat]} ·
				{app.heat.startMode === 'mass' ? 'Mass / group start' : 'Individual starts'}
				{#if app.heat.closedAt}
					<span class="badge dim">
						Closed {formatDateTime(app.heat.closedAt, app.timezone)} by {app.heat.closedBy}
					</span>
				{/if}
			</p>
			<p class="small muted">{LEG_FORMAT_NOTES[app.heat.legFormat]}</p>
			<div class="scroll-x">
				<table>
					<thead>
						<tr><th>Leg</th><th>Direction</th><th>Start</th><th>Finish</th></tr>
					</thead>
					<tbody>
						{#each app.legs as leg (leg.id)}
							<tr>
								<td>{leg.name}</td>
								<td>
									<select
										aria-label={`Direction for ${leg.name}`}
										value={leg.direction}
										onchange={(e) =>
											updateLeg(
												{ ...leg, direction: e.currentTarget.value as never },
												app.eventId as Id
											)}
									>
										{#each Object.entries(DIRECTION_LABELS) as [value, label] (value)}
											<option {value}>{label}</option>
										{/each}
									</select>
								</td>
								<td>
									<input
										type="checkbox"
										aria-label={`${leg.name} has a start`}
										checked={leg.hasStart}
										onchange={(e) =>
											updateLeg({ ...leg, hasStart: e.currentTarget.checked }, app.eventId as Id)}
									/>
								</td>
								<td>
									<input
										type="checkbox"
										aria-label={`${leg.name} has a finish`}
										checked={leg.hasFinish}
										onchange={(e) =>
											updateLeg({ ...leg, hasFinish: e.currentTarget.checked }, app.eventId as Id)}
									/>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="row tight" style="margin-top:0.6rem">
				{#if app.heat.closedAt}
					<button type="button" onclick={() => app.heat && reopenHeat(app.heat)}>
						Reopen heat
					</button>
				{:else}
					<button
						type="button"
						onclick={() => app.heat && closeHeat(app.heat, app.session?.operatorName ?? 'operator')}
					>
						Close heat (administrative)
					</button>
				{/if}
			</div>
			<p class="small muted">
				Closing a heat is your administrative action. It is separate from the heat-complete radio
				call, and neither one fills in a missing observation or invents a finish. Closed heats stay
				reviewable and correctable.
			</p>
		{/if}

		<details>
			<summary>Create a heat</summary>
			<div class="row">
				<div class="field">
					<label for="h-name">Heat name</label>
					<input id="h-name" bind:value={heatName} />
				</div>
				<div class="field">
					<label for="h-format">Leg format</label>
					<select id="h-format" bind:value={heatFormat}>
						{#each Object.entries(LEG_FORMAT_LABELS) as [value, label] (value)}
							<option {value}>{label}</option>
						{/each}
					</select>
				</div>
				{#if heatFormat === 'separate-legs'}
					<div class="field">
						<label for="h-legs">Number of legs</label>
						<input id="h-legs" type="number" min="1" max="10" bind:value={heatLegCount} />
					</div>
				{/if}
				<div class="field">
					<label for="h-start">Start mode</label>
					<select id="h-start" bind:value={heatStartMode}>
						<option value="individual">Staggered individual starts</option>
						<option value="mass">Class / group mass start</option>
					</select>
				</div>
			</div>
			<p class="small muted">{LEG_FORMAT_NOTES[heatFormat]}</p>
			{#if app.heats.length > 0}
				<div class="field">
					<label for="h-copy">Copy lineup from</label>
					<select id="h-copy" bind:value={copySourceHeat}>
						<option value="">— start empty —</option>
						{#each app.heats as heat (heat.id)}
							<option value={heat.id}>{heat.name}</option>
						{/each}
					</select>
					<p class="small muted">
						Copies boats and order only. Previous results, times, DNF and scratches are never
						carried over — a boat that DNF'd can be selected, and a finisher can be left out.
					</p>
				</div>
			{/if}
			<button type="button" class="primary" onclick={onCreateHeat} disabled={busy}>
				Create heat
			</button>
		</details>
	</div>

	{#if app.heatId}
		<div class="card">
			<h2>Starting order — {app.heat?.name}</h2>
			<p class="small muted">
				The order arrives over the radio before each heat. Type a number and press Enter; the box
				clears immediately so you can keep going.
			</p>
			<div class="row">
				<div class="field">
					<label for="l-boat">Boat number</label>
					<input
						id="l-boat"
						bind:value={lineupBoat}
						autocapitalize="characters"
						autocomplete="off"
						onkeydown={(e) => e.key === 'Enter' && onAddToLineup()}
					/>
				</div>
				<div class="field">
					<label for="l-class">Class for this batch</label>
					<input id="l-class" bind:value={lineupClass} placeholder="Applied to boats you add now" />
				</div>
				<div class="field" style="flex:0 0 auto">
					<button type="button" onclick={onAddToLineup} disabled={busy}>Add</button>
				</div>
			</div>

			<details>
				<summary>Paste a list</summary>
				<div class="field">
					<label for="l-paste">One boat per line, or comma separated</label>
					<textarea id="l-paste" bind:value={pasteText}></textarea>
				</div>
				<button type="button" onclick={onPasteLineup} disabled={busy}>Add pasted boats</button>
			</details>

			<LineupImport onDone={(n) => (message = `${n} boat(s) imported into the lineup.`)} />

			<div class="scroll-x">
				<table>
					<thead>
						<tr>
							<th>Order</th>
							<th>Boat</th>
							<th>Class</th>
							<th>Participation</th>
							<th>Note</th>
							<th>Move</th>
						</tr>
					</thead>
					<tbody>
						{#each app.participants as p (p.id)}
							<tr>
								<td class="mono">{p.startOrder}</td>
								<td><strong>{app.racerById(p.racerId)?.boatNumber ?? '?'}</strong></td>
								<td>{p.className || app.racerById(p.racerId)?.className || ''}</td>
								<td>
									<select
										aria-label={`Participation for boat ${app.racerById(p.racerId)?.boatNumber}`}
										value={p.participation}
										onchange={(e) =>
											setParticipation(
												app.eventId as Id,
												p,
												e.currentTarget.value as ParticipationState,
												p.participationNote
											)}
									>
										{#each participationOptions as opt (opt)}
											<option value={opt}>{opt.toUpperCase()}</option>
										{/each}
									</select>
								</td>
								<td>
									<input
										aria-label="Participation note"
										value={p.participationNote}
										onchange={(e) =>
											setParticipation(
												app.eventId as Id,
												p,
												p.participation,
												e.currentTarget.value
											)}
									/>
								</td>
								<td class="nowrap">
									<button class="small" aria-label="Move up" onclick={() => move(p, -1)}>↑</button>
									<button class="small" aria-label="Move down" onclick={() => move(p, 1)}>↓</button>
									<button
										class="small ghost"
										aria-label="Remove from lineup"
										onclick={() => removeFromLineup(app.eventId as Id, p)}
									>
										Remove
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="small muted">
				Removing from the lineup leaves the event roster untouched. Scratching keeps the boat listed
				and marked, which is usually what you want once the order has been read out.
			</p>
		</div>
	{/if}

	<div class="card">
		<h2>Review prompt settings</h2>
		<div class="field">
			<label for="overdue">Overdue threshold (minutes after a start is heard)</label>
			<input
				id="overdue"
				type="number"
				min="1"
				bind:value={overdueMinutes}
				placeholder="Leave blank for no overdue prompts"
				onchange={() =>
					app.setOverdueThreshold(overdueMinutes === '' ? null : Number(overdueMinutes) * 60_000)}
			/>
		</div>
		<p class="small muted">
			With no threshold set the app never decides a boat is overdue, and it never infers a missing
			racer from starting order alone.
		</p>
	</div>
{/if}

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
	.line {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		padding: 0.25rem 0;
		border-bottom: 1px solid var(--line);
	}
	.inline {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
	}
	.inline input[type='checkbox'] {
		width: 1.4rem;
		min-height: 1.4rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.5rem;
	}
	.rosterchip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.15rem 0.3rem 0.15rem 0.55rem;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
	}
	td input[type='checkbox'] {
		width: 1.5rem;
		min-height: 1.5rem;
	}
	.nowrap {
		white-space: nowrap;
	}
	.warn {
		color: var(--warn);
	}
</style>
