import { getDb } from '$lib/db/db';
import { buildAccountability } from '$lib/domain/accountability';
import { buildTimeline } from '$lib/domain/timeline';
import { download, slug, toCsv, type Sheet } from '$lib/export/csv';
import { buildXlsxBlob } from '$lib/export/xlsx';
import {
	activityLogSheet,
	contextSheet,
	correctionsSheet,
	heatChecklistSheet,
	incidentSheet,
	type ReportContext
} from './builders';
import { buildBackup, type BackupDocument } from '$lib/export/backup';
import { app } from '$lib/stores/app.svelte';
import { formatDate, nowMs } from '$lib/time/clock';
import type { Id } from '$lib/domain/types';

export const APP_VERSION = '1.0.0';

export function reportContext(): ReportContext {
	const event = app.event;
	if (!event) throw new Error('Select an event first.');
	return {
		event,
		session: app.session,
		timezone: app.timezone,
		generatedAt: nowMs(),
		coordinateFormat: app.coordinateFormat
	};
}

/** All sheets for the current event, in the order they appear in the workbook. */
export async function buildAllSheets(): Promise<Sheet[]> {
	const ctx = reportContext();
	const db = getDb();
	const sheets: Sheet[] = [contextSheet(ctx)];

	for (const heat of app.heats) {
		const legs = app.legsOf(heat.id);
		const participants = app.participantsOf(heat.id);
		const acc = buildAccountability({
			heat,
			legs,
			participants,
			racers: app.racers,
			observations: app.observations.filter((o) => o.heatId === heat.id),
			checkpoints: app.checkpoints
		});
		sheets.push(heatChecklistSheet(ctx, heat, legs, app.checkpoints, acc));
	}

	const timeline = buildTimeline({
		observations: app.observations,
		radio: app.radioMessages,
		eventLog: app.eventLogEntries,
		incidents: app.incidents,
		incidentActions: app.incidentActions.filter((a) => a.eventId === app.eventId),
		heats: app.heats,
		boatNumberFor: (id) => app.boatNumberFor(id)
	});
	sheets.push(activityLogSheet(ctx, timeline));
	sheets.push(
		incidentSheet(
			ctx,
			app.incidents.filter((i) => !i.voided),
			app.incidentActions.filter((a) => a.eventId === app.eventId)
		)
	);

	const revisions = await db.revisions
		.where('eventId')
		.equals(app.eventId as Id)
		.toArray();
	sheets.push(
		correctionsSheet(
			ctx,
			revisions.sort((a, b) => a.sequence - b.sequence)
		)
	);

	return sheets;
}

function baseName(): string {
	const ctx = reportContext();
	return `${slug(ctx.event.name)}_${slug(ctx.session?.checkpointName ?? 'station')}_${formatDate(ctx.generatedAt, ctx.timezone)}`;
}

/** One CSV per sheet, concatenated with a header line naming each section. */
export async function exportCsv(): Promise<void> {
	const sheets = await buildAllSheets();
	const parts = sheets.map((sheet) => `# ${sheet.name}\r\n${toCsv(sheet.rows)}`);
	download(`${baseName()}.csv`, parts.join('\r\n\r\n'), 'text/csv;charset=utf-8');
}

export async function exportXlsx(): Promise<void> {
	const sheets = await buildAllSheets();
	const blob = await buildXlsxBlob(sheets);
	download(
		`${baseName()}.xlsx`,
		blob,
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	);
}

export async function exportBackup(): Promise<BackupDocument> {
	const doc = await buildBackup(app.eventId as Id, APP_VERSION);
	download(`${baseName()}_backup.json`, JSON.stringify(doc, null, 2), 'application/json');
	return doc;
}
