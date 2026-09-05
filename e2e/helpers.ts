import type { Page } from '@playwright/test';

/** Clears IndexedDB and localStorage so each spec starts from nothing. */
export async function resetApp(page: Page): Promise<void> {
	await page.goto('/');
	await page.evaluate(async () => {
		localStorage.clear();
		const dbs = (await indexedDB.databases?.()) ?? [];
		await Promise.all(
			dbs.map(
				(d) =>
					new Promise<void>((resolve) => {
						if (!d.name) return resolve();
						const req = indexedDB.deleteDatabase(d.name);
						req.onsuccess = req.onerror = req.onblocked = () => resolve();
					})
			)
		);
	});
	await page.reload();
	await page.waitForLoadState('networkidle');
}

export interface StationOptions {
	event?: string;
	checkpoint?: string;
	operator?: string;
	boats?: string[];
	heat?: string;
	legFormat?: string;
}

/** Sets up an event, session, heat and lineup through the real UI. */
export async function setUpStation(page: Page, options: StationOptions = {}): Promise<void> {
	const {
		event = 'E2E Race',
		checkpoint = 'Checkpoint 2',
		operator = 'E2E Operator',
		boats = ['007', '12', '4B'],
		heat = 'Heat 1',
		legFormat = 'continuous-down-and-back'
	} = options;

	await page.goto('/setup');
	await page.getByText('Create a new event').click();
	await page.getByLabel('Event name').fill(event);
	await page.getByRole('button', { name: 'Create event' }).click();
	await page.getByText('Event created.').waitFor();

	await page.getByLabel('Checkpoint name', { exact: true }).first().fill(checkpoint);
	await page.getByLabel('Safety boat number').fill('SB-2');
	await page.getByLabel('Operator', { exact: true }).fill(operator);
	await page.getByLabel('Call sign').fill('Safety Two');
	await page.getByRole('button', { name: 'Start session' }).click();
	await page.getByText('Station session started.').waitFor();

	await page.getByText('Create a heat').click();
	await page.getByLabel('Heat name').fill(heat);
	await page.getByLabel('Leg format').selectOption(legFormat);
	await page.getByRole('button', { name: 'Create heat' }).click();
	await page.getByText('Heat created.').waitFor();

	for (const boat of boats) {
		await page.getByLabel('Boat number', { exact: true }).fill(boat);
		await page.getByLabel('Boat number', { exact: true }).press('Enter');
		await page.getByText(`Boat ${boat} added to the lineup.`).waitFor();
	}
}
