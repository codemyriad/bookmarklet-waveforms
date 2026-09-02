const { test, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const fixtureUrl = 'https://teams.live.com/light-meetings/launch?fixture=talk-waveforms'
const liveUrl = process.env.MICROSOFT_TEAMS_URL
const bookmarklet = decodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'bookmarklet-loader.js'), 'utf8').trim().replace(/^javascript:/, ''))

test('maps Microsoft Teams media streams without requiring a Trusted Types policy', async ({ page }) => {
	await page.route(fixtureUrl, (route) => route.fulfill({
		status: 200,
		headers: {
			'Content-Security-Policy': "base-uri 'none'; default-src 'none'; script-src 'nonce-teams-test' 'self'; style-src 'self'; require-trusted-types-for 'script'; trusted-types dompurify @msteams/light-meetings",
		},
		contentType: 'text/html',
		body: '<!doctype html><html><head><meta charset="utf-8"><title>Teams fixture</title></head><body><main id="teams-fixture"></main></body></html>',
	}))
	await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' })

	await page.evaluate(() => {
		const context = new AudioContext()
		const fixtures = []
		for (const [index, name] of ['Cleopatra VII', 'Julius Caesar', 'Sosigenes'].entries()) {
			const oscillator = context.createOscillator()
			const gain = context.createGain()
			const destination = context.createMediaStreamDestination()
			oscillator.frequency.value = 170 + index * 110
			gain.gain.value = .1
			oscillator.connect(gain).connect(destination)
			oscillator.start()

			const card = document.createElement('section')
			card.dataset.tid = index === 2 ? 'local-video-tile' : `participant-tile-${index}`
			card.dataset.cid = `teams-participant-${index}`
			card.setAttribute('role', 'listitem')
			card.style.cssText = 'position:relative;width:480px;height:180px;margin:8px;overflow:hidden'
			const label = document.createElement('span')
			label.dataset.tid = 'participant-display-name'
			label.textContent = name
			const video = document.createElement('video')
			video.autoplay = true
			video.muted = index === 2
			video.srcObject = destination.stream
			card.append(video, label)
			document.querySelector('#teams-fixture').append(card)
			fixtures.push({ oscillator, stream: destination.stream })
		}
		window.__TEAMS_FIXTURES__ = { context, fixtures }
	})

	await page.evaluate(bookmarklet)
	await expect(page.locator('#nctalk-waveform')).toBeAttached()
	await expect.poll(() => page.evaluate(() => window.__TALK_WAVEFORMS__?.sources?.size)).toBe(3)

	const state = await page.evaluate(() => ({
		version: window.__TALK_WAVEFORMS__.version,
		platform: window.__TALK_WAVEFORMS__.platform,
		sources: [...window.__TALK_WAVEFORMS__.sources.values()].map((source) => ({
			label: source.label,
			direction: source.direction,
			mode: source.mode,
			placement: source.viewHost.dataset.placement,
			cardId: source.card?.dataset.cid,
		})),
	}))
	expect(state.version).toBe('0.5.3')
	expect(state.platform).toBe('microsoft-teams')
	expect(state.sources.map(({ label }) => label).sort()).toEqual(['Cleopatra VII', 'Julius Caesar', 'You'])
	expect(state.sources.filter(({ direction }) => direction === 'local')).toHaveLength(1)
	for (const source of state.sources) {
		expect(source).toMatchObject({ mode: 'spectrogram', placement: 'card' })
		expect(source.cardId).toMatch(/^teams-participant-/)
	}
	await expect(page.locator('[data-cid] > .nctalk-waveform-source')).toHaveCount(3)
	await expect(page.locator('#nctalk-waveform')).toBeHidden()

	await page.evaluate(async () => {
		window.__TALK_WAVEFORMS__.destroy()
		for (const fixture of window.__TEAMS_FIXTURES__.fixtures) {
			fixture.oscillator.stop()
			fixture.stream.getTracks().forEach((track) => track.stop())
		}
		await window.__TEAMS_FIXTURES__.context.close()
	})
})

test('loads on the supplied Microsoft Teams page', async ({ page }) => {
	test.skip(!liveUrl, 'Set MICROSOFT_TEAMS_URL to check the current Teams page')
	const dialogs = []
	page.on('dialog', async (dialog) => {
		dialogs.push(dialog.message())
		await dialog.dismiss()
	})
	await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
	await page.waitForURL(/teams\.live\.com\/light-meetings\/launch/, { timeout: 60_000 })
	await page.locator('[data-tid="calling-prejoin-screen"]').waitFor({ timeout: 60_000 })
	await page.evaluate(bookmarklet)
	await expect.poll(() => page.evaluate(() => ({
		version: window.__TALK_WAVEFORMS__?.version,
		platform: window.__TALK_WAVEFORMS__?.platform,
		message: window.__TALK_WAVEFORMS__?.host?.shadowRoot?.querySelector('.empty')?.textContent,
	})), { timeout: 15_000 }).toEqual({
		version: '0.5.3',
		platform: 'microsoft-teams',
		message: 'No call audio found yet.',
	})
	expect(dialogs).toEqual([])
})
