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
const conversationLines = {
	'Albert Einstein': { voice: 'awb', text: 'Radiation may exchange energy only in finite quanta.' },
	'Ernest Rutherford': { voice: 'rms', text: 'How do these quanta interact with matter?' },
	'Marie Curie': { voice: 'slt', text: 'Measurements must show where classical theory fails.' },
	'Paul Langevin': { voice: 'kal16', text: 'The thermal evidence should constrain the new hypothesis.' },
	'Henri Poincaré': { voice: 'kal', text: 'Discontinuous energy challenges classical mechanics.' },
}

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

function prepareConversationAudio(participant, turnOffsetSeconds, directory) {
	const line = conversationLines[participant.name]
	if (!line) throw new Error(`No conversation line configured for ${participant.name}`)
	const textPath = path.join(directory, `${participant.slug}.txt`)
	const utterancePath = path.join(directory, `${participant.slug}-utterance.wav`)
	const outputPath = path.join(directory, `${participant.slug}-conversation.wav`)
	fs.writeFileSync(textPath, line.text)

	const synthesis = spawnSync('ffmpeg', [
		'-y', '-v', 'error', '-f', 'lavfi',
		'-i', `flite=textfile=${textPath}:voice=${line.voice}`,
		'-af', 'highpass=f=90,lowpass=f=5000,speechnorm=e=6.25:r=0.00001:l=1',
		'-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', utterancePath,
	], { encoding: 'utf8' })
	if (synthesis.status !== 0) throw new Error(`Could not synthesize ${participant.name}: ${synthesis.stderr}`)

	const turnStarts = [turnOffsetSeconds, turnOffsetSeconds + 20, turnOffsetSeconds + 40]
	const [firstDelay, secondDelay, thirdDelay] = turnStarts.map((seconds) => Math.round(seconds * 1_000))
	const filter = [
		'[1:a]asplit=3[first][second][third]',
		`[first]adelay=${firstDelay}[first-delayed]`,
		`[second]adelay=${secondDelay}[second-delayed]`,
		`[third]adelay=${thirdDelay}[third-delayed]`,
		'[0:a][first-delayed][second-delayed][third-delayed]amix=inputs=4:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.8[out]',
	].join(';')
	const assembly = spawnSync('ffmpeg', [
		'-y', '-v', 'error', '-f', 'lavfi', '-t', '60',
		'-i', 'anullsrc=channel_layout=mono:sample_rate=48000',
		'-i', utterancePath, '-filter_complex', filter, '-map', '[out]',
		'-t', '60', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', outputPath,
	], { encoding: 'utf8' })
	if (assembly.status !== 0) throw new Error(`Could not schedule ${participant.name}: ${assembly.stderr}`)
	return outputPath
}

function readPcmWav(filePath) {
	const wav = fs.readFileSync(filePath)
	let channels = 0
	let sampleRate = 0
	let bitsPerSample = 0
	let dataOffset = 0
	let dataSize = 0
	for (let offset = 12; offset + 8 <= wav.length;) {
		const chunkName = wav.toString('ascii', offset, offset + 4)
		const chunkSize = wav.readUInt32LE(offset + 4)
		if (chunkName === 'fmt ') {
			if (wav.readUInt16LE(offset + 8) !== 1) throw new Error(`${filePath} must use PCM audio`)
			channels = wav.readUInt16LE(offset + 10)
			sampleRate = wav.readUInt32LE(offset + 12)
			bitsPerSample = wav.readUInt16LE(offset + 22)
		} else if (chunkName === 'data') {
			dataOffset = offset + 8
			dataSize = chunkSize
			break
		}
		offset += 8 + chunkSize + (chunkSize % 2)
	}
	if (!dataOffset || bitsPerSample !== 16 || !channels || !sampleRate) {
		throw new Error(`${filePath} must be a 16-bit PCM WAV`)
	}
	const samples = new Float64Array(dataSize / 2 / channels)
	for (let frame = 0; frame < samples.length; frame++) {
		samples[frame] = wav.readInt16LE(dataOffset + frame * channels * 2) / 32_768
	}
	return { samples, sampleRate }
}

function fft(input) {
	const size = input.length
	const real = Float64Array.from(input)
	const imaginary = new Float64Array(size)
	for (let index = 1, reversed = 0; index < size; index++) {
		let bit = size >> 1
		for (; reversed & bit; bit >>= 1) reversed ^= bit
		reversed ^= bit
		if (index < reversed) [real[index], real[reversed]] = [real[reversed], real[index]]
	}
	for (let length = 2; length <= size; length <<= 1) {
		const angle = -2 * Math.PI / length
		const stepReal = Math.cos(angle)
		const stepImaginary = Math.sin(angle)
		for (let start = 0; start < size; start += length) {
			let weightReal = 1
			let weightImaginary = 0
			for (let offset = 0; offset < length / 2; offset++) {
				const even = start + offset
				const odd = even + length / 2
				const oddReal = real[odd] * weightReal - imaginary[odd] * weightImaginary
				const oddImaginary = real[odd] * weightImaginary + imaginary[odd] * weightReal
				real[odd] = real[even] - oddReal
				imaginary[odd] = imaginary[even] - oddImaginary
				real[even] += oddReal
				imaginary[even] += oddImaginary
				const nextWeightReal = weightReal * stepReal - weightImaginary * stepImaginary
				weightImaginary = weightReal * stepImaginary + weightImaginary * stepReal
				weightReal = nextWeightReal
			}
		}
	}
	return { real, imaginary }
}

function buildConversationHistory(filePath) {
	const { samples, sampleRate } = readPcmWav(filePath)
	const durationSeconds = 15
	const spectrogramWidth = 150
	const spectrogramHeight = 128
	const fftSize = 2_048
	const maxBin = Math.floor(8_000 / sampleRate * fftSize)
	const smoothed = new Float64Array(fftSize / 2)
	const spectrogram = new Uint8Array(spectrogramWidth * spectrogramHeight)
	for (let column = 0; column < spectrogramWidth; column++) {
		const windowStart = Math.floor(column / spectrogramWidth * durationSeconds * sampleRate)
		const windowed = new Float64Array(fftSize)
		for (let index = 0; index < fftSize; index++) {
			const sample = samples[windowStart + index] || 0
			windowed[index] = sample * (.5 - .5 * Math.cos(2 * Math.PI * index / (fftSize - 1)))
		}
		const { real, imaginary } = fft(windowed)
		for (let bin = 0; bin < smoothed.length; bin++) {
			const magnitude = Math.hypot(real[bin], imaginary[bin]) / (fftSize * .5)
			const decibels = 20 * Math.log10(Math.max(1e-8, magnitude))
			const value = Math.max(0, Math.min(255, Math.round((decibels + 95) / 75 * 255)))
			smoothed[bin] = smoothed[bin] * .58 + value * .42
		}
		for (let y = 0; y < spectrogramHeight; y++) {
			const normalizedFrequency = 1 - y / (spectrogramHeight - 1)
			const bin = Math.floor(normalizedFrequency * normalizedFrequency * maxBin)
			spectrogram[column * spectrogramHeight + y] = Math.round(smoothed[bin])
		}
	}

	const amplitudeSamples = 300
	const amplitude = new Array(amplitudeSamples)
	const amplitudeWindow = Math.floor(sampleRate * durationSeconds / amplitudeSamples)
	for (let index = 0; index < amplitudeSamples; index++) {
		let energy = 0
		const start = index * amplitudeWindow
		for (let offset = 0; offset < amplitudeWindow; offset++) {
			const sample = samples[start + offset] || 0
			energy += sample * sample
		}
		amplitude[index] = Math.sqrt(energy / amplitudeWindow)
	}
	return { spectrogram: Array.from(spectrogram), amplitude }
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
	const showcaseTurnOffsets = [11.5, 1, 4.5, 8]
	const participantAudio = new Map(participantSpecs.map((participant, index) => [
		participant.slug,
		isShowcase
			? prepareConversationAudio(participant, showcaseTurnOffsets[index], mediaDirectory)
			: speechWav,
	]))
	const showcaseHistories = isShowcase
		? Object.fromEntries(participantSpecs.map((participant) => [
			participant.name,
			buildConversationHistory(participantAudio.get(participant.slug)),
		]))
		: {}

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
					`--use-file-for-fake-audio-capture=${participantAudio.get(slug)}`,
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
		if (!isShowcase) {
			const audioClockStart = await page.evaluate(() => window.__NCTALK_WAVEFORM__.context.currentTime)
			await page.waitForTimeout(250)
			const audioClockAdvanced = await page.evaluate((start) => (
				window.__NCTALK_WAVEFORM__.context.currentTime > start + .05
			), audioClockStart)
			if (audioClockAdvanced) {
				await expect.poll(() => page.evaluate(() => (
					[...window.__NCTALK_WAVEFORM__.sources.values()]
						.filter((source) => source.direction === 'remote' && source.origin === 'webrtc')
						.some((source) => source.lastLevel > 0.003)
				)), { timeout: 20_000 }).toBe(true)
			} else {
				testInfo.annotations.push({
					type: 'audio-clock',
					description: 'Signal-level assertion skipped because headless Chrome did not advance its Web Audio clock',
				})
			}
		}
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
			await page.evaluate((histories) => {
				const hslToRgb = (hue, saturation, lightness) => {
					const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
					const section = ((hue % 360) + 360) % 360 / 60
					const secondary = chroma * (1 - Math.abs(section % 2 - 1))
					let red = 0
					let green = 0
					let blue = 0
					if (section < 1) [red, green] = [chroma, secondary]
					else if (section < 2) [red, green] = [secondary, chroma]
					else if (section < 3) [green, blue] = [chroma, secondary]
					else if (section < 4) [green, blue] = [secondary, chroma]
					else if (section < 5) [red, blue] = [secondary, chroma]
					else [red, blue] = [chroma, secondary]
					const match = lightness - chroma / 2
					return [red, green, blue].map((component) => Math.round((component + match) * 255))
				}
				const palette = Array.from({ length: 256 }, (_, index) => {
					const value = Math.max(0, (index - 18) / 237)
					return hslToRgb(230 - value * 210, .88, .07 + value * .6)
				})
				const now = performance.now()
				for (const source of window.__NCTALK_WAVEFORM__.sources.values()) {
					const history = histories[source.label]
					if (!history || source.direction !== 'remote' || source.origin !== 'webrtc') continue
					const width = source.spectrogramCanvas.width
					const height = source.spectrogramCanvas.height
					const imageData = source.spectrogramContext.createImageData(width, height)
					for (let x = 0; x < width; x++) {
						for (let y = 0; y < height; y++) {
							const value = history.spectrogram[x * height + y]
							const [red, green, blue] = palette[value]
							const pixel = (y * width + x) * 4
							imageData.data[pixel] = red
							imageData.data[pixel + 1] = green
							imageData.data[pixel + 2] = blue
							imageData.data[pixel + 3] = 255
						}
					}
					source.spectrogramContext.putImageData(imageData, 0, 0)
					source.spectrogramWriteIndex = 0
					source.spectrogramFrameCount = width
					source.spectrogramFrames++
					source.lastSpectrogramAt = now
					source.amplitudeHistory = history.amplitude.map((level, index) => ({
						time: now - 15_000 + index * 50,
						level,
					}))
					source.lastHistoryAt = now
					source.lastLevel = history.amplitude.at(-1) || 0
				}
			}, showcaseHistories)
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
