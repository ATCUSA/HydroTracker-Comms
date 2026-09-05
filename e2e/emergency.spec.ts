import { expect, test } from '@playwright/test';
import { resetApp, setUpStation } from './helpers';

test.describe('emergency mode', () => {
	test('denied geolocation never blocks the emergency capture', async ({ page, context }) => {
		await context.clearPermissions();
		await resetApp(page);
		await setUpStation(page);

		await page.goto('/');
		await page.getByRole('button', { name: 'Record emergency incident now' }).click();

		await expect(page).toHaveURL(/emergency/);
		await expect(page.getByText(/Incident marker saved/)).toBeVisible();
		// Nothing was invented in place of a fix.
		await expect(page.getByText(/Pending — no coordinates recorded yet/)).toBeVisible();
	});

	test('the incident location is only set by an explicit action', async ({ page, context }) => {
		await context.grantPermissions(['geolocation']);
		await context.setGeolocation({ latitude: 45.5234, longitude: -122.6762, accuracy: 10 });
		await resetApp(page);
		await setUpStation(page);

		await page.goto('/');
		await page.getByRole('button', { name: 'Record emergency incident now' }).click();
		await expect(page.getByText(/Incident marker saved/)).toBeVisible();

		const incidentPanel = page.locator('section.loc', { hasText: '1 · Incident location' });
		const incidentValue = incidentPanel.locator('p.mono.big, p.warn').first();
		await expect(incidentValue).toContainText('Pending — no coordinates');

		// The device panel picks up the fix on its own.
		const devicePanel = page.locator('section.loc', { hasText: '2 · Current device location' });
		const deviceValue = devicePanel.locator('p.mono.big, p.warn').first();
		await expect(deviceValue).toContainText("N 45° 31.404'", { timeout: 15_000 });

		// Moving the device does not move the incident location.
		await context.setGeolocation({ latitude: 46.0, longitude: -123.0, accuracy: 10 });
		await expect(deviceValue).toContainText("N 46° 00.000'", { timeout: 15_000 });
		await expect(incidentValue).toContainText('Pending — no coordinates');

		// Only the explicit control writes it.
		await incidentPanel
			.getByRole('button', { name: 'Set incident location to current position' })
			.click();
		await expect(incidentPanel.locator('p.mono.big').first()).toContainText("N 46° 00.000'");
		await expect(incidentPanel.getByText(/Device GPS fix/).first()).toBeVisible();

		// A further device move still leaves the saved incident position alone.
		await context.setGeolocation({ latitude: 47.0, longitude: -124.0, accuracy: 10 });
		await expect(deviceValue).toContainText("N 47° 00.000'", { timeout: 15_000 });
		await expect(incidentPanel.locator('p.mono.big').first()).toContainText("N 46° 00.000'");
	});

	test('a manually entered location is saved with its source', async ({ page }) => {
		await resetApp(page);
		await setUpStation(page);
		await page.goto('/');
		await page.getByRole('button', { name: 'Record emergency incident now' }).click();

		await page.getByLabel('Enter coordinates manually').fill("N 45 31.404' W 122 40.572'");
		await page.getByRole('button', { name: 'Save entered location' }).click();

		const incidentPanel = page.locator('section.loc', { hasText: '1 · Incident location' });
		await expect(incidentPanel.locator('p.mono.big').first()).toContainText("N 45° 31.404'");
		await expect(incidentPanel.getByText(/Manually entered by operator/).first()).toBeVisible();
	});

	test('unreadable coordinates change nothing', async ({ page }) => {
		await resetApp(page);
		await setUpStation(page);
		await page.goto('/');
		await page.getByRole('button', { name: 'Record emergency incident now' }).click();

		await page.getByLabel('Enter coordinates manually').fill('near the second bridge');
		await page.getByRole('button', { name: 'Save entered location' }).click();
		await expect(page.getByText(/could not be read. Nothing was changed/)).toBeVisible();
		await expect(
			page.locator('section.loc', { hasText: '1 · Incident location' }).locator('p.warn').first()
		).toContainText('Pending');
	});

	test('the responder block names the format, accuracy and fix age', async ({ page }) => {
		await resetApp(page);
		await setUpStation(page);
		await page.goto('/');
		await page.getByRole('button', { name: 'Record emergency incident now' }).click();
		await page.getByLabel('Enter coordinates manually').fill('45.5234 -122.6762');
		await page.getByRole('button', { name: 'Save entered location' }).click();

		const responder = page.locator('pre.responder').first();
		await expect(responder).toContainText('Location type: Incident location');
		await expect(responder).toContainText('Format: Degrees and decimal minutes');
		await expect(responder).toContainText('Latitude:');
		await expect(responder).toContainText('Longitude:');
		await expect(responder).toContainText('Fix age:');

		// Switching format changes the numbers, and says which format they are in.
		await page.getByLabel('Coordinate format').selectOption('dms');
		await expect(responder).toContainText('Format: Degrees, minutes, seconds');
		await expect(responder).toContainText('"');
	});

	test('timing controls stay reachable while an incident is open', async ({ page }) => {
		await resetApp(page);
		await setUpStation(page);
		await page.goto('/');
		await page.getByRole('button', { name: 'Record emergency incident now' }).click();
		// Wait for the emergency screen before navigating away, so the assertion
		// below is about reachability and not about a race with the redirect.
		await expect(page).toHaveURL(/emergency/);
		await expect(page.getByText(/Incident marker saved/)).toBeVisible();

		// The main nav and its capture screen remain available with the incident open.
		await page.getByRole('link', { name: 'Live' }).click();
		await page.getByRole('button', { name: 'Record pass at this checkpoint' }).click();
		await expect(page.getByRole('heading', { name: /Unassigned captures \(1\)/ })).toBeVisible();

		await page.goto('/emergency');
		await expect(page.getByText(/Incident marker saved/)).toBeVisible();
	});

	test('incident actions are timestamped and linked to the incident', async ({ page }) => {
		await resetApp(page);
		await setUpStation(page);
		await page.goto('/');
		await page.getByRole('button', { name: 'Record emergency incident now' }).click();

		await page.getByRole('button', { name: 'EMS requested' }).click();
		await page.getByLabel('Custom action').fill('Rescue boat alongside');
		await page.getByRole('button', { name: 'Log action' }).click();

		const actions = page.locator('.card', { hasText: 'Actions' }).locator('ul li');
		await expect(actions).toHaveCount(2);
		await expect(actions.first()).toContainText('EMS requested');

		await page.goto('/timeline');
		await expect(page.getByText('Rescue boat alongside')).toBeVisible();
		await expect(page.locator('.badge', { hasText: 'unresolved' }).first()).toBeVisible();
	});
});
