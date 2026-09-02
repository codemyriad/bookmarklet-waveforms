const { test, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const fixtureUrl = 'https://example.test/an-ordinary-page'
const bookmarkletUrl = fs.readFileSync(path.join(__dirname, '..', 'bookmarklet-loader.js'), 'utf8').trim()
const bookmarklet = decodeURIComponent(bookmarkletUrl.replace(/^javascript:/, ''))

test('uses a floating status and audio window on an unrecognized site', async ({ page }) => {
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
			'Content-Security-Policy': "default-src 'none'; require-trusted-types-for 'script'; trusted-types site-policy",
		},
		contentType: 'text/html',
		body: '<!doctype html><html><head><meta charset="utf-8"><title>Ordinary page</title></head><body><main>Article</main></body></html>',
	}))
	await page.goto(fixtureUrl)
	expect(bookmarkletUrl).toContain('"use strict"')
	expect(bookmarkletUrl).toContain('%25')
	expect(bookmarkletUrl).toContain('%23')
	try {
		await page.goto(bookmarkletUrl)
	} catch (error) {
		if (!error.message.includes('ERR_ABORTED')) throw error
	}

	const host = page.locator('#nctalk-waveform')
	await expect(host).toBeVisible()
	expect(await host.evaluate((element) => ({
		platform: window.__TALK_WAVEFORMS__.platform,
		message: element.shadowRoot.querySelector('.empty').textContent,
		hasWindowMinimize: Boolean(element.shadowRoot.querySelector('.header .collapse, .reopen')),
	}))).toEqual({ platform: 'generic', message: 'No audio streams found on this page.', hasWindowMinimize: false })

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
	expect(pageErrors).toEqual([])

	await page.evaluate(async () => {
		window.__TALK_WAVEFORMS__.destroy()
		window.__GENERIC_AUDIO__.oscillator.stop()
		window.__GENERIC_AUDIO__.destination.stream.getTracks().forEach((track) => track.stop())
		await window.__GENERIC_AUDIO__.context.close()
	})
})

test('captures audible media that does not expose srcObject', async ({ page }) => {
	await page.route(fixtureUrl, (route) => route.fulfill({
		status: 200,
		contentType: 'text/html',
		body: '<!doctype html><html><body><audio aria-label="Mixed call audio"></audio></body></html>',
	}))
	await page.goto(fixtureUrl)
	await page.evaluate(() => {
		const context = new AudioContext()
		const oscillator = context.createOscillator()
		const destination = context.createMediaStreamDestination()
		oscillator.connect(destination)
		oscillator.start()
		const audio = document.querySelector('audio')
		Object.defineProperty(audio, 'readyState', { configurable: true, get: () => HTMLMediaElement.HAVE_ENOUGH_DATA })
		audio.captureStream = () => destination.stream
		window.__CAPTURE_STREAM_FIXTURE__ = { context, oscillator, destination }
	})
	await page.evaluate(bookmarklet)

	await expect.poll(() => page.evaluate(() => window.__TALK_WAVEFORMS__?.sources.size)).toBe(1)
	expect(await page.evaluate(() => {
		const source = [...window.__TALK_WAVEFORMS__.sources.values()][0]
		return { label: source.label, placement: source.viewHost.dataset.placement }
	})).toEqual({ label: 'Mixed call audio', placement: 'fallback' })
})

test('Mic test toggles one owned microphone visualization', async ({ page }) => {
	await page.route(fixtureUrl, (route) => route.fulfill({
		status: 200,
		contentType: 'text/html',
		body: '<!doctype html><html><body><main>Microphone fixture</main></body></html>',
	}))
	await page.goto(fixtureUrl)
	await page.evaluate(() => {
		const context = new AudioContext()
		const oscillator = context.createOscillator()
		const destination = context.createMediaStreamDestination()
		oscillator.connect(destination)
		oscillator.start()
		window.__MIC_TOGGLE_FIXTURE__ = { context, destination, oscillator, requests: 0, streams: [] }
		navigator.mediaDevices.getUserMedia = async () => {
			window.__MIC_TOGGLE_FIXTURE__.requests++
			const stream = new MediaStream(destination.stream.getAudioTracks().map((track) => track.clone()))
			window.__MIC_TOGGLE_FIXTURE__.streams.push(stream)
			return stream
		}
	})
	await page.evaluate(bookmarklet)

	const micButton = page.locator('#nctalk-waveform').locator('button.mic')
	await expect(micButton).toHaveText('Mic test')
	await micButton.click()
	await expect(micButton).toHaveText('Stop mic test')
	await expect.poll(() => page.evaluate(() => (
		[...window.__TALK_WAVEFORMS__.sources.values()].filter((source) => source.origin === 'capture').length
	))).toBe(1)

	await micButton.click()
	await expect(micButton).toHaveText('Mic test')
	await expect.poll(() => page.evaluate(() => window.__TALK_WAVEFORMS__.sources.size)).toBe(0)
	expect(await page.evaluate(() => window.__MIC_TOGGLE_FIXTURE__.streams[0].getTracks()[0].readyState)).toBe('ended')

	await micButton.click()
	await expect.poll(() => page.evaluate(() => ({
		requests: window.__MIC_TOGGLE_FIXTURE__.requests,
		captures: [...window.__TALK_WAVEFORMS__.sources.values()].filter((source) => source.origin === 'capture').length,
	}))).toEqual({ requests: 2, captures: 1 })
	await micButton.click()
	await expect.poll(() => page.evaluate(() => window.__TALK_WAVEFORMS__.sources.size)).toBe(0)
})
