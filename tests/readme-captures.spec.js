const { test, expect } = require('@playwright/test')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Regenerates the overlay images embedded in README.md. One synthetic Nextcloud
// Talk participant speaks twice over a steady 120 Hz fan tone, and each of the
// four views is captured as an element screenshot of its overlay. Run it with
// `npm run capture:readme`; the spec is skipped unless README_CAPTURE_DIR is set.

const captureDirectory = process.env.README_CAPTURE_DIR
const projectRoot = path.join(__dirname, '..')
const bookmarklet = decodeURIComponent(fs.readFileSync(path.join(projectRoot, 'bookmarklet-loader.js'), 'utf8').trim().replace(/^javascript:/, ''))
const fixtureUrl = 'https://talk.example.test/call/readme'
const participant = {
	name: 'Mary Somerville',
	voice: 'slt',
	turns: [
		{ delay: 1.2, text: 'Can anyone else hear that steady hum?' },
		{ delay: 8.4, text: 'It seems to come from my side of the call.' },
	],
}

test.skip(!captureDirectory, 'Set README_CAPTURE_DIR to regenerate the README overlay captures')

function synthesizeUtterance(directory, index, turn) {
	const textPath = path.join(directory, `turn-${index}.txt`)
	const outputPath = path.join(directory, `turn-${index}.wav`)
	fs.writeFileSync(textPath, turn.text)
	const synthesis = spawnSync('ffmpeg', [
		'-y', '-v', 'error', '-f', 'lavfi',
		'-i', `flite=textfile=${textPath}:voice=${participant.voice}`,
		'-af', 'highpass=f=90,lowpass=f=4800,speechnorm=e=6.25:r=0.00001:l=1',
		'-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', outputPath,
	], { encoding: 'utf8' })
	if (synthesis.status !== 0) throw new Error(`Could not synthesize turn ${index}: ${synthesis.stderr}`)
	return outputPath
}

function makeCallAudio(directory) {
	const utterances = participant.turns.map((turn, index) => synthesizeUtterance(directory, index, turn))
	const outputPath = path.join(directory, 'call.wav')
	const inputs = utterances.flatMap((utterance) => ['-i', utterance])
	const delayed = participant.turns
		.map((turn, index) => `[${index + 1}:a]adelay=${Math.round(turn.delay * 1_000)}[speech${index}]`)
		.join(';')
	const mixed = participant.turns.map((turn, index) => `[speech${index}]`).join('')
	const assembly = spawnSync('ffmpeg', [
		'-y', '-v', 'error', '-f', 'lavfi', '-t', '17',
		'-i', 'sine=frequency=120:sample_rate=48000:duration=17,volume=0.035',
		...inputs,
		'-filter_complex', `${delayed};[0:a]${mixed}amix=inputs=${utterances.length + 1}:duration=first:normalize=0[out]`,
		'-map', '[out]', '-t', '17', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', outputPath,
	], { encoding: 'utf8' })
	if (assembly.status !== 0) throw new Error(`Could not assemble the call audio: ${assembly.stderr}`)
	return outputPath
}

async function captureMode(page, mode, fileName) {
	await page.evaluate(async (targetMode) => {
		const source = [...window.__TALK_WAVEFORMS__.sources.values()][0]
		while (source.mode !== targetMode) {
			source.modeButton.click()
			await new Promise((resolve) => setTimeout(resolve, 0))
		}
	}, mode)
	const renderedFrames = await page.evaluate(() => [...window.__TALK_WAVEFORMS__.sources.values()][0].renderFrames)
	await expect.poll(() => page.evaluate(() => [...window.__TALK_WAVEFORMS__.sources.values()][0].renderFrames))
		.toBeGreaterThan(renderedFrames)
	await page.locator('.nctalk-waveform-source').screenshot({
		path: path.resolve(projectRoot, captureDirectory, fileName),
		omitBackground: true,
	})
}

test('captures the four overlay views for the README', async ({ page }) => {
	test.setTimeout(90_000)
	const mediaDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-waveforms-readme-'))
	const callAudioPath = makeCallAudio(mediaDirectory)
	fs.mkdirSync(path.resolve(projectRoot, captureDirectory), { recursive: true })

	await page.route(`${fixtureUrl}/audio.wav`, (route) => route.fulfill({
		status: 200,
		contentType: 'audio/wav',
		body: fs.readFileSync(callAudioPath),
	}))
	await page.route(fixtureUrl, (route) => route.fulfill({
		status: 200,
		contentType: 'text/html; charset=utf-8',
		body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>README capture</title>
			<style>
				body { margin: 0; padding: 24px; background: #1b1b1b; font: 14px system-ui, sans-serif; }
				.video-container { position: relative; width: 656px; height: 200px; overflow: hidden; border-radius: 12px; background: linear-gradient(160deg, #2a3140, #151922); }
				.video-container__user-name { position: absolute; left: 12px; top: 12px; color: #fff; }
			</style></head>
			<body><main id="app-content-vue">
				<div class="video-container" id="container_readme_video_incoming">
					<span class="video-container__user-name">${participant.name}</span>
				</div>
			</main></body></html>`,
	}))

	await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' })
	await page.evaluate(async (name) => {
		const context = new AudioContext()
		await context.resume()
		const response = await fetch('/call/readme/audio.wav')
		const buffer = await context.decodeAudioData(await response.arrayBuffer())
		const destination = context.createMediaStreamDestination()
		const play = (when, loop = false) => {
			const source = context.createBufferSource()
			source.buffer = buffer
			source.loop = loop
			source.connect(destination)
			source.start(when)
			return source
		}
		const audio = document.createElement('audio')
		audio.setAttribute('aria-label', name)
		audio.autoplay = true
		audio.srcObject = destination.stream
		document.querySelector('.video-container').append(audio)
		window.__README_CAPTURE__ = { context, buffer, destination, play, history: play(context.currentTime + .1) }
	}, participant.name)

	await page.evaluate(bookmarklet)
	await expect.poll(() => page.evaluate(() => window.__TALK_WAVEFORMS__?.sources.size)).toBe(1)
	await expect.poll(() => page.evaluate(() => [...window.__TALK_WAVEFORMS__.sources.values()][0].label)).toBe(participant.name)
	await expect.poll(() => page.evaluate(() => [...window.__TALK_WAVEFORMS__.sources.values()][0].viewHost.dataset.placement)).toBe('card')

	// Let the 15-second window fill with the two speech turns and the fan tone.
	await expect.poll(() => page.evaluate(() => (
		[...window.__TALK_WAVEFORMS__.sources.values()][0].spectrogramFrames >= 155
	)), { timeout: 30_000 }).toBe(true)
	await captureMode(page, 'spectrogram', 'spectrogram.png')
	await captureMode(page, 'amplitude', 'amplitude.png')

	// The live views need sound at the moment of capture, so loop the speech.
	await page.evaluate(() => {
		window.__README_CAPTURE__.history.stop()
		window.__README_CAPTURE__.live = window.__README_CAPTURE__.play(window.__README_CAPTURE__.context.currentTime + .05, true)
	})
	const waitForSpeech = () => expect.poll(() => page.evaluate(() => (
		[...window.__TALK_WAVEFORMS__.sources.values()][0].lastLevel
	)), { timeout: 20_000 }).toBeGreaterThan(0.08)
	await waitForSpeech()
	await captureMode(page, 'spectrum', 'spectrum.png')
	await waitForSpeech()
	await captureMode(page, 'waveform', 'waveform.png')

	await page.evaluate(async () => {
		window.__TALK_WAVEFORMS__.destroy()
		window.__README_CAPTURE__.live.stop()
		window.__README_CAPTURE__.destination.stream.getTracks().forEach((track) => track.stop())
		await window.__README_CAPTURE__.context.close()
	})
	fs.rmSync(mediaDirectory, { recursive: true, force: true })
})
