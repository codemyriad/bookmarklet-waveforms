const { test, expect } = require('@playwright/test')

const homepageUrl = process.env.HOMEPAGE_URL || 'https://silvio-talk-waveforms.pgs.sh/'
const payloadUrl = 'https://silvio-talk-waveforms.pgs.sh/nctalk-waveform.0.3.0.js'

test('homepage prepares a draggable and copyable bookmarklet', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: homepageUrl })
	await page.goto(homepageUrl, { waitUntil: 'domcontentloaded' })

	await expect(page).toHaveTitle('Talk waveforms')
	const bookmarklet = page.locator('#bookmarklet')
	await expect(bookmarklet).toHaveClass(/ready/)
	await expect(bookmarklet).toHaveAttribute('draggable', 'true')
	const href = await bookmarklet.getAttribute('href')
	expect(href).toMatch(/^javascript:/)
	expect(href).toContain(payloadUrl)

	await bookmarklet.click()
	await expect(page.locator('#status')).toHaveText('Copied. Paste it into a bookmark’s URL field.')
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(href)

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
		expect(await payloadResponse.text()).toContain("const VERSION = '0.3.0'")
	}
})
