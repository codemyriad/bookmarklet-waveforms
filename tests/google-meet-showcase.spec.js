const { test, expect } = require('@playwright/test')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const screenshotPath = process.env.GOOGLE_SCREENSHOT
const projectRoot = path.join(__dirname, '..')
const participantImageDirectory = path.join(projectRoot, 'tests', 'participant-images')
const bookmarklet = decodeURIComponent(fs.readFileSync(path.join(projectRoot, 'bookmarklet-loader.js'), 'utf8').trim().replace(/^javascript:/, ''))
const fixtureUrl = 'https://meet.google.com/abc-defg-hij'
const participants = [
	{ name: 'Charles Babbage', slug: 'charles-babbage', image: 'charles-babbage-listening.0.5.0.png', voice: 'rms', delay: .5, mode: 'amplitude', text: 'A machine may arrange notes, if the cards describe the order.' },
	{ name: 'Mary Somerville', slug: 'mary-somerville', image: 'mary-somerville-listening.0.5.0.png', voice: 'slt', delay: 4.2, mode: 'waveform', text: 'Then the rule matters more than the material it works upon.' },
	{ name: 'Michael Faraday', slug: 'michael-faraday', image: 'michael-faraday-listening.0.5.0.png', voice: 'awb', delay: 8, mode: 'spectrogram', text: 'I should like to hear whether the pattern surprises its maker.' },
	{ name: 'Ada Lovelace', slug: 'ada-lovelace', image: 'ada-lovelace-speaking.0.5.0.png', voice: 'kal', delay: 11.7, mode: 'spectrogram', active: true, text: 'The engine might compose elaborate pieces of music of any complexity.' },
]

test.skip(!screenshotPath, 'Set GOOGLE_SCREENSHOT to capture the Google Meet showcase')

function makeSpeechFixture(directory, participant) {
	const textPath = path.join(directory, `${participant.slug}.txt`)
	const utterancePath = path.join(directory, `${participant.slug}-utterance.wav`)
	const outputPath = path.join(directory, `${participant.slug}.wav`)
	fs.writeFileSync(textPath, participant.text)
	let result = spawnSync('ffmpeg', [
		'-y', '-v', 'error', '-f', 'lavfi', '-i', `flite=textfile=${textPath}:voice=${participant.voice}`,
		'-af', 'highpass=f=90,lowpass=f=4800,speechnorm=e=6.25:r=0.00001:l=1',
		'-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', utterancePath,
	], { encoding: 'utf8' })
	if (result.status !== 0) throw new Error(`Could not synthesize ${participant.name}: ${result.stderr}`)
	result = spawnSync('ffmpeg', [
		'-y', '-v', 'error', '-f', 'lavfi', '-t', '18', '-i', 'anullsrc=channel_layout=mono:sample_rate=48000', '-i', utterancePath,
		'-filter_complex', `[1:a]adelay=${Math.round(participant.delay * 1_000)}[speech];[0:a][speech]amix=inputs=2:duration=first:normalize=0[out]`,
		'-map', '[out]', '-t', '18', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', outputPath,
	], { encoding: 'utf8' })
	if (result.status !== 0) throw new Error(`Could not schedule ${participant.name}: ${result.stderr}`)
	return outputPath
}

test('captures a historical Google Meet call', async ({ page }) => {
	test.setTimeout(60_000)
	const mediaDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-waveforms-google-showcase-'))
	const audioPaths = new Map(participants.map((participant) => [participant.slug, makeSpeechFixture(mediaDirectory, participant)]))

	for (const participant of participants) {
		await page.route(`https://meet.google.com/__talk-waveforms/${participant.image}`, (route) => route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(participantImageDirectory, participant.image)) }))
		await page.route(`https://meet.google.com/__talk-waveforms/${participant.slug}.wav`, (route) => route.fulfill({ contentType: 'audio/wav', body: fs.readFileSync(audioPaths.get(participant.slug)) }))
	}
	await page.route(fixtureUrl, (route) => route.fulfill({
		status: 200,
		headers: { 'Content-Security-Policy': "default-src 'self' data:; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; style-src 'unsafe-inline'; require-trusted-types-for 'script'; trusted-types google#safe" },
		contentType: 'text/html',
		body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Google Meet · Analytical Engine</title><style>
			:root { color-scheme: dark; font-family: "Google Sans", Roboto, system-ui, sans-serif; background:#202124; color:#f1f3f4; }
			* { box-sizing:border-box; } body { width:100vw; height:100vh; margin:0; overflow:hidden; background:#202124; }
			.top { height:66px; display:flex; align-items:center; gap:14px; padding:0 24px; }
			.meet-mark { display:grid; place-items:center; width:38px; height:38px; border-radius:12px; background:#0b57d0; font-weight:700; font-size:18px; }
			.topic strong { display:block; font-size:18px; font-weight:500; } .topic span { display:block; margin-top:2px; color:#9aa0a6; font-size:13px; }
			.clock { margin-left:auto; color:#bdc1c6; font-size:15px; }
			.grid { height:calc(100vh - 138px); display:grid; grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr; gap:10px; padding:8px 18px 12px; }
			.tile { position:relative; min-width:0; min-height:0; overflow:hidden; border:3px solid transparent; border-radius:12px; background:#3c4043; }
			.tile.active { border-color:#81c995; } .tile img { display:block; width:100%; height:100%; object-fit:cover; }
			.name { position:absolute; left:12px; top:10px; z-index:2; padding:5px 9px; border-radius:6px; background:rgba(32,33,36,.78); font-size:15px; font-weight:500; }
			.tile.active .name::before { content:""; display:inline-block; width:8px; height:8px; margin-right:7px; border-radius:50%; background:#81c995; }
			audio { position:absolute; width:1px; height:1px; opacity:0; }
			.controls { height:72px; display:flex; align-items:center; justify-content:center; gap:12px; border-top:1px solid #303134; }
			.control { display:grid; place-items:center; width:44px; height:44px; border-radius:50%; background:#3c4043; color:#f1f3f4; font-size:17px; }
			.leave { background:#ea4335; width:58px; border-radius:22px; } .people { position:absolute; right:26px; color:#bdc1c6; font-size:14px; }
		</style></head><body>
			<header class="top"><div class="meet-mark">M</div><div class="topic"><strong>Can the Engine compose music?</strong><span>London · 1843</span></div><span class="clock">15:02</span></header>
			<main class="grid" id="meet-showcase"></main>
			<footer class="controls"><span class="control">●</span><span class="control">■</span><span class="control">▣</span><span class="control">⋮</span><span class="control leave">⌁</span><span class="people">People · 4</span></footer>
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
			tile.dataset.participantId = participant.slug
			tile.dataset.participantName = participant.name
			const image = document.createElement('img')
			image.src = `https://meet.google.com/__talk-waveforms/${participant.image}`
			image.alt = ''
			const label = document.createElement('span')
			label.className = 'name'
			label.textContent = participant.name
			const audio = document.createElement('audio')
			audio.autoplay = true
			const response = await fetch(`https://meet.google.com/__talk-waveforms/${participant.slug}.wav`)
			const source = context.createBufferSource()
			const destination = context.createMediaStreamDestination()
			source.buffer = await context.decodeAudioData(await response.arrayBuffer())
			source.connect(destination)
			source.start(context.currentTime + .1)
			audio.srcObject = destination.stream
			tile.append(image, label, audio)
			document.querySelector('#meet-showcase').append(tile)
			fixtures.push({ source, destination })
		}
		window.__GOOGLE_SHOWCASE__ = { context, fixtures }
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
	await expect.poll(() => page.evaluate(() => [...window.__TALK_WAVEFORMS__.sources.values()].every((source) => source.spectrogramFrames >= 140)), { timeout: 20_000 }).toBe(true)
	await page.screenshot({ path: path.resolve(projectRoot, screenshotPath) })
	await page.evaluate(async () => {
		window.__TALK_WAVEFORMS__.destroy()
		for (const fixture of window.__GOOGLE_SHOWCASE__.fixtures) fixture.destination.stream.getTracks().forEach((track) => track.stop())
		await window.__GOOGLE_SHOWCASE__.context.close()
	})
	fs.rmSync(mediaDirectory, { recursive: true, force: true })
})
