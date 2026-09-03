const { test, expect } = require('@playwright/test')

const homepageUrl = process.env.HOMEPAGE_URL || 'https://silvio-talk-waveforms.pgs.sh/'
const payloadUrl = 'https://silvio-talk-waveforms.pgs.sh/talk-waveforms.0.5.4.js'

test('homepage prepares a draggable and copyable bookmarklet', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: homepageUrl })
	const navigationUrl = new URL(homepageUrl)
	navigationUrl.searchParams.set('_', Date.now())
	await page.goto(navigationUrl.href, { waitUntil: 'domcontentloaded' })

	await expect(page).toHaveTitle('Talk waveforms')
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('See the call audio.')
	await expect(page.locator('.lede')).toHaveText('See what the others hear from your microphone, and whose microphone that bark or hum is coming from. Works in Nextcloud Talk, Jitsi Meet, Google Meet, Microsoft Teams and other calls that run in your browser.')
	await expect(page.getByRole('link', { name: 'Code Myriad homepage' })).toHaveAttribute('href', 'https://codemyriad.io/')
	await expect(page.getByRole('link', { name: 'Made by Code Myriad' })).toHaveAttribute('href', 'https://codemyriad.io/')
	await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/assets/favicon.0.3.3.svg')
	await expect(page.getByRole('link', { name: 'Fork Talk waveforms on GitHub' }))
		.toHaveAttribute('href', 'https://github.com/codemyriad/bookmarklet-waveforms')
	await expect(page.getByRole('heading', { name: 'How it looks' })).toBeVisible()
	await expect(page.getByRole('heading', { name: 'In a call' })).toBeVisible()
	await expect(page.getByRole('heading', { name: 'Try it now' })).toBeVisible()
	await expect(page.locator('.platform-list li')).toHaveText([
		'Nextcloud Talk',
		'Jitsi Meet',
		'Google Meet',
		'Microsoft Teams',
	])
	await expect(page.locator('.platform-note')).toHaveText('Best effort: WhatsApp and other browser calls get a floating panel with whatever audio the page makes available.')

	// Desktop Chromium: the bar shortcut and drag-and-drop steps, chosen from the user agent.
	await expect(page.locator('#browser-name')).toHaveText('Chrome, Edge or Brave')
	await expect(page.locator('#install-steps li')).toHaveCount(2)
	await expect(page.locator('#bookmarks-instruction')).toHaveText('Show the bookmarks bar')
	await expect(page.locator('[data-bookmarks-shortcut]').first().locator('kbd')).toHaveText(['Ctrl', '⇧', 'B'])
	await expect(page.locator('#install-steps li').nth(1)).toContainText('Drag 🌊 Talk onto the bar.')

	const demoClip = page.locator('#demo-clip')
	await expect(demoClip.locator('source').first()).toHaveAttribute('src', '/assets/demo-call.0.5.4.mp4')
	await expect(demoClip.locator('source').nth(1)).toHaveAttribute('src', '/assets/demo-call.0.5.4.webm')
	await expect(page.locator('#try-status')).toHaveText('A graph of the sound appears in the bottom-left corner of this page. Click the bookmark again to close it.')

	const keyboardGuide = page.locator('#keyboard-help-dialog')
	const keyboardGuideToggle = page.getByRole('button', { name: 'Show keyboard shortcuts' })
	await expect(keyboardGuide).not.toBeVisible()
	await page.keyboard.press('Shift+/')
	await expect(keyboardGuide).toBeVisible()
	await expect(keyboardGuideToggle).toHaveAttribute('aria-expanded', 'true')
	await page.keyboard.press('Shift+/')
	await expect(keyboardGuide).not.toBeVisible()
	await page.keyboard.press('Shift+/')
	await page.keyboard.press('Escape')
	await expect(keyboardGuide).not.toBeVisible()
	await page.keyboard.press('i')
	await expect(page.locator('#install-title')).toBeFocused()
	await page.keyboard.press('t')
	await expect(page.locator('#try-title')).toBeFocused()
	await page.evaluate(() => {
		window.__keyboardShortcutDestination = null
		document.querySelector('.brand').addEventListener('click', (event) => {
			event.preventDefault()
			window.__keyboardShortcutDestination = event.currentTarget.href
		}, { once: true })
	})
	await page.keyboard.press('Backquote')
	expect(await page.evaluate(() => window.__keyboardShortcutDestination)).toBe('https://codemyriad.io/')

	const showcases = page.locator('.showcase img')
	await expect(showcases).toHaveCount(4)
	await expect(page.locator('.showcase-platform')).toHaveText(['Jitsi Meet', 'Google Meet', 'Microsoft Teams', 'Nextcloud Talk'])
	const jitsiShowcase = showcases.first()
	await expect(jitsiShowcase).toHaveAttribute('src', '/assets/jitsi-waveforms-showcase.0.4.0.png')
	await jitsiShowcase.scrollIntoViewIfNeeded()
	await expect(jitsiShowcase).toHaveJSProperty('complete', true)
	await expect(jitsiShowcase).toHaveJSProperty('naturalWidth', 2560)
	await expect(jitsiShowcase).toHaveJSProperty('naturalHeight', 1600)
	const googleShowcase = showcases.nth(1)
	await expect(googleShowcase).toHaveAttribute('src', '/assets/google-meet-waveforms-showcase.0.5.1.png')
	await googleShowcase.scrollIntoViewIfNeeded()
	await expect(googleShowcase).toHaveJSProperty('complete', true)
	await expect(googleShowcase).toHaveJSProperty('naturalWidth', 2560)
	await expect(googleShowcase).toHaveJSProperty('naturalHeight', 1600)
	const teamsShowcase = showcases.nth(2)
	await expect(teamsShowcase).toHaveAttribute('src', '/assets/teams-waveforms-showcase.0.5.0.png')
	await teamsShowcase.scrollIntoViewIfNeeded()
	await expect(teamsShowcase).toHaveJSProperty('complete', true)
	await expect(teamsShowcase).toHaveJSProperty('naturalWidth', 2560)
	await expect(teamsShowcase).toHaveJSProperty('naturalHeight', 1600)
	const nextcloudShowcase = showcases.nth(3)
	await expect(nextcloudShowcase).toHaveAttribute('src', '/assets/talk-waveforms-showcase.0.5.3.png')
	await nextcloudShowcase.scrollIntoViewIfNeeded()
	await expect(nextcloudShowcase).toHaveJSProperty('complete', true)
	await expect(nextcloudShowcase).toHaveJSProperty('naturalWidth', 2560)
	await expect(nextcloudShowcase).toHaveJSProperty('naturalHeight', 1600)
	await expect(page.locator('.showcase figcaption')).toHaveText([
		'Four participants · three views',
		'The Analytical Engine · four microphones',
		'Calendar reform · four microphones',
		'One graph per microphone',
	])
	const bookmarklet = page.locator('#bookmarklet')
	await expect(bookmarklet).toHaveClass(/ready/)
	await expect(bookmarklet).toHaveAttribute('draggable', 'true')
	await expect(bookmarklet).toHaveText('🌊 Talk')
	const href = await bookmarklet.getAttribute('href')
	expect(href).toMatch(/^javascript:/)
	expect(href.length).toBeGreaterThan(25_000)
	expect(href.length).toBeLessThan(35_000)
	expect(href).toContain('"use strict"')
	expect(href).not.toContain('%22use%20strict%22')
	expect(decodeURIComponent(href)).toContain('0.5.4')

	await expect(page.locator('#status')).toHaveText('Drag this to your bookmarks bar, or click it to try it on this page.')
	await page.locator('#copy-bookmarklet').click()
	await expect(page.locator('#status')).toHaveText('Copied. Paste it as the address of a new bookmark.')
	const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
	expect(clipboardText).toBe(href)
	expect(clipboardText.startsWith('javascript:')).toBe(true)

	// Clicking the button runs the bookmarklet on the homepage itself.
	await bookmarklet.click()
	await expect(page.locator('#nctalk-waveform')).toBeVisible()
	expect(await page.locator('#nctalk-waveform').evaluate((host) => ({
		platform: window.__TALK_WAVEFORMS__.platform,
		message: host.shadowRoot.querySelector('.empty').textContent,
	}))).toEqual({ platform: 'generic', message: 'No audio streams found on this page.' })
	await expect(page.locator('#try-status')).toHaveText('The bookmark works. Now press play on the clip and the graph in the bottom-left corner will start moving.')
	await expect(page.locator('#try-status')).toHaveClass(/running/)

	// Playing the test clip turns it into an audio source of the bookmarklet.
	await demoClip.evaluate((video) => video.play())
	await expect.poll(() => page.evaluate(() => window.__TALK_WAVEFORMS__.sources.size), { timeout: 10_000 }).toBe(1)
	await expect(page.locator('#try-status')).toHaveText('It works. The graph in the corner is following the clip. You are ready for your next call. Click the bookmark again to close it.')
	expect(await page.evaluate(() => {
		const source = [...window.__TALK_WAVEFORMS__.sources.values()][0]
		return { origin: source.origin, placement: source.viewHost.dataset.placement }
	})).toEqual({ origin: 'dom', placement: 'fallback' })

	// When the clip ends Chrome ends the captured track; replaying must capture again.
	const firstKey = await page.evaluate(() => {
		const [source] = window.__TALK_WAVEFORMS__.sources.values()
		source.stream.getAudioTracks().forEach((track) => track.stop())
		return source.key
	})
	await expect.poll(() => page.evaluate(() => [...window.__TALK_WAVEFORMS__.sources.keys()]), { timeout: 10_000 }).not.toContain(firstKey)
	await expect.poll(() => page.evaluate(() => window.__TALK_WAVEFORMS__.sources.size), { timeout: 10_000 }).toBe(1)
	await expect.poll(() => page.evaluate(() => [...window.__TALK_WAVEFORMS__.sources.values()][0].lastLevel), { timeout: 10_000 }).toBeGreaterThan(0.02)
	await expect(page.locator('#try-status')).toHaveText('It works. The graph in the corner is following the clip. You are ready for your next call. Click the bookmark again to close it.')

	// A second click on the button closes it, as the page promises.
	await bookmarklet.click()
	await expect(page.locator('#nctalk-waveform')).toHaveCount(0)
	await expect(page.locator('#try-status')).not.toHaveClass(/running/)
	await expect(page.locator('#try-status')).toHaveText('A graph of the sound appears in the bottom-left corner of this page. Click the bookmark again to close it.')

	if (process.env.LOCAL_HOMEPAGE !== '1') {
		const payloadResponse = await page.request.get(payloadUrl)
		expect(payloadResponse.status()).toBe(200)
		expect(await payloadResponse.text()).toContain("const VERSION = '0.5.4'")
	}
})

test('shows the macOS bookmarks-bar shortcut on Apple desktops', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' })
		Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 0 })
	})
	const navigationUrl = new URL(homepageUrl)
	navigationUrl.searchParams.set('_', Date.now())
	await page.goto(navigationUrl.href, { waitUntil: 'domcontentloaded' })
	await expect(page.locator('#browser-name')).toHaveText('Chrome, Edge or Brave')
	await expect(page.locator('[data-bookmarks-shortcut]').first().locator('kbd')).toHaveText(['⌘', '⇧', 'B'])
})

test('tells iPhone visitors it is desktop-only and lets them try it', async ({ browser }) => {
	const context = await browser.newContext({
		userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
	})
	const page = await context.newPage()
	const navigationUrl = new URL(homepageUrl)
	navigationUrl.searchParams.set('_', Date.now())
	await page.goto(navigationUrl.href, { waitUntil: 'domcontentloaded' })
	await expect(page.locator('#mobile-notice')).toBeVisible()
	await expect(page.locator('#mobile-notice')).toHaveText('You can try it right here on your phone: press play on the clip below and tap 🌊 Talk. But it is meant to run on any page, on top of a video call. For that you need a desktop browser.')
	await expect(page.locator('.what')).toBeHidden()
	await expect(page.locator('#install-steps')).toBeHidden()
	await expect(page.locator('.browser-pick')).toBeHidden()
	await expect(page.locator('#copy-bookmarklet')).toHaveCount(0)
	await expect(page.locator('#status')).toHaveText('Tap to try it on this page.')
	await expect(page.locator('#install-title')).toContainText('Desktop only')
	await expect(page.locator('#mobile-notice strong').first()).toHaveText('🌊 Talk')
	await expect(page.locator('.shortcut-list [data-bookmarks-shortcut] kbd')).toHaveText(['⌘', '⇧', 'B'])

	// Tapping the button runs it; playing the clip feeds it; tapping again closes it.
	await page.locator('#bookmarklet.ready').tap()
	await expect(page.locator('#nctalk-waveform')).toBeVisible()
	await expect(page.locator('#try-status')).toHaveClass(/running/)
	await page.locator('#demo-clip').evaluate((video) => video.play())
	await expect.poll(() => page.evaluate(() => window.__TALK_WAVEFORMS__.sources.size), { timeout: 10_000 }).toBe(1)
	await expect(page.locator('#try-status')).toHaveText('It works. The graph in the corner is following the clip. You are ready for your next call. Click the bookmark again to close it.', { timeout: 10_000 })
	await page.locator('#bookmarklet').tap()
	await expect(page.locator('#nctalk-waveform')).toHaveCount(0)
	await context.close()
})

const agentCases = [
	{ name: 'Firefox', agent: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', label: 'Firefox', instruction: 'Show the bookmarks toolbar', keys: ['Ctrl', '⇧', 'B'], steps: 2 },
	{ name: 'Safari', agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', platform: 'MacIntel', label: 'Safari', instruction: 'Show the favourites bar', keys: ['⌘', '⇧', 'B'], steps: 2 },
	{ name: 'Android', agent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36', mobile: true },
]

for (const agentCase of agentCases) {
	test(`picks the ${agentCase.name} steps from the user agent`, async ({ browser }) => {
		const context = await browser.newContext({ userAgent: agentCase.agent })
		const page = await context.newPage()
		await page.addInitScript((platform) => {
			Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => undefined })
			if (platform) Object.defineProperty(navigator, 'platform', { configurable: true, get: () => platform })
		}, agentCase.platform || '')
		const navigationUrl = new URL(homepageUrl)
		navigationUrl.searchParams.set('_', Date.now())
		await page.goto(navigationUrl.href, { waitUntil: 'domcontentloaded' })
		if (agentCase.mobile) {
			await expect(page.locator('#mobile-notice')).toBeVisible()
			await expect(page.locator('#install-steps')).toBeHidden()
			await expect(page.locator('#install-steps li')).toHaveCount(0)
			await expect(page.locator('.shortcut-list [data-bookmarks-shortcut] kbd')).toHaveText(['Ctrl', '⇧', 'B'])
			await page.locator('#bookmarklet.ready').click()
			await expect(page.locator('#nctalk-waveform')).toBeVisible()
		} else {
			await expect(page.locator('#mobile-notice')).toBeHidden()
			await expect(page.locator('#browser-name')).toHaveText(agentCase.label)
			await expect(page.locator('#install-steps li')).toHaveCount(agentCase.steps)
			await expect(page.locator('#bookmarks-instruction')).toHaveText(agentCase.instruction)
			await expect(page.locator('[data-bookmarks-shortcut]').first().locator('kbd')).toHaveText(agentCase.keys)
		}
		await context.close()
	})
}

const translations = require('../site/translations.0.5.4.js').TALK_WAVEFORMS_TRANSLATIONS

test('every language defines the same strings as English', () => {
	const englishKeys = Object.keys(translations.en).sort()
	for (const [language, strings] of Object.entries(translations)) {
		expect(Object.keys(strings).sort(), language).toEqual(englishKeys)
		expect(strings.lang).toBe(language)
		for (const [key, value] of Object.entries(strings)) {
			expect(value, `${language}.${key}`).not.toBe('')
			expect(value.replace(/<\/?strong>/g, ''), `${language}.${key}`).not.toMatch(/<[a-z]/)
		}
	}
})

const languageCases = [
	{ locale: 'it-IT', lang: 'it' },
	{ locale: 'de-DE', lang: 'de' },
	{ locale: 'es-ES', lang: 'es' },
	{ locale: 'fr-FR', lang: 'fr' },
	{ locale: 'pt-BR', lang: 'pt' },
	{ locale: 'nl-NL', lang: 'en' },
]

for (const languageCase of languageCases) {
	test(`speaks ${languageCase.lang} to a ${languageCase.locale} browser`, async ({ browser }) => {
		const context = await browser.newContext({ locale: languageCase.locale })
		const page = await context.newPage()
		const navigationUrl = new URL(homepageUrl)
		navigationUrl.searchParams.set('_', Date.now())
		await page.goto(navigationUrl.href, { waitUntil: 'domcontentloaded' })
		const strings = translations[languageCase.lang]
		await expect(page.locator('html')).toHaveAttribute('lang', languageCase.lang)
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(strings.title)
		await expect(page.locator('.lede')).toHaveText(strings.lede)
		await expect(page.locator('#browser-name')).toHaveText(strings.browserChrome)
		await expect(page.locator('#bookmarks-instruction')).toHaveText(strings.showBar.replace('{bar}', strings.barChrome))
		await expect(page.locator('#copy-bookmarklet')).toHaveText(strings.copyIt)
		await expect(page.locator('#try-status')).toHaveText(strings.tryIdle)
		await expect(page.locator('.platform-note strong')).toHaveText(strings.callNote.match(/<strong>(.*?)<\/strong>/)[1])
		await expect(page.locator('.showcase figcaption').first()).toHaveText(strings.jitsiCaption)
		await expect(page.locator('.showcase img').first()).toHaveAttribute('alt', strings.jitsiAlt)
		await expect(page.locator('#status')).toHaveText(strings.statusDesktop)
		await expect(page.locator('.site-footer a').first()).toHaveText(strings.madeBy)
		await expect(page.locator('#mobile-notice')).toBeHidden()
		await context.close()

		const phone = await browser.newContext({ locale: languageCase.locale, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36', isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } })
		const phonePage = await phone.newPage()
		await phonePage.goto(navigationUrl.href, { waitUntil: 'domcontentloaded' })
		await expect(phonePage.locator('#mobile-notice')).toHaveText(strings.mobileNotice.replace(/<\/?strong>/g, ''))
		await expect(phonePage.locator('#mobile-notice strong').first()).toHaveText('🌊 Talk')
		await expect(phonePage.locator('#install-title')).toContainText(strings.installMobile)
		await expect(phonePage.locator('#status')).toHaveText(strings.statusMobile)
		await phone.close()
	})
}

test('honours ?lang= over the browser language', async ({ page }) => {
	const navigationUrl = new URL(homepageUrl)
	navigationUrl.searchParams.set('lang', 'it')
	await page.goto(navigationUrl.href, { waitUntil: 'domcontentloaded' })
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(translations.it.title)
})
