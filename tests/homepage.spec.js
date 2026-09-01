const { test, expect } = require('@playwright/test')

const homepageUrl = process.env.HOMEPAGE_URL || 'https://silvio-talk-waveforms.pgs.sh/'
const payloadUrl = 'https://silvio-talk-waveforms.pgs.sh/nctalk-waveform.0.3.3.js'

test('homepage prepares a draggable and copyable bookmarklet', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: homepageUrl })
	const navigationUrl = new URL(homepageUrl)
	navigationUrl.searchParams.set('_', Date.now())
	await page.goto(navigationUrl.href, { waitUntil: 'domcontentloaded' })

	await expect(page).toHaveTitle('Talk waveforms')
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('See the call audio.')
	await expect(page.locator('.lede')).toHaveText('See what others hear from your mic—and whose mic that bark, buzz, or background noise came from.')
	await expect(page.getByRole('link', { name: 'Code Myriad homepage' })).toHaveAttribute('href', 'https://codemyriad.io/')
	await expect(page.getByRole('link', { name: 'Made by Code Myriad' })).toHaveAttribute('href', 'https://codemyriad.io/')
	await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/assets/favicon.0.3.3.svg')
	await expect(page.getByRole('link', { name: 'Fork Talk waveforms on GitHub' }))
		.toHaveAttribute('href', 'https://github.com/codemyriad/bookmarklet-waveforms')
	await expect(page.getByRole('heading', { name: 'How it looks like' })).toBeVisible()
	const showcase = page.locator('.showcase img')
	await expect(showcase).toHaveAttribute('src', '/assets/talk-waveforms-showcase.0.3.3.png')
	await expect(showcase).toHaveJSProperty('complete', true)
	await expect(showcase).toHaveJSProperty('naturalWidth', 1280)
	await expect(showcase).toHaveJSProperty('naturalHeight', 800)
	const bookmarklet = page.locator('#bookmarklet')
	await expect(bookmarklet).toHaveClass(/ready/)
	await expect(bookmarklet).toHaveAttribute('draggable', 'true')
	await expect(bookmarklet).toHaveText('🌊 Talk')
	const href = await bookmarklet.getAttribute('href')
	expect(href).toMatch(/^javascript:/)
	expect(href).toContain(payloadUrl)

	await bookmarklet.click()
	await expect(page.locator('#status')).toHaveText('Copied the complete javascript: bookmarklet. Paste it into a bookmark’s URL field.')
	const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
	expect(clipboardText).toBe(href)
	expect(clipboardText.startsWith('javascript:')).toBe(true)

	const wrongPageMessage = new Promise((resolve) => {
		page.once('dialog', async (dialog) => {
			resolve(dialog.message())
			await dialog.dismiss()
		})
	})
	await page.evaluate(href.replace(/^javascript:/, ''))
	expect(await wrongPageMessage).toBe('This is not Nextcloud Talk. Retry there!')

	if (process.env.LOCAL_HOMEPAGE !== '1') {
		const payloadResponse = await page.request.get(payloadUrl)
		expect(payloadResponse.status()).toBe(200)
		expect(await payloadResponse.text()).toContain("const VERSION = '0.3.3'")
	}
})
