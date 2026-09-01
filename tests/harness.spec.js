const { test, expect, chromium } = require('@playwright/test')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const callUrl = process.env.HARNESS_CALL_URL
const projectRoot = path.join(__dirname, '..')
const gocassiniRoot = path.resolve(projectRoot, '..', 'gocassini')
const speechFixture = path.join(gocassiniRoot, 'harness', 'media', 'parakeet-smoke.mkv')
const loaderPath = path.join(projectRoot, 'bookmarklet-loader.js')
const scriptPath = path.join(projectRoot, 'nctalk-waveform.0.3.0.js')
const hostedScriptUrl = 'https://silvio-talk-waveforms.pgs.sh/nctalk-waveform.0.3.0.js'
const normalChromeUserAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'
const systemChrome = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const participantExecutablePath = fs.existsSync(systemChrome) ? systemChrome : undefined

test.skip(!callUrl, 'Set HARNESS_CALL_URL to a room in the Gocassini Talk harness')

async function submitGuestName(page, name, timeout = 2_000) {
	const submitName = page.getByRole('button', { name: 'Submit name and join' })
	const visible = await submitName.waitFor({ state: 'visible', timeout })
		.then(() => true, () => false)
	if (!visible) return false
	await page.getByRole('dialog').getByRole('textbox', { name: 'Enter your name' }).fill(name)
	await expect(submitName).toBeEnabled({ timeout: 10_000 })
	await submitName.click()
	await expect(submitName).toBeHidden({ timeout: 10_000 })
	return true
}

async function joinTalkCall(page, name, { navigate = true } = {}) {
	if (navigate) await page.goto(callUrl, { waitUntil: 'domcontentloaded' })
	await expect(page.locator('#app-content-vue')).toBeAttached({ timeout: 30_000 })
	await submitGuestName(page, name, 5_000)
	await page.locator('.toast-close').evaluateAll((buttons) => buttons.forEach((button) => button.click()))
	const deviceDialog = page.getByRole('dialog')
	const deviceJoin = page.locator('.modal-container button.join-call')
	let deviceJoinVisible = await deviceJoin.waitFor({ state: 'visible', timeout: 2_000 })
		.then(() => true, () => false)
	for (let attempt = 0; !deviceJoinVisible && attempt < 3; attempt++) {
		if (await submitGuestName(page, name)) {
			deviceJoinVisible = await deviceJoin.waitFor({ state: 'visible', timeout: 3_000 })
				.then(() => true, () => false)
			if (deviceJoinVisible) break
		}
		const callButton = page.getByRole('button', { name: /^(Start|Join) call$/ }).first()
		const disabledReason = await callButton.getAttribute('title')
		if (disabledReason?.includes('server was updated')) {
			await page.reload({ waitUntil: 'domcontentloaded' })
			return joinTalkCall(page, name, { navigate: false })
		}
		await expect(callButton).toBeEnabled({ timeout: 30_000 })
		await callButton.click({ timeout: 10_000 })
		deviceJoinVisible = await deviceJoin.waitFor({ state: 'visible', timeout: 10_000 })
			.then(() => true, () => false)
	}
	if (!deviceJoinVisible) throw new Error('Talk device dialog did not open')
	const displayName = deviceDialog.getByRole('textbox', { name: 'Display name (required)' })
	if (await displayName.isVisible()) await displayName.fill(name)
	await deviceJoin.click()
	await deviceDialog.waitFor({ state: 'hidden', timeout: 30_000 })
	await expect(page.getByRole('button', { name: 'Leave call' })).toBeVisible({ timeout: 30_000 })
}

async function prepareObserverPage(page, name) {
	for (let attempt = 0; attempt < 3; attempt++) {
		await expect(page.locator('#app-content-vue')).toBeAttached({ timeout: 30_000 })
		await submitGuestName(page, name, 5_000)
		const callButton = page.getByRole('button', { name: /^(Start|Join) call$/ }).first()
		const disabledReason = await callButton.getAttribute('title')
		if (!disabledReason?.includes('server was updated')) return
		await page.reload({ waitUntil: 'domcontentloaded' })
	}
	throw new Error('Talk continued to request a reload after the server update')
}

test('separates every Gocassini participant at the WebRTC receiver boundary', async ({ page }, testInfo) => {
	test.setTimeout(150_000)
	const mediaDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-waveforms-'))
	const speechWav = path.join(mediaDirectory, 'speech.wav')
	let participantBrowser = null

	const ffmpeg = spawnSync('ffmpeg', [
		'-y', '-v', 'error', '-i', speechFixture,
		'-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', speechWav,
	], { encoding: 'utf8' })
	if (ffmpeg.status !== 0) throw new Error(`Could not prepare browser speech fixture: ${ffmpeg.stderr}`)

	await page.route(`${hostedScriptUrl}?_*`, (route) => route.fulfill({
		status: 200,
		contentType: 'text/javascript',
		body: fs.readFileSync(scriptPath, 'utf8'),
	}))

	try {
		await page.goto(callUrl, { waitUntil: 'domcontentloaded' })
		const loader = fs.readFileSync(loaderPath, 'utf8').replace(/^javascript:/, '')
		let observerHooked = false
		for (let attempt = 0; attempt < 3 && !observerHooked; attempt++) {
			if (attempt > 0) await page.reload({ waitUntil: 'domcontentloaded' })
			await prepareObserverPage(page, 'Waveform observer')
			await page.evaluate(loader)
			await expect(page.locator('#nctalk-waveform')).toBeAttached()
			await joinTalkCall(page, 'Waveform observer', { navigate: false })
			observerHooked = await page.evaluate(() => Boolean(window.__NCTALK_WAVEFORM__))
		}
		if (!observerHooked) throw new Error('Talk reloaded after bookmarklet injection three times')

		participantBrowser = await chromium.launch({
			headless: true,
			...(participantExecutablePath ? { executablePath: participantExecutablePath } : {}),
			args: [
				'--autoplay-policy=no-user-gesture-required',
				'--use-fake-device-for-media-stream',
				'--use-fake-ui-for-media-stream',
				`--use-file-for-fake-audio-capture=${speechWav}`,
			],
		})
		const participantNames = ['Wave Alpha', 'Wave Beta', 'Wave Gamma']
		await Promise.all(participantNames.map(async (name) => {
			const context = await participantBrowser.newContext({
				permissions: ['camera', 'microphone'],
				userAgent: normalChromeUserAgent,
			})
			await joinTalkCall(await context.newPage(), name)
		}))

		try {
			await expect.poll(() => page.evaluate(() => {
				return [...window.__NCTALK_WAVEFORM__.sources.values()]
					.filter((source) => source.direction === 'remote' && source.origin === 'webrtc')
					.length
			}), { timeout: 45_000 }).toBe(3)
		} catch (error) {
			const debugState = await page.evaluate(() => ({
				peerConnections: window.__NCTALK_WAVEFORM__.peerConnections.size,
				sources: [...window.__NCTALK_WAVEFORM__.sources.values()].map((source) => ({
					key: source.key,
					label: source.label,
					direction: source.direction,
					origin: source.origin,
					level: source.lastLevel,
				})),
				media: [...document.querySelectorAll('audio, video')].map((element) => ({
					tag: element.tagName,
					muted: element.muted,
					hasStream: element.srcObject instanceof MediaStream,
					audioTracks: element.srcObject?.getAudioTracks?.().map((track) => ({
						id: track.id,
						label: track.label,
						muted: track.muted,
						readyState: track.readyState,
					})) || [],
				})),
			}))
			throw new Error(`${error.message}\n\nObserver media state:\n${JSON.stringify(debugState, null, 2)}`)
		}

		const remoteSources = await page.evaluate(() => {
			return [...window.__NCTALK_WAVEFORM__.sources.values()]
				.filter((source) => source.direction === 'remote' && source.origin === 'webrtc')
				.map((source) => ({
					key: source.key,
					label: source.label,
					level: source.lastLevel,
					trackCount: source.stream.getAudioTracks().length,
				}))
		})
		expect(new Set(remoteSources.map((source) => source.key)).size).toBe(3)
		await expect.poll(() => page.evaluate(() => (
			[...window.__NCTALK_WAVEFORM__.sources.values()]
				.filter((source) => source.direction === 'remote' && source.origin === 'webrtc')
				.map((source) => source.label)
				.sort()
		)), { timeout: 10_000 }).toEqual([...participantNames].sort())
		expect(remoteSources.every((source) => source.trackCount === 1)).toBe(true)
		expect(remoteSources.some((source) => source.level > 0)).toBe(true)
		await expect.poll(() => page.evaluate(() => (
			[...window.__NCTALK_WAVEFORM__.sources.values()]
				.filter((source) => source.direction === 'remote' && source.origin === 'webrtc')
				.every((source) => source.viewHost.dataset.placement === 'card' && source.card?.isConnected)
		)), { timeout: 10_000 }).toBe(true)

		await expect.poll(() => page.evaluate(() => (
			[...window.__NCTALK_WAVEFORM__.sources.values()]
				.filter((source) => source.direction === 'local').length
		)), { timeout: 10_000 }).toBe(1)
		expect(await page.evaluate(() => {
			const source = [...window.__NCTALK_WAVEFORM__.sources.values()]
				.find((candidate) => candidate.direction === 'local')
			return {
				origin: source.origin,
				hasSenderTrack: Boolean(source.senderTrack),
				placement: source.viewHost.dataset.placement,
				mode: source.mode,
				micEnabled: !window.__NCTALK_WAVEFORM__.host.shadowRoot.querySelector('.mic').disabled,
			}
		})).toEqual({
			origin: 'webrtc',
			hasSenderTrack: true,
			placement: 'card',
			mode: 'spectrogram',
			micEnabled: false,
		})
		await expect(page.locator('.video-container > .nctalk-waveform-source')).toHaveCount(3)
		await expect(page.locator('.localVideoContainer > .nctalk-waveform-source')).toHaveCount(1)
		await page.screenshot({ path: testInfo.outputPath('gocassini-participant-overlays.png') })
	} finally {
		await participantBrowser?.close()
		fs.rmSync(mediaDirectory, { recursive: true, force: true })
	}
})
