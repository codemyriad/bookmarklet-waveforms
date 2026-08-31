const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
	testDir: './tests',
	timeout: 30_000,
	use: {
		browserName: 'chromium',
		headless: true,
		userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
		viewport: { width: 1280, height: 800 },
		launchOptions: {
			executablePath: '/usr/bin/google-chrome',
			args: [
				'--autoplay-policy=no-user-gesture-required',
				'--use-fake-device-for-media-stream',
				'--use-fake-ui-for-media-stream',
			],
		},
	},
})
