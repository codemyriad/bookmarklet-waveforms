const { test, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const fixtureUrl = 'https://meet.google.com/abc-defg-hij'
const liveUrl = process.env.GOOGLE_MEET_URL
const loader = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'bookmarklet-loader.js'), 'utf8').trim().replace(/^javascript:/, ''))

test('maps already-rendered Google Meet streams to participant tiles', async ({ page }) => {
	await page.route(fixtureUrl, (route) => route.fulfill({
		status: 200,
		headers: {
			'Content-Security-Policy': "require-trusted-types-for 'script'; trusted-types default talk-waveforms; script-src 'nonce-google-meet-test' 'strict-dynamic' https:; object-src 'none'",
			'Document-Isolation-Policy': 'isolate-and-require-corp',
		},
		contentType: 'text/html',
		body: `<!doctype html>
			<html lang="en">
			<head><meta charset="utf-8"><title>Google Meet fixture</title></head>
			<body>
				<main id="meet-fixture"></main>
				<script nonce="google-meet-test">
					if (window.trustedTypes) trustedTypes.createPolicy('default', { createScriptURL: value => value })
				</script>
			</body>
			</html>`,
	}))
	await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' })

	await page.evaluate(() => {
		const context = new AudioContext()
		const fixtures = []
		window.__GOOGLE_MEET_NATIVE_GUM__ = navigator.mediaDevices.getUserMedia
		window.__GOOGLE_MEET_CAPTURE_CALLS__ = 0
		for (const [index, name] of ['Ada Lovelace', 'Alan Turing', 'Silvio'].entries()) {
			const oscillator = context.createOscillator()
			const gain = context.createGain()
			const destination = context.createMediaStreamDestination()
			oscillator.frequency.value = 180 + index * 120
			gain.gain.value = .12
			oscillator.connect(gain).connect(destination)
			oscillator.start()

			const card = document.createElement('section')
			card.dataset.participantId = `meet-participant-${index}`
			if (index === 2) card.dataset.selfName = name
			else card.dataset.participantName = name
			card.style.cssText = 'position:relative;width:480px;height:180px;margin:8px;overflow:hidden'
			const video = document.createElement('video')
			video.autoplay = true
			video.muted = index === 2
			video.srcObject = destination.stream
			card.append(video)
			document.querySelector('#meet-fixture').append(card)
			fixtures.push({ oscillator, stream: destination.stream })
		}
		const internalVideo = document.createElement('video')
		Object.defineProperty(internalVideo, 'readyState', { configurable: true, get: () => HTMLMediaElement.HAVE_ENOUGH_DATA })
		internalVideo.captureStream = () => {
			window.__GOOGLE_MEET_CAPTURE_CALLS__++
			return new MediaStream()
		}
		document.body.append(internalVideo)
		window.__GOOGLE_MEET_FIXTURES__ = { context, fixtures }
	})

	await page.evaluate(loader)
	await expect(page.locator('#nctalk-waveform')).toBeAttached()
	await expect.poll(() => page.evaluate(() => window.__TALK_WAVEFORMS__?.sources?.size)).toBe(3)
	expect(await page.evaluate(() => ({
		getUserMediaUnchanged: navigator.mediaDevices.getUserMedia === window.__GOOGLE_MEET_NATIVE_GUM__,
		captureCalls: window.__GOOGLE_MEET_CAPTURE_CALLS__,
	}))).toEqual({ getUserMediaUnchanged: true, captureCalls: 0 })

	const state = await page.evaluate(() => ({
		version: window.__TALK_WAVEFORMS__.version,
		platform: window.__TALK_WAVEFORMS__.platform,
		sources: [...window.__TALK_WAVEFORMS__.sources.values()].map((source) => ({
			label: source.label,
			direction: source.direction,
			mode: source.mode,
			placement: source.viewHost.dataset.placement,
			cardId: source.card?.dataset.participantId,
			trackCount: source.stream.getAudioTracks().length,
		})),
	}))
	expect(state.version).toBe('0.5.4')
	expect(state.platform).toBe('google-meet')
	expect(state.sources.map(({ label }) => label).sort()).toEqual(['Ada Lovelace', 'Alan Turing', 'You'])
	for (const source of state.sources) {
		expect(source).toMatchObject({ mode: 'spectrogram', placement: 'card', trackCount: 1 })
		expect(source.cardId).toMatch(/^meet-participant-/)
	}
	expect(state.sources.filter(({ direction }) => direction === 'local')).toHaveLength(1)
	expect(state.sources.filter(({ direction }) => direction === 'remote')).toHaveLength(2)
	await expect(page.locator('[data-participant-id] > .nctalk-waveform-source')).toHaveCount(3)
	await expect(page.locator('[data-placement="fallback"]')).toHaveCount(0)
	await expect.poll(() => page.evaluate(() => (
		[...window.__TALK_WAVEFORMS__.sources.values()].every((source) => source.spectrogramFrames > 2)
	))).toBe(true)

	const leakedClicks = await page.evaluate(() => {
		const source = [...window.__TALK_WAVEFORMS__.sources.values()].find(({ direction }) => direction === 'remote')
		let leakedClicks = 0
		source.card.addEventListener('click', () => leakedClicks++)
		source.modeButton.click()
		return leakedClicks
	})
	expect(leakedClicks).toBe(0)
	await expect.poll(() => page.evaluate(() => (
		[...window.__TALK_WAVEFORMS__.sources.values()].find(({ direction }) => direction === 'remote').mode
	))).toBe('waveform')

	await page.evaluate(async () => {
		window.__TALK_WAVEFORMS__.destroy()
		for (const fixture of window.__GOOGLE_MEET_FIXTURES__.fixtures) {
			fixture.oscillator.stop()
			fixture.stream.getTracks().forEach((track) => track.stop())
		}
		await window.__GOOGLE_MEET_FIXTURES__.context.close()
	})
})

test('loads on the supplied Google Meet page', async ({ page }) => {
	test.skip(!liveUrl, 'Set GOOGLE_MEET_URL to check the current Google Meet page')
	const dialogs = []
	page.on('dialog', async (dialog) => {
		dialogs.push(dialog.message())
		await dialog.dismiss()
	})
	await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
	await page.evaluate(loader)
	await expect.poll(() => page.evaluate(() => ({
		version: window.__TALK_WAVEFORMS__?.version,
		platform: window.__TALK_WAVEFORMS__?.platform,
	})), { timeout: 15_000 }).toEqual({ version: '0.5.4', platform: 'google-meet' })
	expect(dialogs).toEqual([])
})
