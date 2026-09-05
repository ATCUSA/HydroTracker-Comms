import { expect, test } from '@playwright/test';
import { resetApp, setUpStation } from './helpers';

test.describe('setup and configuration', () => {
	test('the demo race is clearly separated from real logs', async ({ page }) => {
		await resetApp(page);
		await setUpStation(page, { event: 'Real Race' });

		await page.goto('/setup');
		await page.getByText('Demo race', { exact: true }).click();
		await page.getByRole('button', { name: 'Create demo race' }).click();
		await expect(page.getByText('Demo race created.')).toBeVisible({ timeout: 20_000 });

		// It is labelled everywhere it appears and is its own event.
		await expect(page.getByText('Demo data — not a real log')).toBeVisible();
		await expect(page.getByRole('option', { name: /DEMO RACE.*\[DEMO\]/ })).toBeAttached();
		await expect(page.getByRole('option', { name: 'Real Race', exact: true })).toBeAttached();

		// Its reports say so too.
		await page.goto('/reports');
		await expect(page.locator('.printable')).toContainText('DEMO DATA — NOT A REAL LOG');

		// Deleting it leaves the real event alone.
		await page.goto('/setup');
		await page.getByText('Demo race', { exact: true }).click();
		await page.getByRole('button', { name: /Delete "DEMO RACE/ }).click();
		await expect(page.getByText('Demo race deleted.')).toBeVisible();
		await expect(page.getByRole('option', { name: /\[DEMO\]/ })).toHaveCount(0);
		await expect(page.getByRole('option', { name: 'Real Race', exact: true })).toBeAttached();
	});

	test('quick phrases are editable and reach the Live screen', async ({ page }) => {
		await resetApp(page);
		await setUpStation(page);

		await page.goto('/setup');
		await page.getByLabel('New phrase').fill('Debris in the channel');
		await page.getByRole('button', { name: 'Add phrase' }).click();
		await expect(page.getByText('Quick phrase added.')).toBeVisible();

		await page.goto('/');
		const phrase = page.getByRole('button', { name: 'Debris in the channel' });
		await expect(phrase).toBeVisible();
		await phrase.click();
		await expect(page.getByText('Logged: Debris in the channel')).toBeVisible();

		await page.goto('/timeline');
		await expect(page.getByText('Debris in the channel')).toBeVisible();
	});

	test('a lineup imports from a CSV that does not match the checklist layout', async ({
		page
	}, testInfo) => {
		await resetApp(page);
		await setUpStation(page, { boats: [] });

		const fs = await import('node:fs/promises');
		const csv = testInfo.outputPath('entries.csv');
		// Deliberately an unrelated layout: extra columns, different order, and a
		// boat number that must stay text.
		await fs.writeFile(
			csv,
			'Team,Division,Hull no.,Sponsor\nAlpha,A,007,Someone\nBravo,B,4B,Another\nCharlie,A,12,Third\n'
		);

		await page.getByText('Import a lineup from CSV or XLSX').click();
		await page.getByLabel('Choose a .csv, .tsv or .xlsx file').setInputFiles(csv);

		await page.getByLabel('Map column 3').selectOption('boatNumber');
		await page.getByLabel('Map column 2').selectOption('className');
		await expect(page.getByText('3 boat(s) ready to import.')).toBeVisible();

		await page.getByRole('button', { name: /Confirm import of 3 boat/ }).click();
		await expect(page.getByText('3 boat(s) imported into the lineup.')).toBeVisible();

		// Leading zeros and letters survive.
		await expect(page.getByRole('cell', { name: '007', exact: true })).toBeVisible();
		await expect(page.getByRole('cell', { name: '4B', exact: true })).toBeVisible();
	});

	test('a radio message can be logged without a heat', async ({ page }) => {
		await resetApp(page);
		await setUpStation(page);

		await page.goto('/');
		await page.getByRole('button', { name: 'Radio…' }).click();
		await page.getByRole('textbox', { name: 'Message' }).fill('Radio check, all stations');
		await page.getByLabel('Not tied to a heat').check();
		await page.getByRole('button', { name: 'Log radio message' }).click();
		await expect(page.getByText('Radio message logged.')).toBeVisible();

		await page.goto('/timeline');
		await expect(page.getByText('Radio check, all stations')).toBeVisible();
		// Filtering to the heat excludes it, because it belongs to no heat.
		await page.getByLabel('Heat').selectOption({ label: 'Heat 1' });
		await expect(page.getByText('Radio check, all stations')).toHaveCount(0);
	});

	test('an unsent draft survives a reload', async ({ page }) => {
		await resetApp(page);
		await setUpStation(page);

		await page.goto('/');
		await page.getByLabel('Observation notes').fill('half-written note');
		await page.getByRole('button', { name: 'Radio…' }).click();
		await page.getByRole('textbox', { name: 'Message' }).fill('partial traffic');
		await page.waitForTimeout(700); // let the debounced save land

		await page.reload();
		await expect(page.getByLabel('Observation notes')).toHaveValue('half-written note');
		await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('partial traffic');
		// Restoring a draft creates no record.
		await expect(page.getByRole('heading', { name: /Unassigned captures/ })).toHaveCount(0);
	});

	test('a radio message can be voided and restored with audit history', async ({ page }) => {
		await resetApp(page);
		await setUpStation(page);

		await page.goto('/');
		await page.getByRole('button', { name: 'Radio…' }).click();
		await page.getByRole('textbox', { name: 'Message' }).fill('Course hold in effect');
		await page.getByRole('button', { name: 'Log radio message' }).click();

		await page.goto('/timeline');
		page.once('dialog', (dialog) => dialog.accept('logged twice'));
		await page.getByRole('button', { name: 'Void' }).first().click();
		await expect(page.getByText('Course hold in effect')).toHaveCount(0);

		await page.getByLabel('Show voided').check();
		await expect(page.locator('.badge', { hasText: 'voided' })).toBeVisible();
		await page.getByRole('button', { name: 'Restore' }).first().click();
		await expect(page.locator('.badge', { hasText: 'voided' })).toHaveCount(0);
	});
});
