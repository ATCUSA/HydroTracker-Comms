import { expect, test } from '@playwright/test';
import { resetApp, setUpStation } from './helpers';

test.describe('field capture', () => {
	test.beforeEach(async ({ page }) => {
		await resetApp(page);
		await setUpStation(page);
		await page.goto('/');
	});

	test('one intentional tap creates exactly one observation, a second creates another', async ({
		page
	}) => {
		const record = page.getByRole('button', { name: 'Record pass at this checkpoint' });
		await record.click();
		await expect(page.getByRole('heading', { name: /Unassigned captures \(1\)/ })).toBeVisible();
		await record.click();
		await expect(page.getByRole('heading', { name: /Unassigned captures \(2\)/ })).toBeVisible();
	});

	test('rapid consecutive captures stay distinct and in capture order', async ({ page }) => {
		const record = page.getByRole('button', { name: 'Record pass at this checkpoint' });
		for (let i = 0; i < 5; i += 1) await record.click();
		await expect(page.getByRole('heading', { name: /Unassigned captures \(5\)/ })).toBeVisible();

		const times = await page.locator('.unassigned .mono').allTextContents();
		expect(times).toHaveLength(5);
		// Times are non-decreasing, i.e. still in the order they were captured.
		const sorted = [...times].sort();
		expect(times).toEqual(sorted);
	});

	test('an unassigned capture is saved immediately and assigned afterwards', async ({ page }) => {
		await page.getByRole('button', { name: 'Record pass at this checkpoint' }).click();
		await expect(page.getByText(/pass recorded at/)).toBeVisible();
		await expect(page.locator('.badge', { hasText: 'saved' }).first()).toBeVisible();

		await page.getByLabel('Assign boat to this record').first().selectOption({ label: '007' });
		await expect(page.getByRole('heading', { name: /Unassigned captures/ })).toBeHidden();

		await page.goto('/accountability');
		await expect(page.getByRole('row', { name: /007/ })).toBeVisible();
	});

	test('a form left open does not block another pass or delete the marker', async ({ page }) => {
		await page.getByRole('button', { name: 'Radio…' }).click();
		await page.getByRole('textbox', { name: 'Message' }).fill('partial message, never sent');
		// The pass control stays reachable with the radio form still open.
		await page.getByRole('button', { name: 'Record pass at this checkpoint' }).click();
		await expect(page.getByRole('heading', { name: /Unassigned captures \(1\)/ })).toBeVisible();
		await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(
			'partial message, never sent'
		);
	});

	test('a mass start writes one shared timestamp to the selected boats only', async ({ page }) => {
		await page.getByRole('button', { name: 'Mass start…' }).click();
		const massGroup = page.locator('.card', { hasText: 'Mass start — select participants' });
		await massGroup.getByRole('button', { name: /007/ }).click();
		await massGroup.getByRole('button', { name: /12/ }).click();
		await page.getByRole('button', { name: /Record mass start for 2 boat/ }).click();
		await expect(page.getByText(/Mass start recorded for 2 boat/)).toBeVisible();

		await page.goto('/accountability');
		const rows = page.locator('tbody tr');
		await expect(rows.nth(0).locator('td').nth(4)).not.toHaveText('Not observed');
		await expect(rows.nth(1).locator('td').nth(4)).not.toHaveText('Not observed');
		// The third boat was not selected and gets nothing.
		await expect(rows.nth(2).locator('td').nth(4)).toHaveText('Not observed');

		const first = await rows.nth(0).locator('td').nth(4).textContent();
		const second = await rows.nth(1).locator('td').nth(4).textContent();
		expect(first).toBe(second);
	});

	test('a local pass does not imply a finish', async ({ page }) => {
		await page
			.locator('.card', { hasText: 'Starting order' })
			.getByRole('button', { name: /007/ })
			.click();
		await page.getByRole('button', { name: 'Record pass at this checkpoint' }).click();
		await page.goto('/accountability');
		const row = page.locator('tbody tr').first();
		await expect(row).toContainText('Not observed');
		await expect(page.getByText('0 finish heard')).toBeVisible();
	});

	test('the heat-complete call is separate from closing the heat and fills nothing in', async ({
		page
	}) => {
		await page.getByRole('button', { name: 'Heat complete call' }).click();
		await expect(page.getByText(/does not close the heat/)).toBeVisible();

		await page.goto('/accountability');
		await expect(page.getByText('0 finish heard')).toBeVisible();
		await expect(page.getByText('3 not seen here')).toBeVisible();

		await page.goto('/setup');
		await page.getByRole('button', { name: 'Close heat (administrative)' }).click();
		await page.goto('/accountability');
		// Closing changed no observation.
		await expect(page.getByText('0 finish heard')).toBeVisible();
		await expect(page.getByText('3 not seen here')).toBeVisible();
	});

	test('a continuous down-and-back keeps one start with two directional passes', async ({
		page
	}) => {
		await page.goto('/setup');
		await expect(page.getByRole('cell', { name: 'Outbound', exact: true })).toBeVisible();
		await expect(page.getByRole('cell', { name: 'Return', exact: true })).toBeVisible();
		// One start checkbox ticked across both legs.
		const startBoxes = page.getByRole('checkbox', { name: /has a start/ });
		await expect(startBoxes.nth(0)).toBeChecked();
		await expect(startBoxes.nth(1)).not.toBeChecked();

		await page.goto('/');
		const boat = page
			.locator('.card', { hasText: 'Starting order' })
			.getByRole('button', { name: /007/ });
		await boat.click();
		await page.getByRole('button', { name: 'Start heard' }).click();
		await page.getByRole('button', { name: 'Record pass at this checkpoint' }).click();
		await page.getByLabel('Leg').selectOption({ label: 'Return (upstream)' });
		await page.getByRole('button', { name: 'Record pass at this checkpoint' }).click();

		await page.goto('/accountability');
		const row = page.locator('tbody tr').first();
		// Start, outbound pass and return pass are each populated once.
		await expect(row.locator('td').nth(4)).not.toHaveText('Not observed');
		await expect(row.locator('td').nth(5)).not.toHaveText('Not observed');
		await expect(row.locator('td').nth(6)).not.toHaveText('Not observed');
	});

	test('a nonreporting checkpoint produces no missing-passage prompt', async ({ page }) => {
		await page.goto('/setup');
		await page.getByLabel('Checkpoint name', { exact: true }).last().fill('Silent Landing');
		await page.getByLabel('Expected to report').uncheck();
		await page.getByRole('button', { name: 'Add checkpoint' }).click();
		await expect(page.getByText('Reporting checkpoint added.')).toBeVisible();

		await page.goto('/accountability');
		await expect(page.getByRole('cell', { name: 'Not expected to report' }).first()).toBeVisible();

		await page.goto('/timeline');
		await expect(page.getByText(/Silent Landing/)).toHaveCount(0);
	});
});
