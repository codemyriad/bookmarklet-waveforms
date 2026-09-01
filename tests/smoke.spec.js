const { test, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const targetUrl = process.env.TALK_URL || 'https://cloud.codemyriad.io/call/erwcr27x'
const loaderPath = path.join(__dirname, '..', 'bookmarklet-loader.js')
const scriptPath = path.join(__dirname, '..', 'nctalk-waveform.0.3.1.js')
const hostedScriptUrl = 'https://silvio-talk-waveforms.pgs.sh/nctalk-waveform.0.3.1.js'

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
		localStorage.removeItem('nctalk-waveform-placement')
		window.__WAVEFORM_NATIVE_SET_REMOTE__ = RTCPeerConnection.prototype.setRemoteDescription
		window.__WAVEFORM_NATIVE_ADD_TRACK__ = RTCPeerConnection.prototype.addTrack
	})

	const loader = fs.readFileSync(loaderPath, 'utf8').replace(/^javascript:/, '')
	await page.evaluate(loader)
	await expect(page.locator('#nctalk-waveform')).toBeAttached()
	await expect.poll(() => page.evaluate(() => window.__NCTALK_WAVEFORM__?.version)).toBe('0.3.1')
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

		const localCard = document.createElement('div')
		localCard.className = 'localVideoContainer'
		localCard.style.cssText = 'position:relative;width:420px;height:180px'
		const localVideo = document.createElement('video')
		localVideo.muted = true
		localVideo.srcObject = destination.stream
		localCard.append(localVideo)
		document.body.append(localCard)

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
				const participantCard = document.createElement('div')
				participantCard.className = 'video-container'
				participantCard.style.cssText = 'position:relative;width:420px;height:180px'
				const participantName = document.createElement('span')
				participantName.className = 'video-container__user-name'
				participantName.textContent = 'Synthetic remote participant'
				window.__WAVEFORM_CARD_CLICKS__ = 0
				participantCard.addEventListener('click', () => window.__WAVEFORM_CARD_CLICKS__++)
				const audio = document.createElement('audio')
				audio.setAttribute('aria-label', 'Synthetic remote participant')
				audio.autoplay = true
				audio.srcObject = new MediaStream([event.track])
				participantCard.append(participantName, audio)
				document.body.append(participantCard)
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
		window.__WAVEFORM_TEST_AUDIO__ = {
			context,
			oscillator,
			audio,
			sender,
			receiver,
			localCard,
			localTrackId: destination.stream.getAudioTracks()[0].id,
		}
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
		return {
			direction: source.direction,
			origin: source.origin,
			label: source.label,
			mode: source.mode,
			placement: source.viewHost.dataset.placement,
			cardClass: source.viewHost.parentElement.className,
		}
	})).toEqual({
		direction: 'remote',
		origin: 'webrtc',
		label: 'Synthetic remote participant',
		mode: 'spectrogram',
		placement: 'card',
		cardClass: 'video-container',
	})

	await expect.poll(() => page.evaluate(() => (
		[...window.__NCTALK_WAVEFORM__.sources.values()]
			.filter((source) => source.direction === 'local' && source.trackId === window.__WAVEFORM_TEST_AUDIO__.localTrackId).length
	))).toBe(1)
	expect(await page.evaluate(() => {
		const localSources = [...window.__NCTALK_WAVEFORM__.sources.values()]
			.filter((source) => source.direction === 'local' && source.trackId === window.__WAVEFORM_TEST_AUDIO__.localTrackId)
		return {
			count: localSources.length,
			label: localSources[0].label,
			hasSenderTrack: Boolean(localSources[0].senderTrack),
			placement: localSources[0].viewHost.dataset.placement,
			captureSources: localSources.filter((source) => source.origin === 'capture').length,
		}
	})).toEqual({ count: 1, label: 'You', hasSenderTrack: true, placement: 'card', captureSources: 0 })

	await expect.poll(() => page.evaluate(() => (
		[...window.__NCTALK_WAVEFORM__.sources.values()]
			.find((source) => source.label === 'Synthetic remote participant')?.spectrogramFrames || 0
	))).toBeGreaterThan(2)
	await page.evaluate(() => {
		const source = [...window.__NCTALK_WAVEFORM__.sources.values()]
			.find((candidate) => candidate.label === 'Synthetic remote participant')
		source.modeButton.click()
	})
	await expect.poll(() => page.evaluate(() => (
		[...window.__NCTALK_WAVEFORM__.sources.values()]
			.find((source) => source.label === 'Synthetic remote participant')?.mode
	))).toBe('waveform')
	await page.evaluate(() => {
		const source = [...window.__NCTALK_WAVEFORM__.sources.values()]
			.find((candidate) => candidate.label === 'Synthetic remote participant')
		source.modeButton.click()
	})
	await expect.poll(() => page.evaluate(() => (
		[...window.__NCTALK_WAVEFORM__.sources.values()]
			.find((source) => source.label === 'Synthetic remote participant')?.amplitudeHistory.length || 0
	))).toBeGreaterThan(3)
	await expect.poll(() => page.evaluate(() => (
		[...window.__NCTALK_WAVEFORM__.sources.values()]
			.find((source) => source.label === 'Synthetic remote participant')?.mode
	))).toBe('amplitude')

	const overlay = page.locator('#nctalk-waveform')
	const participantOverlay = page.locator('.video-container > .nctalk-waveform-source')
	await expect(overlay).toBeHidden()
	await expect(participantOverlay).toBeVisible()
	const bounds = await participantOverlay.boundingBox()
	expect(bounds).toMatchObject({ width: 404, height: 72 })
	await participantOverlay.screenshot({ path: testInfo.outputPath('talk-waveform-participant-overlay.png') })

	await participantOverlay.click({ position: { x: 200, y: 50 } })
	expect(await page.evaluate(() => window.__WAVEFORM_CARD_CLICKS__)).toBe(0)

	await page.evaluate(() => {
		const source = [...window.__NCTALK_WAVEFORM__.sources.values()]
			.find((candidate) => candidate.label === 'Synthetic remote participant')
		source.collapseButton.click()
	})
	await expect(participantOverlay).toHaveAttribute('data-collapsed', 'true')
	expect(await participantOverlay.boundingBox()).toMatchObject({ height: 30 })
	await page.evaluate(() => {
		const source = [...window.__NCTALK_WAVEFORM__.sources.values()]
			.find((candidate) => candidate.label === 'Synthetic remote participant')
		source.reopenButton.click()
	})
	await expect(participantOverlay).toHaveAttribute('data-collapsed', 'false')
	await expect(participantOverlay).toBeVisible()

	const previousContextState = await page.evaluate(() => {
		window.__WAVEFORM_OLD_CONTEXT__ = window.__NCTALK_WAVEFORM__.context
		return window.__WAVEFORM_OLD_CONTEXT__.state
	})
	expect(['running', 'suspended']).toContain(previousContextState)
	await page.evaluate(loader)
	await expect.poll(() => page.evaluate(() => window.__WAVEFORM_OLD_CONTEXT__.state)).toBe('closed')
	await expect(page.locator('#nctalk-waveform')).toHaveCount(1)

	await page.evaluate(() => window.__NCTALK_WAVEFORM__.destroy())
	await expect(page.locator('#nctalk-waveform')).toHaveCount(0)
	await expect(page.locator('.nctalk-waveform-source')).toHaveCount(0)
	expect(await page.evaluate(() => RTCPeerConnection.prototype.setRemoteDescription === window.__WAVEFORM_NATIVE_SET_REMOTE__)).toBe(true)
	expect(await page.evaluate(() => RTCPeerConnection.prototype.addTrack === window.__WAVEFORM_NATIVE_ADD_TRACK__)).toBe(true)
	expect(browserErrors).toEqual([])
})
