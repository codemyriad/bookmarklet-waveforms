(() => {
	'use strict'

	const link = document.querySelector('#bookmarklet')
	const status = document.querySelector('#status')
	let bookmarklet = ''

	function copyPlainText(value) {
		const textarea = document.createElement('textarea')
		textarea.value = value
		textarea.setAttribute('readonly', '')
		textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
		document.body.append(textarea)
		textarea.select()
		textarea.setSelectionRange(0, value.length)
		const copied = document.execCommand('copy')
		textarea.remove()
		return copied
	}

	fetch(`/bookmarklet-loader.js?_=${Date.now()}`, { cache: 'no-store' })
		.then((response) => {
			if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
			return response.text()
		})
		.then((source) => {
			bookmarklet = source.trim()
			link.setAttribute('href', bookmarklet)
			link.textContent = '🌊 Talk'
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
			if (!copyPlainText(bookmarklet)) await navigator.clipboard.writeText(bookmarklet)
			status.textContent = 'Copied the complete javascript: bookmarklet. Paste it into a bookmark’s URL field.'
		} catch {
			status.textContent = 'Drag the button to the bookmarks bar; clipboard access was denied.'
		}
	})
})()
