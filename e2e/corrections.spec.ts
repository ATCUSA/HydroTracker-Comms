import { expect, test } from '@playwright/test';
import { resetApp, setUpStation } from './helpers';

test.describe('corrections, audit and void', () => {
	test.beforeEach(async ({ page }) => {
		await resetApp(page);
		await setUpStation(page);
	});

	test('an edited time and reassigned boat keep the original record and history', async ({
		page
	}) => {
		await page.goto('/');
		await page
			.locator('.card', { hasText: 'Starting order' })
			.getByRole('button', { name: /007/ })
			.click();
		await page.getByRole('button', { name: 'Record pass at this checkpoint' }).click();

		await page.goto('/timeline');
		await page.getByRole('button', { name: 'Edit…' }).first().click();
		await page.getByLabel('Effective time (HH:MM:SS.hh)').fill('09:15:00.00');
		await page.locator('#e-boat').selectOption({ label: '12' });
		await page.getByLabel('Reason for the correction (required)').fill('Misheard the number');
		await page.getByRole('button', { name: 'Save correction' }).click();

		await expect(page.getByText('09:15:00.00')).toBeVisible();
		// The original capture time is still shown alongside the corrected one.
		await expect(page.getByText(/captured \d\d:\d\d:\d\d\.\d\d/)).toBeVisible();

		await page.getByRole('button', { name: 'Edit…' }).first().click();
		await expect(page.getByRole('heading', { name: 'Change history' })).toBeVisible();
		await expect(page.getByText('Misheard the number')).toBeVisible();
		await expect(page.getByText('effectiveTime:')).toBeVisible();
		await expect(page.getByText('participantId:')).toBeVisible();
	});

	test('a correction without a reason is refused', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: 'Record pass at this checkpoint' }).click();
		await page.goto('/timeline');
		await page.getByRole('button', { name: 'Edit…' }).first().click();
		await page.getByRole('button', { name: 'Save correction' }).click();
		await expect(page.getByText(/Give a reason for the correction/)).toBeVisible();
	});

	test('voiding hides the record from accountability but keeps it restorable', async ({ page }) => {
		await page.goto('/');
		await page
			.locator('.card', { hasText: 'Starting order' })
			.getByRole('button', { name: /007/ })
			.click();
		await page.getByRole('button', { name: 'Record pass at this checkpoint' }).click();

		await page.goto('/timeline');
		page.once('dialog', (dialog) => dialog.accept('mis-tap'));
		await page.getByRole('button', { name: 'Void' }).first().click();
		await expect(page.getByRole('button', { name: 'Void' })).toHaveCount(0);

		await page.getByLabel('Show voided').check();
		await expect(page.locator('.badge', { hasText: 'voided' })).toBeVisible();

		await page.goto('/accountability');
		await expect(page.getByText('0 seen at this checkpoint')).toBeVisible();

		await page.goto('/timeline');
		await page.getByLabel('Show voided').check();
		await page.getByRole('button', { name: 'Restore' }).first().click();
		await expect(page.locator('.badge', { hasText: 'voided' })).toHaveCount(0);

		await page.goto('/accountability');
		await expect(page.getByText('1 seen at this checkpoint')).toBeVisible();
	});

	test('a radio checkpoint pass keeps its received time and takes a reported time later', async ({
		page
	}) => {
		await page.goto('/setup');
		await page.getByLabel('Checkpoint name', { exact: true }).last().fill('Checkpoint 1');
		await page.getByRole('button', { name: 'Add checkpoint' }).click();

		await page.goto('/');
		await page.getByRole('button', { name: 'Checkpoint report…' }).click();
		await page.getByLabel('Reporting checkpoint').selectOption({ label: 'Checkpoint 1' });
		await page.getByLabel('Boat', { exact: true }).fill('007');
		await page.getByRole('button', { name: 'Log checkpoint report' }).click();
		await expect(page.getByText(/time you received it/)).toBeVisible();

		await page.goto('/timeline');
		await page.getByRole('button', { name: 'Edit…' }).first().click();
		await page.getByLabel('Reported occurrence time (optional)').fill('09:02:30.00');
		await page.getByLabel('Reason for the correction (required)').fill('CP1 gave the actual time');
		await page.getByRole('button', { name: 'Save correction' }).click();

		await expect(page.getByText('reported 09:02:30.00')).toBeVisible();
		// The received time is untouched by adding a reported time.
		await expect(page.getByText(/Radio checkpoint pass|Checkpoint report/)).toBeVisible();
	});

	test('copying a heat lineup carries no previous outcome', async ({ page }) => {
		await page.goto('/');
		await page
			.locator('.card', { hasText: 'Starting order' })
			.getByRole('button', { name: /007/ })
			.click();
		await page.getByRole('button', { name: 'Record pass at this checkpoint' }).click();

		await page.goto('/setup');
		// Mark 12 as a DNF in heat 1.
		const row = page.getByRole('row', { name: /12/ }).first();
		await row.getByRole('combobox').selectOption('dnf');

		await page.getByText('Create a heat').click();
		await page.getByLabel('Heat name').fill('Heat 2');
		await page.getByLabel('Leg format').selectOption('one-way');
		await page.getByLabel('Copy lineup from').selectOption({ label: 'Heat 1' });
		await page.getByRole('button', { name: 'Create heat' }).click();
		await expect(page.getByText(/Times, DNF and scratches were not copied/)).toBeVisible();

		await page.goto('/accountability');
		// Every boat starts the new heat as a plain entry with no observations.
		await expect(page.getByText('3 on the lineup')).toBeVisible();
		await expect(page.getByText('0 DNF')).toBeVisible();
		await expect(page.getByText('0 seen at this checkpoint')).toBeVisible();
	});
});
