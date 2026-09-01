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
const scriptPath = path.join(projectRoot, 'nctalk-waveform.0.3.3.js')
const hostedScriptUrl = 'https://silvio-talk-waveforms.pgs.sh/nctalk-waveform.0.3.3.js'
const participantImageDirectory = path.resolve(process.env.HARNESS_PARTICIPANT_IMAGES_DIR || path.join(projectRoot, 'tests', 'participant-images'))
const regularParticipantSpecs = [
	{ name: 'Hypatia', slug: 'hypatia' },
	{ name: 'Ibn al-Haytham', slug: 'ibn-al-haytham' },
	{ name: 'Marie Curie', slug: 'marie-curie' },
]
const showcaseCandidates = [
	{ name: 'Albert Einstein', slug: 'albert-einstein', speakingImage: 'einstein-speaking', listeningImage: 'einstein-listening' },
	{ name: 'Ernest Rutherford', slug: 'ernest-rutherford', speakingImage: 'rutherford-speaking', listeningImage: 'rutherford-listening' },
	{ name: 'Marie Curie', slug: 'marie-curie', speakingImage: 'marie-curie', listeningImage: 'marie-curie-listening' },
	{ name: 'Paul Langevin', slug: 'paul-langevin', speakingImage: 'paul-langevin', listeningImage: 'paul-langevin-listening' },
	{ name: 'Henri Poincaré', slug: 'henri-poincare', speakingImage: 'henri-poincare', listeningImage: 'henri-poincare-listening' },
]
const normalChromeUserAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'
const systemChrome = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const participantExecutablePath = fs.existsSync(systemChrome) ? systemChrome : undefined

function seededRandom(seed) {
	let state = 2_166_136_261
	for (const character of seed) {
		state ^= character.charCodeAt(0)
		state = Math.imul(state, 16_777_619)
	}
	return () => {
		state += 0x6D2B79F5
		let value = state
		value = Math.imul(value ^ value >>> 15, value | 1)
		value ^= value + Math.imul(value ^ value >>> 7, value | 61)
		return ((value ^ value >>> 14) >>> 0) / 4_294_967_296
	}
}

function selectShowcaseParticipants(seed = 'solvay-1911') {
	const random = seededRandom(seed)
	const speaker = showcaseCandidates[Math.floor(random() * showcaseCandidates.length)]
	const listeners = showcaseCandidates
		.filter((candidate) => candidate !== speaker && candidate.listeningImage)
		.map((candidate) => ({ candidate, order: random() }))
		.sort((left, right) => left.order - right.order)
		.slice(0, 3)
		.map(({ candidate }) => ({ ...candidate, imageSlug: candidate.listeningImage, role: 'listener' }))
	return [
		{ ...speaker, imageSlug: speaker.speakingImage, role: 'speaker' },
		...listeners,
	]
}

const isShowcase = Boolean(process.env.SHOWCASE_SCREENSHOT)
const participantSpecs = isShowcase
	? selectShowcaseParticipants(process.env.SHOWCASE_SEED)
	: regularParticipantSpecs

function findParticipantImage(slug) {
	for (const extension of ['png', 'jpg', 'jpeg', 'webp']) {
		const candidate = path.join(participantImageDirectory, `${slug}.${extension}`)
		if (fs.existsSync(candidate)) return candidate
	}
	return null
}

function prepareParticipantVideo(imagePath, outputPath) {
	const args = [
		'-y', '-v', 'error', '-loop', '1', '-i', imagePath,
		'-vf', 'scale=640:480:force_original_aspect_ratio=increase,crop=640:480,format=yuv420p',
		'-r', '30', '-frames:v', '150', outputPath,
	]
	let result = null
	if (fs.existsSync('/dev/dri/renderD128')) {
		result = spawnSync('ffmpeg', [
			'-hwaccel', 'vaapi', '-hwaccel_device', '/dev/dri/renderD128', '-hwaccel_output_format', 'vaapi',
			...args,
		], { encoding: 'utf8' })
	}
	if (!result || result.status !== 0) result = spawnSync('ffmpeg', args, { encoding: 'utf8' })
	if (result.status !== 0) throw new Error(`Could not prepare ${path.basename(imagePath)} as browser video: ${result.stderr}`)
}

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

async function joinTalkCall(page, name, { navigate = true, enableCamera = false } = {}) {
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
	const videoButton = page.getByRole('button', {
		name: enableCamera ? /^Enable video(?: \(V\))?/i : /^Disable video(?: \(V\))?/i,
	}).first()
	if (await videoButton.isVisible()) await videoButton.evaluate((button) => button.click())
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
	const participantBrowsers = []

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

		await Promise.all(participantSpecs.map(async ({ name, slug, imageSlug = slug }) => {
			const participantImage = findParticipantImage(imageSlug)
			const videoFixture = participantImage ? path.join(mediaDirectory, `${slug}.y4m`) : null
			if (participantImage) prepareParticipantVideo(participantImage, videoFixture)
			const participantBrowser = await chromium.launch({
				headless: true,
				...(participantExecutablePath ? { executablePath: participantExecutablePath } : {}),
				args: [
					'--autoplay-policy=no-user-gesture-required',
					'--use-fake-device-for-media-stream',
					'--use-fake-ui-for-media-stream',
					`--use-file-for-fake-audio-capture=${speechWav}`,
					...(videoFixture ? [`--use-file-for-fake-video-capture=${videoFixture}`] : []),
				],
			})
			participantBrowsers.push(participantBrowser)
			const context = await participantBrowser.newContext({
				permissions: ['camera', 'microphone'],
				userAgent: normalChromeUserAgent,
			})
			await joinTalkCall(await context.newPage(), name, { enableCamera: Boolean(videoFixture) })
		}))
		const participantNames = participantSpecs.map(({ name }) => name)

		try {
			await expect.poll(() => page.evaluate(() => {
				return [...window.__NCTALK_WAVEFORM__.sources.values()]
					.filter((source) => source.direction === 'remote' && source.origin === 'webrtc')
					.length
			}), { timeout: 45_000 }).toBe(participantSpecs.length)
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
		expect(new Set(remoteSources.map((source) => source.key)).size).toBe(participantSpecs.length)
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
				.every((source) => source.spectrogramFrames > 2)
		)), { timeout: 10_000 }).toBe(true)
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
				collapsed: source.collapsed,
				globalControlVisible: getComputedStyle(window.__NCTALK_WAVEFORM__.host).display !== 'none',
			}
		})).toEqual({
			origin: 'webrtc',
			hasSenderTrack: true,
			placement: 'card',
			mode: 'spectrogram',
			collapsed: false,
			globalControlVisible: false,
		})
		await expect(page.locator('.video-container > .nctalk-waveform-source')).toHaveCount(participantSpecs.length)
		await expect(page.locator('.localVideoContainer > .nctalk-waveform-source')).toHaveCount(1)
		const screenshotPath = process.env.SHOWCASE_SCREENSHOT
			? path.resolve(projectRoot, process.env.SHOWCASE_SCREENSHOT)
			: testInfo.outputPath('gocassini-participant-overlays.png')
		if (process.env.SHOWCASE_SCREENSHOT) {
			await expect.poll(() => page.evaluate(() => (
				[...window.__NCTALK_WAVEFORM__.sources.values()]
					.filter((source) => source.direction === 'remote' && source.origin === 'webrtc')
					.every((source) => source.spectrogramFrameCount >= 60)
			)), { timeout: 20_000 }).toBe(true)
			const requestedModes = Object.fromEntries([
				[participantSpecs[0]?.name, 'spectrogram'],
				[participantSpecs[1]?.name, 'spectrogram'],
				[participantSpecs[2]?.name, 'waveform'],
				[participantSpecs[3]?.name, 'amplitude'],
			].filter(([name]) => name))
			await page.evaluate(async (modesByName) => {
				const sources = [...window.__NCTALK_WAVEFORM__.sources.values()]
					.filter((source) => source.direction === 'remote' && source.origin === 'webrtc')
				for (const source of sources) {
					const requestedMode = modesByName[source.label]
					for (let attempt = 0; requestedMode && source.mode !== requestedMode && attempt < 4; attempt++) {
						source.modeButton.click()
						await new Promise((resolve) => requestAnimationFrame(resolve))
					}
				}
				const localSource = [...window.__NCTALK_WAVEFORM__.sources.values()]
					.find((source) => source.direction === 'local')
				if (localSource?.card) localSource.card.style.setProperty('display', 'none', 'important')
				const style = document.createElement('style')
				style.dataset.talkWaveformsShowcase = 'true'
				style.textContent = `
					.localVideoContainer { display: none !important; }
					.grid {
						grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
						grid-template-rows: repeat(2, minmax(0, 1fr)) !important;
					}
				`
				document.head.append(style)
			}, requestedModes)
			await expect.poll(() => page.evaluate((modesByName) => (
				[...window.__NCTALK_WAVEFORM__.sources.values()]
					.filter((source) => source.direction === 'remote' && source.origin === 'webrtc')
					.every((source) => source.mode === modesByName[source.label])
			), requestedModes), { timeout: 5_000 }).toBe(true)
		}
		await page.evaluate(() => {
			for (const container of document.querySelectorAll('.modal-mask, #app-sidebar-vue')) {
				const closeButton = [...container.querySelectorAll('button')].find((button) => (
					/close/i.test(button.getAttribute('aria-label') || button.getAttribute('title') || '')
				))
				closeButton?.click()
			}
		})
		await page.waitForTimeout(500)
		await page.screenshot({ path: screenshotPath, scale: 'css' })
	} finally {
		await Promise.all(participantBrowsers.map((browser) => browser.close()))
		fs.rmSync(mediaDirectory, { recursive: true, force: true })
	}
})
