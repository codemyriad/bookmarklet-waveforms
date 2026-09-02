const { test, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const fixtureUrl = 'https://web.whatsapp.com/call/video/test/'
const bookmarkletUrl = fs.readFileSync(path.join(__dirname, '..', 'bookmarklet-loader.js'), 'utf8').trim()

test('executes as a real bookmark URL on a synthetic WhatsApp-origin page', async ({ page }) => {
	const dialogs = []
	const pageErrors = []
	page.on('dialog', async (dialog) => {
		dialogs.push(dialog.message())
		await dialog.dismiss()
	})
	page.on('pageerror', (error) => pageErrors.push(error.message))
	await page.route(fixtureUrl, (route) => route.fulfill({
		status: 200,
		headers: {
			'Content-Security-Policy': "default-src 'none'; require-trusted-types-for 'script'; trusted-types whatsapp",
		},
		contentType: 'text/html',
		body: '<!doctype html><html><head><title>WhatsApp call</title></head><body><main>Join call</main></body></html>',
	}))
	await page.goto(fixtureUrl)
	await page.evaluate(() => {
		const context = new AudioContext()
		const oscillator = context.createOscillator()
		const destination = context.createMediaStreamDestination()
		oscillator.connect(destination)
		oscillator.start()
		Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
			configurable: true,
			writable: true,
			value: async () => destination.stream,
		})
		window.__WHATSAPP_FIXTURE__ = { context, oscillator, destination }
	})

	try {
		await page.goto(bookmarkletUrl)
	} catch (error) {
		if (!error.message.includes('ERR_ABORTED')) throw error
	}
	const host = page.locator('#nctalk-waveform')
	await expect(host).toBeVisible()
	expect(await host.evaluate((element) => ({
		version: window.__TALK_WAVEFORMS__.version,
		platform: window.__TALK_WAVEFORMS__.platform,
		message: element.shadowRoot.querySelector('.empty').textContent,
	}))).toEqual({
		version: '0.5.2',
		platform: 'whatsapp',
		message: 'No call audio found yet. Join the call or try Mic test.',
	})

	await page.evaluate(() => navigator.mediaDevices.getUserMedia({ audio: true, video: false }))
	await expect.poll(() => page.evaluate(() => window.__TALK_WAVEFORMS__.sources.size)).toBe(1)
	expect(await page.evaluate(() => {
		const source = [...window.__TALK_WAVEFORMS__.sources.values()][0]
		return { label: source.label, direction: source.direction, origin: source.origin, placement: source.viewHost.dataset.placement }
	})).toEqual({ label: 'You', direction: 'local', origin: 'get-user-media', placement: 'fallback' })
	expect(dialogs).toEqual([])
	expect(pageErrors).toEqual([])
})
