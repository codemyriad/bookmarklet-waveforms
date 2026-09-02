const { test, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const fixtureUrl = 'https://example.test/an-ordinary-page'
const bookmarklet = fs.readFileSync(path.join(__dirname, '..', 'bookmarklet-loader.js'), 'utf8').replace(/^javascript:/, '')

test('uses a floating status and audio window on an unrecognized site', async ({ page }) => {
	const dialogs = []
	page.on('dialog', async (dialog) => {
		dialogs.push(dialog.message())
		await dialog.dismiss()
	})
	await page.route(fixtureUrl, (route) => route.fulfill({
		status: 200,
		headers: {
			'Content-Security-Policy': "default-src 'none'; require-trusted-types-for 'script'; trusted-types site-policy",
		},
		contentType: 'text/html',
		body: '<!doctype html><html><head><meta charset="utf-8"><title>Ordinary page</title></head><body><main>Article</main></body></html>',
	}))
	await page.goto(fixtureUrl)
	await page.evaluate(bookmarklet)

	const host = page.locator('#nctalk-waveform')
	await expect(host).toBeVisible()
	expect(await host.evaluate((element) => ({
		platform: window.__TALK_WAVEFORMS__.platform,
		message: element.shadowRoot.querySelector('.empty').textContent,
	}))).toEqual({ platform: 'generic', message: 'No audio streams found on this page.' })

	await page.evaluate(() => {
		const context = new AudioContext()
		const oscillator = context.createOscillator()
		const destination = context.createMediaStreamDestination()
		oscillator.connect(destination)
		oscillator.start()
		const audio = document.createElement('audio')
		audio.setAttribute('aria-label', 'Page audio')
		audio.srcObject = destination.stream
		document.body.append(audio)
		window.__GENERIC_AUDIO__ = { context, oscillator, destination, audio }
		window.__TALK_WAVEFORMS__.scan()
	})
	await expect.poll(() => page.evaluate(() => window.__TALK_WAVEFORMS__.sources.size)).toBe(1)
	await expect(host).toBeVisible()
	const source = await page.evaluate(() => {
		const item = [...window.__TALK_WAVEFORMS__.sources.values()][0]
		return { label: item.label, mode: item.mode, placement: item.viewHost.dataset.placement, card: item.card }
	})
	expect(source).toEqual({ label: 'Page audio', mode: 'spectrogram', placement: 'fallback', card: null })
	expect(dialogs).toEqual([])

	await page.evaluate(async () => {
		window.__TALK_WAVEFORMS__.destroy()
		window.__GENERIC_AUDIO__.oscillator.stop()
		window.__GENERIC_AUDIO__.destination.stream.getTracks().forEach((track) => track.stop())
		await window.__GENERIC_AUDIO__.context.close()
	})
})
