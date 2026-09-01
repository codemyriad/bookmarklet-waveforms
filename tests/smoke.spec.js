const { test, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const targetUrl = process.env.TALK_URL || 'https://cloud.codemyriad.io/call/erwcr27x'
const loaderPath = path.join(__dirname, '..', 'bookmarklet-loader.js')
const scriptPath = path.join(__dirname, '..', 'nctalk-waveform.0.2.0.js')
const hostedScriptUrl = 'https://silvio-talk-waveforms.pgs.sh/nctalk-waveform.0.2.0.js'

test('loads through the real Nextcloud CSP and analyses a Talk media stream', async ({ page }, testInfo) => {
	const browserErrors = []
	let hostedResponse = null
	page.on('pageerror', (error) => browserErrors.push(error.message))
	page.on('response', (response) => {
		if (response.url().startsWith(hostedScriptUrl)) hostedResponse = response
	})
	if (process.env.LOCAL_ASSET === '1') {
		await page.route(`${hostedScriptUrl}?_*`, (route) => route.fulfill({
			status: 200,
			contentType: 'text/javascript',
			body: fs.readFileSync(scriptPath, 'utf8'),
		}))
	}

	await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })
	await expect(page.locator('#app-content-vue')).toBeAttached({ timeout: 20_000 })
	await page.evaluate(() => {
		localStorage.removeItem('nctalk-waveform-mode')
		window.__WAVEFORM_NATIVE_SET_REMOTE__ = RTCPeerConnection.prototype.setRemoteDescription
	})

	const loader = fs.readFileSync(loaderPath, 'utf8').replace(/^javascript:/, '')
	await page.evaluate(loader)
	await expect(page.locator('#nctalk-waveform')).toBeAttached()
	await expect.poll(() => page.evaluate(() => window.__NCTALK_WAVEFORM__?.version)).toBe('0.2.0')
	await expect.poll(() => page.evaluate(() => window.__NCTALK_WAVEFORM__?.mode)).toBe('spectrogram')
	expect(hostedResponse?.status()).toBe(200)

	await page.evaluate(async () => {
		const context = new AudioContext()
		await context.resume()
		const oscillator = context.createOscillator()
		const gain = context.createGain()
		const destination = context.createMediaStreamDestination()
		gain.gain.value = 0.4
		oscillator.frequency.value = 440
		oscillator.connect(gain).connect(destination)
		oscillator.start()

		const sender = new RTCPeerConnection({ iceServers: [] })
		const receiver = new RTCPeerConnection({ iceServers: [] })
		sender.addEventListener('icecandidate', (event) => {
			if (event.candidate) void receiver.addIceCandidate(event.candidate)
		})
		receiver.addEventListener('icecandidate', (event) => {
			if (event.candidate) void sender.addIceCandidate(event.candidate)
		})
		const remoteTrack = new Promise((resolve) => {
			receiver.addEventListener('track', (event) => {
				if (event.track.kind !== 'audio') return
				const audio = document.createElement('audio')
				audio.setAttribute('aria-label', 'Synthetic remote participant')
				audio.autoplay = true
				audio.srcObject = new MediaStream([event.track])
				document.body.append(audio)
				resolve(audio)
			}, { once: true })
		})
		sender.addTrack(destination.stream.getAudioTracks()[0], destination.stream)
		await sender.setLocalDescription(await sender.createOffer())
		await receiver.setRemoteDescription(sender.localDescription)
		await receiver.setLocalDescription(await receiver.createAnswer())
		await sender.setRemoteDescription(receiver.localDescription)
		const audio = await remoteTrack
		await audio.play()
		window.__WAVEFORM_TEST_AUDIO__ = { context, oscillator, audio, sender, receiver }
		window.__NCTALK_WAVEFORM__.scan()
	})

	await expect.poll(() => page.evaluate(() => (
		[...window.__NCTALK_WAVEFORM__.sources.values()]
			.filter((source) => source.label === 'Synthetic remote participant').length
	))).toBe(1)
	await expect.poll(() => page.evaluate(() => (
		[...window.__NCTALK_WAVEFORM__.sources.values()]
			.find((source) => source.label === 'Synthetic remote participant')?.lastLevel || 0
	))).toBeGreaterThan(0.1)
	expect(await page.evaluate(() => {
		const source = [...window.__NCTALK_WAVEFORM__.sources.values()]
			.find((candidate) => candidate.label === 'Synthetic remote participant')
		return { direction: source.direction, origin: source.origin, label: source.label }
	})).toEqual({ direction: 'remote', origin: 'webrtc', label: 'Synthetic remote participant' })

	await page.locator('#nctalk-waveform').evaluate((host) => {
		const select = host.shadowRoot.querySelector('.mode')
		select.value = 'amplitude'
		select.dispatchEvent(new Event('change'))
	})
	await expect.poll(() => page.evaluate(() => (
		[...window.__NCTALK_WAVEFORM__.sources.values()]
			.find((source) => source.label === 'Synthetic remote participant')?.amplitudeHistory.length || 0
	))).toBeGreaterThan(3)
	await expect.poll(() => page.evaluate(() => window.__NCTALK_WAVEFORM__.mode)).toBe('amplitude')

	await page.locator('#nctalk-waveform').evaluate((host) => {
		const select = host.shadowRoot.querySelector('.mode')
		select.value = 'spectrogram'
		select.dispatchEvent(new Event('change'))
	})
	await expect.poll(() => page.evaluate(() => (
		[...window.__NCTALK_WAVEFORM__.sources.values()]
			.find((source) => source.label === 'Synthetic remote participant')?.spectrogramFrames || 0
	))).toBeGreaterThan(2)
	await expect.poll(() => page.evaluate(() => window.__NCTALK_WAVEFORM__.mode)).toBe('spectrogram')

	const overlay = page.locator('#nctalk-waveform')
	const bounds = await overlay.boundingBox()
	expect(bounds).toMatchObject({ x: 16, width: 420, height: 250 })
	await overlay.screenshot({ path: testInfo.outputPath('talk-waveform-overlay.png') })

	const previousContextState = await page.evaluate(() => {
		window.__WAVEFORM_OLD_CONTEXT__ = window.__NCTALK_WAVEFORM__.context
		return window.__WAVEFORM_OLD_CONTEXT__.state
	})
	expect(['running', 'suspended']).toContain(previousContextState)
	await page.evaluate(loader)
	await expect.poll(() => page.evaluate(() => window.__WAVEFORM_OLD_CONTEXT__.state)).toBe('closed')
	await expect(page.locator('#nctalk-waveform')).toHaveCount(1)

	await page.locator('#nctalk-waveform').evaluate((host) => host.shadowRoot.querySelector('.close').click())
	await expect(page.locator('#nctalk-waveform')).toHaveCount(0)
	expect(await page.evaluate(() => RTCPeerConnection.prototype.setRemoteDescription === window.__WAVEFORM_NATIVE_SET_REMOTE__)).toBe(true)
	expect(browserErrors).toEqual([])
})
