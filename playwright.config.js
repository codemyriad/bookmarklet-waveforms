const { defineConfig } = require('@playwright/test')
const fs = require('node:fs')

const systemChrome = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const executablePath = fs.existsSync(systemChrome) ? systemChrome : undefined
const showcaseCapture = Boolean(process.env.SHOWCASE_SCREENSHOT || process.env.JITSI_SCREENSHOT || process.env.TEAMS_SCREENSHOT || process.env.GOOGLE_SCREENSHOT)

module.exports = defineConfig({
	testDir: './tests',
	timeout: 30_000,
	use: {
		browserName: 'chromium',
		headless: true,
		userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
		viewport: { width: 1280, height: 800 },
		deviceScaleFactor: showcaseCapture ? 2 : 1,
		launchOptions: {
			...(executablePath ? { executablePath } : {}),
			args: [
				'--autoplay-policy=no-user-gesture-required',
				'--use-fake-device-for-media-stream',
				'--use-fake-ui-for-media-stream',
			],
		},
	},
	webServer: process.env.LOCAL_FIXTURE === '1' ? {
		command: 'node tests/fixture-server.js',
		url: 'http://127.0.0.1:4173/status',
		reuseExistingServer: true,
	} : undefined,
})
