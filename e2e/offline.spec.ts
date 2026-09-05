import { expect, test } from '@playwright/test';
import { resetApp, setUpStation } from './helpers';

test.describe('offline operation', () => {
	test('every operational screen cold-opens offline and captured records survive', async ({
		page,
		context
	}) => {
		await resetApp(page);
		await setUpStation(page);

		// Prepare the cache while online, as the pre-race checklist requires.
		await page.goto('/setup');
		await page.getByRole('button', { name: 'Run readiness check' }).click();
		await expect(
			page
				.locator('.card', { hasText: 'Offline readiness' })
				.getByText(/Offline ready|Partly cached/)
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText(/Cached assets: (\d+) of \1/)).toBeVisible();

		await context.setOffline(true);

		// Cold-open each route with no network at all.
		for (const route of ['/', '/accountability', '/timeline', '/setup', '/reports']) {
			await page.goto(route);
			await expect(page.locator('nav')).toBeVisible();
		}

		await page.goto('/');
		await page.getByRole('button', { name: 'Record pass at this checkpoint' }).click();
		await expect(page.locator('.badge', { hasText: 'saved' }).first()).toBeVisible();

		// Close and cold-open again, still offline.
		await page.reload();
		await expect(page.getByRole('heading', { name: /Unassigned captures \(1\)/ })).toBeVisible();

		await page.goto('/timeline');
		await expect(page.getByText('Pass at this checkpoint')).toBeVisible();

		await context.setOffline(false);
	});

	test('readiness is reported separately from connectivity', async ({ page, context }) => {
		await resetApp(page);
		await page.goto('/setup');
		await page.getByRole('button', { name: 'Run readiness check' }).click();
		await expect(page.getByText('Network right now: online')).toBeVisible();

		await context.setOffline(true);
		await expect(page.getByText('Network right now: offline')).toBeVisible();
		// The offline-readiness verdict is its own line and does not flip with the network.
		await expect(
			page
				.locator('.card', { hasText: 'Offline readiness' })
				.getByText(/Offline ready|Partly cached|NOT offline ready/)
		).toBeVisible();
		await context.setOffline(false);
	});

	test('the database write and read check is part of readiness', async ({ page }) => {
		await resetApp(page);
		await page.goto('/setup');
		await page.getByRole('button', { name: 'Run readiness check' }).click();
		await expect(page.getByText('Database write/read check: passed')).toBeVisible();
	});
});
