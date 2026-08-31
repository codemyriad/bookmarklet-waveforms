(() => {
	'use strict'

	const link = document.querySelector('#bookmarklet')
	const status = document.querySelector('#status')
	let bookmarklet = ''

	fetch(`/bookmarklet-loader.js?_=${Date.now()}`, { cache: 'no-store' })
		.then((response) => {
			if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
			return response.text()
		})
		.then((source) => {
			bookmarklet = source.trim()
			link.setAttribute('href', bookmarklet)
			link.textContent = 'Talk waveforms'
			link.classList.add('ready')
			status.textContent = 'Drag the button to your bookmarks bar, or click it to copy.'
		})
		.catch((error) => {
			link.textContent = 'Bookmarklet unavailable'
			status.textContent = `Could not load the bookmarklet: ${error.message}`
		})

	link.addEventListener('click', async (event) => {
		event.preventDefault()
		if (!bookmarklet) return
		try {
			await navigator.clipboard.writeText(bookmarklet)
			status.textContent = 'Copied. Paste it into a bookmark’s URL field.'
		} catch {
			status.textContent = 'Drag the button to the bookmarks bar; clipboard access was denied.'
		}
	})
})()
