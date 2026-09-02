const { test, expect } = require('@playwright/test')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const screenshotPath = process.env.TEAMS_SCREENSHOT
const projectRoot = path.join(__dirname, '..')
const participantImageDirectory = path.join(projectRoot, 'tests', 'participant-images')
const bookmarklet = decodeURIComponent(fs.readFileSync(path.join(projectRoot, 'bookmarklet-loader.js'), 'utf8').trim().replace(/^javascript:/, ''))
const fixtureUrl = 'https://teams.live.com/light-meetings/launch?showcase=calendar-reform'
const participants = [
	{
		name: 'Julius Caesar', slug: 'julius-caesar', image: 'julius-caesar-listening.0.5.0.png',
		voice: 'rms', delay: .5, mode: 'amplitude',
		text: 'One day is simple. Where shall we put it?',
	},
	{
		name: 'Cleopatra VII', slug: 'cleopatra', image: 'cleopatra-listening.0.5.0.png',
		voice: 'slt', delay: 4.2, mode: 'spectrum',
		text: 'After February. People already distrust that month.',
	},
	{
		name: 'Cicero', slug: 'cicero', image: 'cicero-listening.0.5.0.png',
		voice: 'awb', delay: 8, mode: 'spectrogram',
		text: 'I object to the month, but not to the arithmetic.',
	},
	{
		name: 'Sosigenes', slug: 'sosigenes', image: 'sosigenes-speaking.0.5.0.png',
		voice: 'kal', delay: 11.7, mode: 'spectrogram', active: true,
		text: 'The year is shorter than we pretend. Add a day every fourth winter.',
	},
]

test.skip(!screenshotPath, 'Set TEAMS_SCREENSHOT to capture the Teams showcase')

function makeSpeechFixture(directory, participant) {
	const textPath = path.join(directory, `${participant.slug}.txt`)
	const utterancePath = path.join(directory, `${participant.slug}-utterance.wav`)
	const outputPath = path.join(directory, `${participant.slug}.wav`)
	fs.writeFileSync(textPath, participant.text)
	const synthesis = spawnSync('ffmpeg', [
		'-y', '-v', 'error', '-f', 'lavfi',
		'-i', `flite=textfile=${textPath}:voice=${participant.voice}`,
		'-af', 'highpass=f=90,lowpass=f=4800,speechnorm=e=6.25:r=0.00001:l=1',
		'-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', utterancePath,
	], { encoding: 'utf8' })
	if (synthesis.status !== 0) throw new Error(`Could not synthesize ${participant.name}: ${synthesis.stderr}`)
	const assembly = spawnSync('ffmpeg', [
		'-y', '-v', 'error', '-f', 'lavfi', '-t', '18',
		'-i', 'anullsrc=channel_layout=mono:sample_rate=48000', '-i', utterancePath,
		'-filter_complex', `[1:a]adelay=${Math.round(participant.delay * 1_000)}[speech];[0:a][speech]amix=inputs=2:duration=first:normalize=0[out]`,
		'-map', '[out]', '-t', '18', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', outputPath,
	], { encoding: 'utf8' })
	if (assembly.status !== 0) throw new Error(`Could not schedule ${participant.name}: ${assembly.stderr}`)
	return outputPath
}

test('captures a four-participant historical Teams call', async ({ page }) => {
	test.setTimeout(60_000)
	const mediaDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-waveforms-teams-showcase-'))
	const audioPaths = new Map(participants.map((participant) => [participant.slug, makeSpeechFixture(mediaDirectory, participant)]))

	for (const participant of participants) {
		await page.route(`https://teams.live.com/__talk-waveforms/${participant.image}`, (route) => route.fulfill({
			status: 200,
			contentType: 'image/png',
			body: fs.readFileSync(path.join(participantImageDirectory, participant.image)),
		}))
		await page.route(`https://teams.live.com/__talk-waveforms/${participant.slug}.wav`, (route) => route.fulfill({
			status: 200,
			contentType: 'audio/wav',
			body: fs.readFileSync(audioPaths.get(participant.slug)),
		}))
	}

	await page.route(fixtureUrl, (route) => route.fulfill({
		status: 200,
		headers: {
			'Content-Security-Policy': "default-src 'self' data:; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; style-src 'unsafe-inline'; require-trusted-types-for 'script'; trusted-types dompurify @msteams/light-meetings",
		},
		contentType: 'text/html',
		body: `<!doctype html>
			<html lang="en"><head><meta charset="utf-8"><title>Calendar reform · Microsoft Teams</title>
			<style>
				:root { color-scheme: dark; font-family: "Segoe UI", system-ui, sans-serif; background: #171717; color: #f5f5f5; }
				* { box-sizing: border-box; }
				body { width: 100vw; height: 100vh; margin: 0; overflow: hidden; background: radial-gradient(circle at 50% 20%, #343238 0, #222126 35%, #171719 80%); }
				.topbar { height: 68px; display: flex; align-items: center; gap: 16px; padding: 0 24px; background: #242424; border-bottom: 1px solid #3a3a3a; }
				.teams-mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 8px; background: #6264a7; color: white; font-weight: 700; font-size: 20px; }
				.meeting { min-width: 0; }
				.meeting strong { display: block; font-size: 18px; font-weight: 600; }
				.meeting span { display: block; margin-top: 2px; color: #b7b7b7; font-size: 13px; }
				.call-time { margin-left: auto; color: #d6d6d6; font-variant-numeric: tabular-nums; }
				.roster { display: inline-flex; align-items: center; gap: 7px; padding: 7px 11px; border-radius: 6px; background: #333; color: #ddd; font-size: 13px; }
				.grid { height: calc(100vh - 136px); display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 10px; padding: 12px 18px; }
				.tile { position: relative; min-width: 0; min-height: 0; overflow: hidden; border: 2px solid transparent; border-radius: 9px; background: #292929; box-shadow: 0 4px 16px rgba(0,0,0,.32); }
				.tile.active { border-color: #8bd3a9; }
				.tile img { width: 100%; height: 100%; display: block; object-fit: cover; }
				.tile-name { position: absolute; left: 12px; top: 10px; z-index: 2; padding: 5px 8px; border-radius: 5px; background: rgba(0,0,0,.66); font-size: 15px; font-weight: 600; text-shadow: 0 1px 2px #000; }
				.tile.active .tile-name::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 7px; border-radius: 50%; background: #72d69b; vertical-align: 1px; }
				.stream { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
				.controls { height: 68px; display: flex; align-items: center; justify-content: center; gap: 10px; background: #242424; border-top: 1px solid #383838; }
				.control { display: grid; place-items: center; width: 42px; height: 42px; border: 1px solid #4c4c4c; border-radius: 50%; background: #333; color: #efefef; font-size: 17px; }
				.leave { width: auto; padding: 0 20px; border-radius: 7px; border-color: #d83b48; background: #c4314b; font-size: 14px; font-weight: 600; }
			</style></head>
			<body>
				<header class="topbar"><div class="teams-mark">T</div><div class="meeting"><strong>Calendar reform</strong><span>46 BCE · Alexandria and Rome</span></div><span class="call-time">15:02</span><span class="roster">◉ 4</span></header>
				<main class="grid" id="teams-showcase" aria-label="Meeting participants"></main>
				<footer class="controls" aria-label="Call controls"><span class="control">♩</span><span class="control">▣</span><span class="control">☵</span><span class="control">☻</span><span class="control leave">Leave</span></footer>
			</body></html>`,
	}))

	await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' })
	await page.evaluate(async (participantData) => {
		const context = new AudioContext()
		await context.resume()
		const fixtures = []
		for (const participant of participantData) {
			const tile = document.createElement('section')
			tile.className = `tile${participant.active ? ' active' : ''}`
			tile.dataset.tid = `participant-tile-${participant.slug}`
			tile.dataset.cid = participant.slug
			tile.setAttribute('role', 'listitem')
			const image = document.createElement('img')
			image.src = `https://teams.live.com/__talk-waveforms/${participant.image}`
			image.alt = ''
			const label = document.createElement('span')
			label.className = 'tile-name'
			label.dataset.tid = 'participant-display-name'
			label.textContent = participant.name
			const audio = document.createElement('audio')
			audio.className = 'stream'
			audio.autoplay = true
			const response = await fetch(`https://teams.live.com/__talk-waveforms/${participant.slug}.wav`)
			const buffer = await context.decodeAudioData(await response.arrayBuffer())
			const source = context.createBufferSource()
			const destination = context.createMediaStreamDestination()
			source.buffer = buffer
			source.connect(destination)
			source.start(context.currentTime + .1)
			audio.srcObject = destination.stream
			tile.append(image, label, audio)
			document.querySelector('#teams-showcase').append(tile)
			fixtures.push({ source, destination, audio })
		}
		window.__TEAMS_SHOWCASE__ = { context, fixtures }
	}, participants)

	await page.evaluate(bookmarklet)
	await expect.poll(() => page.evaluate(() => window.__TALK_WAVEFORMS__?.sources.size)).toBe(4)
	await page.evaluate(async (participantData) => {
		for (const participant of participantData) {
			const source = [...window.__TALK_WAVEFORMS__.sources.values()].find((candidate) => candidate.label === participant.name)
			while (source.mode !== participant.mode) {
				source.modeButton.click()
				await new Promise((resolve) => setTimeout(resolve, 0))
			}
		}
	}, participants)
	await expect.poll(() => page.evaluate(() => (
		[...window.__TALK_WAVEFORMS__.sources.values()].every((source) => source.spectrogramFrames >= 140)
	)), { timeout: 20_000 }).toBe(true)

	const modes = await page.evaluate(() => Object.fromEntries(
		[...window.__TALK_WAVEFORMS__.sources.values()].map((source) => [source.label, source.mode]),
	))
	expect(modes).toEqual(Object.fromEntries(participants.map(({ name, mode }) => [name, mode])))
	await page.screenshot({ path: path.resolve(projectRoot, screenshotPath) })

	await page.evaluate(async () => {
		window.__TALK_WAVEFORMS__.destroy()
		for (const fixture of window.__TEAMS_SHOWCASE__.fixtures) fixture.destination.stream.getTracks().forEach((track) => track.stop())
		await window.__TEAMS_SHOWCASE__.context.close()
	})
	fs.rmSync(mediaDirectory, { recursive: true, force: true })
})
