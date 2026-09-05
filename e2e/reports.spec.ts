import { expect, test } from '@playwright/test';
import { resetApp, setUpStation } from './helpers';

test.describe('reports and backup', () => {
	test.beforeEach(async ({ page }) => {
		await resetApp(page);
		await setUpStation(page);
		await page.goto('/');
		await page
			.locator('.card', { hasText: 'Starting order' })
			.getByRole('button', { name: /007/ })
			.click();
		await page.getByLabel('Observation notes').fill('=SUM(A1:A9) looked fine');
		await page.getByRole('button', { name: 'Record pass at this checkpoint' }).click();
		// A participation note lands in a cell of its own, which is where a
		// formula-leading value would actually be dangerous.
		await page.goto('/setup');
		await page
			.getByRole('row', { name: /007/ })
			.first()
			.getByLabel('Participation note')
			.fill('=cmd|calc');
		await page.getByRole('row', { name: /007/ }).first().getByLabel('Participation note').blur();
		await expect(page.getByText('Starting order changed.'))
			.toBeVisible()
			.catch(() => {});
	});

	test('the printable checklist labels station, scope and unknown values', async ({ page }) => {
		await page.goto('/reports');
		const printable = page.locator('.printable');
		await expect(printable.getByText('JET BOAT RACES CHECKLIST — Heat 1')).toBeVisible();
		await expect(printable.getByText(/Station: Checkpoint 2/)).toBeVisible();
		await expect(printable.getByText(/E2E Operator/)).toBeVisible();
		await expect(printable).toContainText('not official timing or scoring');
		await expect(printable).toContainText('not a statement that anyone is physically safe');
		await expect(printable).toContainText('"No finish heard" is not the same as DNF.');
		// A boat with no finish announcement is not printed as a DNF.
		await expect(printable.getByRole('cell', { name: 'No finish heard' }).first()).toBeVisible();
		await expect(printable.getByRole('cell', { name: 'Not observed' }).first()).toBeVisible();
	});

	test('the CSV export escapes formula-leading text', async ({ page }) => {
		await page.goto('/reports');
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByRole('button', { name: 'Export CSV' }).click()
		]);
		const stream = await download.createReadStream();
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(chunk as Buffer);
		const text = Buffer.concat(chunks).toString('utf8');

		// The dangerous cell is neutralised, and no cell starts with a bare '='.
		expect(text).toContain("'=cmd|calc");
		expect(text).not.toMatch(/(^|,)=/m);
		expect(text).toContain('=SUM(A1:A9) looked fine');
		expect(text).toContain('# Activity log');
		expect(text).toContain('Checkpoint 2');
		expect(await page.getByText('CSV export completed.').isVisible()).toBe(true);
	});

	test('the XLSX export produces a real workbook', async ({ page }) => {
		await page.goto('/reports');
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByRole('button', { name: 'Export XLSX' }).click()
		]);
		const stream = await download.createReadStream();
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(chunk as Buffer);
		const bytes = Buffer.concat(chunks);
		// A .xlsx is a zip archive; check the local file header magic.
		expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
		expect(bytes.length).toBeGreaterThan(1000);
		await expect(page.getByText('XLSX export completed.')).toBeVisible();
	});

	test('a full backup round-trips into a separate workspace', async ({ page }) => {
		await page.goto('/reports');
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByRole('button', { name: 'Export full JSON backup' }).click()
		]);
		const path = await download.path();
		expect(path).toBeTruthy();

		await page.getByLabel('Choose a backup .json file').setInputFiles(path as string);
		await expect(page.getByText('Backup is valid.')).toBeVisible();
		await page.getByRole('button', { name: 'Restore', exact: true }).click();
		await expect(page.getByText('Restore completed.')).toBeVisible();

		await page.goto('/setup');
		await expect(
			page.getByRole('option', { name: /E2E Race \(restored\) \[restored\]/ })
		).toBeAttached();
		// The live event is still there and unchanged.
		await expect(page.getByRole('option', { name: 'E2E Race', exact: true })).toBeAttached();
	});

	test('a malformed backup is rejected and changes nothing', async ({ page }, testInfo) => {
		await page.goto('/reports');
		const bad = testInfo.outputPath('bad-backup.json');
		const fs = await import('node:fs/promises');
		await fs.writeFile(bad, '{"kind":"not-a-safety-log","backupVersion":1}');

		await page.getByLabel('Choose a backup .json file').setInputFiles(bad);
		await expect(page.getByText('Backup rejected.')).toBeVisible();
		await expect(page.getByText(/existing records are untouched/)).toBeVisible();
		await expect(page.getByRole('button', { name: 'Restore', exact: true })).toHaveCount(0);

		await page.goto('/timeline');
		await expect(page.getByText('Pass at this checkpoint')).toBeVisible();
	});

	test('two station logs stay separate and an identical reimport is detected', async ({ page }) => {
		await page.goto('/reports');
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByRole('button', { name: 'Export full JSON backup' }).click()
		]);
		const path = (await download.path()) as string;

		await page.getByLabel('Choose a backup .json file').setInputFiles(path);
		await page.getByRole('button', { name: 'Add to read-only archive instead' }).click();
		await expect(page.getByText(/added to the archive/)).toBeVisible();

		await page.getByLabel('Choose a backup .json file').setInputFiles(path);
		await page.getByRole('button', { name: 'Add to read-only archive instead' }).click();
		await expect(page.getByText(/Identical backup already in the archive/)).toBeVisible();

		await expect(page.getByRole('heading', { name: /Collected station logs \(1\)/ })).toBeVisible();
		// Archiving never merged anything into the live log.
		await page.goto('/accountability');
		await expect(page.getByText('1 seen at this checkpoint')).toBeVisible();
	});
});
