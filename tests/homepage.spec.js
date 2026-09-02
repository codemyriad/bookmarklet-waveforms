const { test, expect } = require('@playwright/test')

const homepageUrl = process.env.HOMEPAGE_URL || 'https://silvio-talk-waveforms.pgs.sh/'
const payloadUrl = 'https://silvio-talk-waveforms.pgs.sh/talk-waveforms.0.5.0.js'

test('homepage prepares a draggable and copyable bookmarklet', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: homepageUrl })
	const navigationUrl = new URL(homepageUrl)
	navigationUrl.searchParams.set('_', Date.now())
	await page.goto(navigationUrl.href, { waitUntil: 'domcontentloaded' })

	await expect(page).toHaveTitle('Talk waveforms')
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('See the call audio.')
	await expect(page.locator('.lede')).toHaveText('See what others hear from your mic—and whose mic that bark, buzz, or background noise came from—in Nextcloud Talk, Jitsi Meet, Google Meet, or Microsoft Teams.')
	await expect(page.getByRole('link', { name: 'Code Myriad homepage' })).toHaveAttribute('href', 'https://codemyriad.io/')
	await expect(page.getByRole('link', { name: 'Made by Code Myriad' })).toHaveAttribute('href', 'https://codemyriad.io/')
	await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/assets/favicon.0.3.3.svg')
	await expect(page.getByRole('link', { name: 'Fork Talk waveforms on GitHub' }))
		.toHaveAttribute('href', 'https://github.com/codemyriad/bookmarklet-waveforms')
	await expect(page.getByRole('heading', { name: 'How it looks like' })).toBeVisible()
	await expect(page.locator('.instructions li').nth(2)).toHaveText('Click the bookmark.')
	await expect(page.locator('[data-bookmarks-shortcut]').first().locator('kbd')).toHaveText(['Ctrl', '⇧', 'B'])

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
	await expect(showcases).toHaveCount(3)
	const jitsiShowcase = showcases.first()
	await expect(jitsiShowcase).toHaveAttribute('src', '/assets/jitsi-waveforms-showcase.0.4.0.png')
	await expect(jitsiShowcase).toHaveJSProperty('complete', true)
	await expect(jitsiShowcase).toHaveJSProperty('naturalWidth', 2560)
	await expect(jitsiShowcase).toHaveJSProperty('naturalHeight', 1600)
	const teamsShowcase = showcases.nth(1)
	await expect(teamsShowcase).toHaveAttribute('src', '/assets/teams-waveforms-showcase.0.5.0.png')
	await expect(teamsShowcase).toHaveJSProperty('complete', true)
	await expect(teamsShowcase).toHaveJSProperty('naturalWidth', 2560)
	await expect(teamsShowcase).toHaveJSProperty('naturalHeight', 1600)
	await expect(page.locator('.showcase figcaption')).toHaveText([
		'Jitsi MeetFour participants · three views',
		'Microsoft TeamsCalendar reform · four microphones',
		'Nextcloud TalkOne graph per microphone',
	])
	const bookmarklet = page.locator('#bookmarklet')
	await expect(bookmarklet).toHaveClass(/ready/)
	await expect(bookmarklet).toHaveAttribute('draggable', 'true')
	await expect(bookmarklet).toHaveText('🌊 Talk')
	const href = await bookmarklet.getAttribute('href')
	expect(href).toMatch(/^javascript:/)
	expect(href.length).toBeGreaterThan(20_000)
	expect(href).toContain('0.5.0')

	await bookmarklet.click()
	await expect(page.locator('#status')).toHaveText('Copied the complete javascript: bookmarklet. Paste it into a bookmark’s URL field.')
	const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
	expect(clipboardText).toBe(href)
	expect(clipboardText.startsWith('javascript:')).toBe(true)

	await page.evaluate(href.replace(/^javascript:/, ''))
	await expect(page.locator('#nctalk-waveform')).toBeVisible()
	expect(await page.locator('#nctalk-waveform').evaluate((host) => ({
		platform: window.__TALK_WAVEFORMS__.platform,
		message: host.shadowRoot.querySelector('.empty').textContent,
	}))).toEqual({ platform: 'generic', message: 'No audio streams found on this page.' })

	if (process.env.LOCAL_HOMEPAGE !== '1') {
		const payloadResponse = await page.request.get(payloadUrl)
		expect(payloadResponse.status()).toBe(200)
		expect(await payloadResponse.text()).toContain("const VERSION = '0.5.0'")
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
	await expect(page.locator('[data-bookmarks-shortcut]').first().locator('kbd')).toHaveText(['⌘', '⇧', 'B'])
})
