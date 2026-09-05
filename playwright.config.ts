import { defineConfig, devices } from '@playwright/test';

/**
 * Some environments ship a Chromium build that does not match this Playwright
 * release. Set CHROMIUM_PATH to that binary and the browser projects use it
 * instead of the managed download.
 */
const executablePath = process.env.CHROMIUM_PATH || undefined;

/**
 * End-to-end checks run against the production build served over HTTP on
 * localhost, which browsers treat as a secure context — the same conditions
 * the app needs in the field (HTTPS) for service workers and geolocation.
 *
 * These are automated browser checks. They are not a substitute for the
 * real-device checklist in docs/DEVICE-TEST-CHECKLIST.md.
 */
export default defineConfig({
	testDir: 'e2e',
	fullyParallel: false,
	workers: 1,
	timeout: 45_000,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'retain-on-failure',
		launchOptions: { args: ['--no-sandbox'], executablePath }
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		{
			// Approximates an Android phone viewport and touch input. It is an
			// emulator, not a real device.
			name: 'chromium-mobile-emulated',
			use: { ...devices['Pixel 7'] }
		},
		{
			// WebKit stands in for iOS Safari's engine. It needs its own browser
			// download (`npx playwright install webkit`) and cannot use
			// CHROMIUM_PATH.
			name: 'webkit',
			use: { ...devices['Desktop Safari'], launchOptions: { args: [] } }
		}
	],
	webServer: {
		command: 'npm run build && npm run preview -- --port 4173 --host 127.0.0.1',
		port: 4173,
		// Always rebuild: reusing a server left over from an earlier run silently
		// tests stale bundles, which is worse than a clear port-in-use error.
		reuseExistingServer: false,
		timeout: 120_000
	}
});
