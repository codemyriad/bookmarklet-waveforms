const { test, expect, chromium } = require('@playwright/test')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const callUrl = process.env.JITSI_URL
const projectRoot = path.join(__dirname, '..')
const loaderPath = path.join(projectRoot, 'bookmarklet-loader.js')
const systemChrome = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const participantExecutablePath = fs.existsSync(systemChrome) ? systemChrome : undefined
const normalChromeUserAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'
const participantImageDirectory = path.join(projectRoot, 'tests', 'participant-images')
const isShowcase = Boolean(process.env.JITSI_SCREENSHOT)
const regularParticipants = [
	{ name: 'Ada Lovelace', slug: 'ada-lovelace' },
	{ name: 'Alan Turing', slug: 'alan-turing' },
]
const showcaseParticipants = [
	{ name: 'Ada Lovelace', slug: 'ada-lovelace', image: 'ada-lovelace-speaking.0.4.0', voice: 'slt', delay: 1, mode: 'spectrogram', text: 'The machine might distinguish speech from repeated noise.' },
	{ name: 'Alan Turing', slug: 'alan-turing', image: 'alan-turing-listening.0.4.0', voice: 'rms', delay: 4.5, mode: 'amplitude', text: 'A useful test asks whether the signals can be told apart.' },
	{ name: 'Hypatia', slug: 'hypatia', image: 'hypatia-listening.0.4.0', voice: 'kal', delay: 8, mode: 'waveform', text: 'Observation begins when we compare patterns.' },
	{ name: 'Mary Somerville', slug: 'mary-somerville', image: 'mary-somerville-listening.0.4.0', voice: 'awb', delay: 11.5, mode: 'spectrogram', noise: true, text: 'The steady tone seems to come from my room.' },
]
const participants = isShowcase ? showcaseParticipants : regularParticipants
const participantNames = participants.map(({ name }) => name)
const observerCallUrl = callUrl && isShowcase
	? `${callUrl}#config.disableSelfView=true`
	: callUrl

test.skip(!callUrl, 'Set JITSI_URL to a room in the Jitsi Docker harness')

async function joinJitsiCall(page, name) {
	await page.goto(callUrl, { waitUntil: 'domcontentloaded' })
	await expect(page.getByTestId('prejoin.screen')).toBeVisible({ timeout: 30_000 })
	await page.getByPlaceholder('Enter your name').fill(name)
	await page.getByTestId('prejoin.joinMeeting').click()
	await expect(page.getByTestId('prejoin.screen')).toBeHidden({ timeout: 30_000 })
	await expect.poll(() => page.evaluate(() => {
		const conference = window.APP?.store?.getState?.()?.['features/base/conference']
		return Boolean(conference?.conference && !conference.joining)
	}), { timeout: 30_000 }).toBe(true)
}

function makeAudioFixture(directory, participant = null) {
	const outputPath = path.join(directory, `${participant?.slug || 'jitsi-speech-band'}.wav`)
	if (participant) {
		const textPath = path.join(directory, `${participant.slug}.txt`)
		const utterancePath = path.join(directory, `${participant.slug}-utterance.wav`)
		fs.writeFileSync(textPath, participant.text)
		const synthesis = spawnSync('ffmpeg', [
			'-y', '-v', 'error', '-f', 'lavfi',
			'-i', `flite=textfile=${textPath}:voice=${participant.voice}`,
			'-af', 'highpass=f=90,lowpass=f=5000,speechnorm=e=6.25:r=0.00001:l=1',
			'-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', utterancePath,
		], { encoding: 'utf8' })
		if (synthesis.status !== 0) throw new Error(`Could not synthesize ${participant.name}: ${synthesis.stderr}`)
		const delay = Math.round(participant.delay * 1_000)
		const background = participant.noise
			? 'sine=frequency=120:sample_rate=48000:duration=60,volume=0.035'
			: 'anullsrc=channel_layout=mono:sample_rate=48000'
		const assembly = spawnSync('ffmpeg', [
			'-y', '-v', 'error', '-f', 'lavfi', '-t', '60',
			'-i', background,
			'-i', utterancePath,
			'-filter_complex', `[1:a]adelay=${delay}[speech];[0:a][speech]amix=inputs=2:duration=first:normalize=0[out]`,
			'-map', '[out]', '-t', '60', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', outputPath,
		], { encoding: 'utf8' })
		if (assembly.status !== 0) throw new Error(`Could not schedule ${participant.name}: ${assembly.stderr}`)
		return outputPath
	}
	const result = spawnSync('ffmpeg', [
		'-y', '-v', 'error', '-f', 'lavfi',
		'-i', 'sine=frequency=180:sample_rate=48000:duration=60',
		'-af', 'tremolo=f=3:d=0.75,highpass=f=90,lowpass=f=5000',
		'-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', outputPath,
	], { encoding: 'utf8' })
	if (result.status !== 0) throw new Error(`Could not prepare Jitsi audio fixture: ${result.stderr}`)
	return outputPath
}

function makeVideoFixture(directory, participant) {
	if (!participant.image) return null
	const imagePath = path.join(participantImageDirectory, `${participant.image}.png`)
	const outputPath = path.join(directory, `${participant.slug}.y4m`)
	const result = spawnSync('ffmpeg', [
		'-y', '-v', 'error', '-loop', '1', '-i', imagePath,
		'-vf', 'scale=640:480:force_original_aspect_ratio=increase,crop=640:480,format=yuv420p',
		'-r', '30', '-frames:v', '150', outputPath,
	], { encoding: 'utf8' })
	if (result.status !== 0) throw new Error(`Could not prepare ${participant.name} video: ${result.stderr}`)
	return outputPath
}

test('maps every Jitsi audio track to its participant tile', async ({ page }, testInfo) => {
	test.setTimeout(150_000)
	const mediaDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-waveforms-jitsi-'))
	const sharedAudioFixture = isShowcase ? null : makeAudioFixture(mediaDirectory)
	const participantMedia = new Map(participants.map((participant) => [participant.name, {
		audio: sharedAudioFixture || makeAudioFixture(mediaDirectory, participant),
		video: makeVideoFixture(mediaDirectory, participant),
	}]))
	const participantBrowsers = []

	try {
		await page.goto(observerCallUrl, { waitUntil: 'domcontentloaded' })
		await expect(page.getByTestId('prejoin.screen')).toBeVisible({ timeout: 30_000 })
		await page.getByPlaceholder('Enter your name').fill('Waveform observer')
		const loader = decodeURIComponent(fs.readFileSync(loaderPath, 'utf8').trim().replace(/^javascript:/, ''))
		await page.evaluate(loader)
		await expect(page.locator('#nctalk-waveform')).toBeAttached({ timeout: 10_000 })
		expect(await page.evaluate(() => ({
			version: window.__TALK_WAVEFORMS__?.version,
			platform: window.__TALK_WAVEFORMS__?.platform,
			legacyAlias: window.__NCTALK_WAVEFORM__ === window.__TALK_WAVEFORMS__,
		}))).toEqual({ version: '0.5.1', platform: 'jitsi', legacyAlias: true })
		await page.getByTestId('prejoin.joinMeeting').click()
		await expect(page.getByTestId('prejoin.screen')).toBeHidden({ timeout: 30_000 })

		await Promise.all(participants.map(async ({ name }, index) => {
			const media = participantMedia.get(name)
			const browser = await chromium.launch({
				headless: true,
				...(participantExecutablePath ? { executablePath: participantExecutablePath } : {}),
				args: [
					'--autoplay-policy=no-user-gesture-required',
					'--use-fake-device-for-media-stream',
					'--use-fake-ui-for-media-stream',
					`--use-file-for-fake-audio-capture=${media.audio}`,
					...(media.video ? [`--use-file-for-fake-video-capture=${media.video}`] : []),
					`--window-position=${index * 20},${index * 20}`,
				],
			})
			participantBrowsers.push(browser)
			const context = await browser.newContext({
				permissions: ['camera', 'microphone'],
				userAgent: normalChromeUserAgent,
			})
			await joinJitsiCall(await context.newPage(), name)
		}))

		await expect.poll(() => page.evaluate(() => (
			window.APP?.store?.getState?.()?.['features/base/participants']?.remote?.size || 0
		)), { timeout: 45_000 }).toBe(participantNames.length)

		await expect.poll(() => page.evaluate(() => (
			[...window.__TALK_WAVEFORMS__.sources.values()]
				.filter((source) => source.direction === 'remote' && source.origin === 'webrtc')
				.length
		)), { timeout: 45_000 }).toBe(participantNames.length)

		const sources = await page.evaluate(() => (
			[...window.__TALK_WAVEFORMS__.sources.values()].map((source) => ({
				label: source.label,
				direction: source.direction,
				origin: source.origin,
				mode: source.mode,
				participantId: source.jitsiParticipantId,
				cardId: source.card?.id,
				placement: source.viewHost.dataset.placement,
				trackCount: source.stream.getAudioTracks().length,
			}))
		))
		const remoteSources = sources.filter((source) => source.direction === 'remote')
		expect(remoteSources.map((source) => source.label).sort()).toEqual([...participantNames].sort())
		for (const source of remoteSources) {
			expect(source).toMatchObject({
				origin: 'webrtc',
				mode: 'spectrogram',
				placement: 'card',
				trackCount: 1,
			})
			expect(source.participantId).toBeTruthy()
			expect(source.cardId).toBe(`participant_${source.participantId}`)
		}
		const localSources = sources.filter((source) => source.direction === 'local')
		expect(localSources).toHaveLength(1)
		expect(localSources[0]).toMatchObject({
			label: 'You',
			origin: 'webrtc',
			mode: 'spectrogram',
			trackCount: 1,
		})
		if (isShowcase) {
			expect(localSources[0]).toMatchObject({ placement: 'fallback' })
		} else {
			expect(localSources[0]).toMatchObject({
				cardId: 'localVideoContainer',
				placement: 'card',
			})
			await expect(page.locator('#localVideoContainer > .nctalk-waveform-source')).toHaveCount(1)
		}
		for (const source of remoteSources) {
			await expect(page.locator(`#${source.cardId} > .nctalk-waveform-source`)).toHaveCount(1)
		}
		await expect(page.locator('[data-placement="fallback"]')).toHaveCount(isShowcase ? 1 : 0)

		await expect.poll(() => page.evaluate(() => (
			[...window.__TALK_WAVEFORMS__.sources.values()].every((source) => source.spectrogramFrames > 2)
		)), { timeout: 15_000 }).toBe(true)

		const clickResult = await page.evaluate(async () => {
			const source = [...window.__TALK_WAVEFORMS__.sources.values()]
				.find((candidate) => candidate.direction === 'remote')
			let leakedClicks = 0
			source.card.addEventListener('click', () => leakedClicks++)
			source.modeButton.click()
			await new Promise((resolve) => setTimeout(resolve))
			return { mode: source.mode, leakedClicks }
		})
		expect(clickResult).toEqual({ mode: 'waveform', leakedClicks: 0 })

		if (isShowcase) {
			const requestedModes = Object.fromEntries(participants.map(({ name, mode }) => [name, mode]))
			await page.evaluate(async (modesByName) => {
				for (const source of window.__TALK_WAVEFORMS__.sources.values()) {
					if (source.direction !== 'remote') continue
					const requestedMode = modesByName[source.label]
					for (let attempt = 0; requestedMode && source.mode !== requestedMode && attempt < 4; attempt++) {
						source.modeButton.click()
						await new Promise((resolve) => setTimeout(resolve))
					}
				}
				window.__TALK_WAVEFORMS__.host.style.display = 'none'
				for (const source of window.__TALK_WAVEFORMS__.sources.values()) {
					if (source.direction === 'local') source.viewHost.style.display = 'none'
				}
			}, requestedModes)
			await page.waitForTimeout(12_000)
			await page.mouse.move(2, 2)
			await page.waitForTimeout(2_000)
			await page.screenshot({ path: path.resolve(projectRoot, process.env.JITSI_SCREENSHOT) })
		}
	} catch (error) {
		const debugState = await page.evaluate(() => ({
			url: location.href,
			api: Boolean(window.__TALK_WAVEFORMS__),
			participants: [...(window.APP?.store?.getState?.()?.['features/base/participants']?.remote || new Map())]
				.map(([id, participant]) => ({ id, name: participant.name })),
			tracks: (window.APP?.store?.getState?.()?.['features/base/tracks'] || []).map((track) => ({
				local: track.local,
				mediaType: track.mediaType,
				participantId: track.participantId,
				nativeTrackId: track.jitsiTrack?.getTrack?.()?.id,
			})),
			sources: [...(window.__TALK_WAVEFORMS__?.sources?.values?.() || [])].map((source) => ({
				label: source.label,
				direction: source.direction,
				origin: source.origin,
				participantId: source.jitsiParticipantId,
				cardId: source.card?.id,
			})),
		})).catch(() => ({}))
		await page.screenshot({ path: testInfo.outputPath('jitsi-failure.png') }).catch(() => {})
		throw new Error(`${error.message}\n\nJitsi observer state:\n${JSON.stringify(debugState, null, 2)}`)
	} finally {
		await Promise.all(participantBrowsers.map((browser) => browser.close()))
		fs.rmSync(mediaDirectory, { recursive: true, force: true })
	}
})
