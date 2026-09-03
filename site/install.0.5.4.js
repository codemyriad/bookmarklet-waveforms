(() => {
	'use strict'

	const link = document.querySelector('#bookmarklet')
	const status = document.querySelector('#status')
	const steps = document.querySelector('#install-steps')
	const browserName = document.querySelector('#browser-name')
	const tryStatus = document.querySelector('#try-status')
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

	// Work out which install steps apply here: the bookmarks bar and drag and
	// drop on a desktop browser, or copy, bookmark and edit on a phone.
	function detectBrowser() {
		const agent = navigator.userAgent
		const platform = navigator.platform || navigator.userAgentData?.platform || ''
		const brands = (navigator.userAgentData?.brands || []).map((entry) => entry.brand)
		const apple = /Mac|iPhone|iPad|iPod/i.test(platform)
		const iOS = /iPhone|iPad|iPod/i.test(agent) || (/Mac/i.test(platform) && navigator.maxTouchPoints > 1)
		if (iOS) return { choice: 'ios', apple: true, mobile: true }
		if (/Android/i.test(agent)) return { choice: 'android', apple: false, mobile: true }
		if (/Firefox/i.test(agent)) return { choice: 'firefox', apple, mobile: false }
		const chromium = brands.some((brand) => /Chromium|Chrome|Edge|Brave|Opera/i.test(brand)) || /Chrome|Chromium|Edg\//i.test(agent)
		if (!chromium && apple && /Safari/i.test(agent)) return { choice: 'safari', apple: true, mobile: false }
		return { choice: 'chrome', apple, mobile: false }
	}

	const browser = detectBrowser()

	function shortcutKeys(apple) {
		return apple ? ['⌘', '⇧', 'B'] : ['Ctrl', '⇧', 'B']
	}

	function keycaps(keys, label) {
		const holder = document.createElement('span')
		holder.className = 'inline-shortcut'
		holder.setAttribute('data-bookmarks-shortcut', '')
		holder.setAttribute('aria-label', label)
		for (const key of keys) {
			const keycap = document.createElement('kbd')
			keycap.textContent = key
			holder.append(keycap)
		}
		return holder
	}

	function step(...parts) {
		const item = document.createElement('li')
		for (const part of parts) {
			if (typeof part === 'string') item.append(part)
			else item.append(part)
		}
		return item
	}

	function strong(text) {
		const element = document.createElement('strong')
		element.textContent = text
		return element
	}

	function aside(...parts) {
		const element = document.createElement('span')
		element.className = 'aside'
		element.append(...parts)
		return element
	}

	function copyLink() {
		const element = document.createElement('a')
		element.id = 'copy-bookmarklet'
		element.href = '#copy'
		element.textContent = 'copy it'
		element.addEventListener('click', (event) => {
			event.preventDefault()
			void copyBookmarklet()
		})
		return element
	}

	function renderSteps(choice) {
		const apple = choice === 'safari' || choice === 'ios' || (browser.apple && choice !== 'android')
		const keys = shortcutKeys(apple)
		const spoken = apple ? 'Command Shift B' : 'Control Shift B'
		const bar = choice === 'safari' ? 'favourites bar' : choice === 'firefox' ? 'bookmarks toolbar' : 'bookmarks bar'
		const items = []
		if (choice === 'android') {
			items.push(
				step('Tap ', strong('🌊 Talk'), ' above to copy it.'),
				step('Bookmark this page: open the menu ', strong('⋮'), ' and tap the star.'),
				step('Open your bookmarks and edit the new one: name it ', strong('Talk'), ' and replace its address with what you copied.'),
				step('In a call, type ', strong('Talk'), ' in the address bar and pick the bookmark.'),
			)
		} else if (choice === 'ios') {
			items.push(
				step('Tap ', strong('🌊 Talk'), ' above to copy it.'),
				step('Tap ', strong('Share'), ', then ', strong('Add Bookmark'), ', then ', strong('Save'), '.'),
				step('Open your bookmarks, tap ', strong('Edit'), ', tap the new bookmark and replace its address with what you copied.'),
				step('In a call, open your bookmarks and tap ', strong('Talk'), '.'),
			)
		} else {
			const instruction = document.createElement('span')
			instruction.id = 'bookmarks-instruction'
			instruction.textContent = `Show the ${bar}`
			items.push(
				step(instruction, keycaps(keys, spoken), '.'),
				step('Drag ', strong('🌊 Talk'), ' onto the bar.', aside('Cannot drag it? ', copyLink(), ', add any bookmark, and paste the copied text as its address.')),
			)
		}
		steps.replaceChildren(...items)
		document.querySelectorAll('.shortcut-list [data-bookmarks-shortcut]').forEach((target) => {
			target.replaceChildren()
			for (const key of keys) {
				const keycap = document.createElement('kbd')
				keycap.textContent = key
				target.append(keycap)
			}
			target.setAttribute('aria-label', spoken)
		})
	}

	const browserNames = {
		chrome: 'Chrome, Edge or Brave',
		firefox: 'Firefox',
		safari: 'Safari',
		android: 'Android',
		ios: 'iPhone and iPad',
	}

	function initBrowserSteps() {
		if (!steps) return
		if (browserName) browserName.textContent = browserNames[browser.choice]
		document.documentElement.dataset.browser = browser.choice
		renderSteps(browser.choice)
	}

	// The page notices when the bookmarklet is running on it, so the "try it"
	// step can confirm the install worked without the visitor guessing.
	function watchForBookmarklet() {
		if (!tryStatus) return
		const original = tryStatus.textContent
		let lastState = ''
		window.setInterval(() => {
			const running = Boolean(document.getElementById('nctalk-waveform'))
			const hearing = running && (window.__TALK_WAVEFORMS__?.sources?.size || 0) > 0
			const state = hearing ? 'hearing' : running ? 'running' : 'idle'
			if (state === lastState) return
			lastState = state
			tryStatus.classList.toggle('running', running)
			if (state === 'hearing') {
				tryStatus.replaceChildren(strong('It works.'), ' The graph in the corner is following the clip. You are ready for your next call. Click the bookmark again to close it.')
			} else if (state === 'running') {
				tryStatus.replaceChildren(strong('The bookmark works.'), ' Now press play on the clip and the graph in the bottom-left corner will start moving.')
			} else {
				tryStatus.textContent = original
			}
		}, 500)
	}

	function initKeyboardGuide() {
		const toggle = document.querySelector('#keyboard-help-toggle')
		const dialog = document.querySelector('#keyboard-help-dialog')
		const close = document.querySelector('#keyboard-help-close')
		if (!toggle || !(dialog instanceof HTMLDialogElement) || !close) return

		let returnFocus = null
		const setOpen = (open) => {
			if (open && !dialog.open) {
				returnFocus = document.activeElement
				dialog.showModal()
				toggle.setAttribute('aria-expanded', 'true')
				close.focus()
			} else if (!open && dialog.open) {
				dialog.close()
				toggle.setAttribute('aria-expanded', 'false')
				if (returnFocus instanceof HTMLElement) returnFocus.focus()
				returnFocus = null
			}
		}

		toggle.addEventListener('click', () => setOpen(!dialog.open))
		close.addEventListener('click', () => setOpen(false))
		dialog.addEventListener('cancel', (event) => {
			event.preventDefault()
			setOpen(false)
		})
		dialog.addEventListener('click', (event) => {
			if (event.target !== dialog) return
			const bounds = dialog.getBoundingClientRect()
			const inside = event.clientX >= bounds.left && event.clientX <= bounds.right
				&& event.clientY >= bounds.top && event.clientY <= bounds.bottom
			if (!inside) setOpen(false)
		})

		const focusSection = (id) => {
			const heading = document.querySelector(id)
			if (!(heading instanceof HTMLElement)) return
			heading.tabIndex = -1
			heading.scrollIntoView({ block: 'start' })
			heading.focus({ preventScroll: true })
		}

		document.addEventListener('keydown', (event) => {
			if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
			const target = event.target
			if (target instanceof Element && target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return

			const guideKey = event.key === '?' || event.key === '/'
			if (dialog.open) {
				if (guideKey) {
					event.preventDefault()
					setOpen(false)
				}
				return
			}

			if (guideKey) {
				event.preventDefault()
				setOpen(true)
				return
			}

			switch (event.key.toLowerCase()) {
				case '`':
				case '~':
					event.preventDefault()
					document.querySelector('.brand')?.click()
					break
				case 'i':
					event.preventDefault()
					focusSection('#install-title')
					break
				case 't':
					event.preventDefault()
					focusSection('#try-title')
					break
				case 'd':
					event.preventDefault()
					focusSection('#showcase-title')
					break
				case 'g':
					event.preventDefault()
					document.querySelector('.github-ribbon')?.click()
					break
			}
		})
	}

	initBrowserSteps()
	watchForBookmarklet()
	initKeyboardGuide()

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
			status.textContent = browser.mobile
				? 'Tap to copy it.'
				: 'Drag this to your bookmarks bar, or click it to try it on this page.'
		})
		.catch((error) => {
			link.textContent = 'Bookmarklet unavailable'
			status.textContent = `Could not load the bookmarklet: ${error.message}`
		})

	async function copyBookmarklet() {
		if (!bookmarklet) return
		try {
			if (!copyPlainText(bookmarklet)) await navigator.clipboard.writeText(bookmarklet)
			status.textContent = 'Copied. Paste it as the address of a new bookmark.'
		} catch {
			status.textContent = 'Clipboard access was denied. Drag the button to the bookmarks bar instead.'
		}
	}

	// On a phone a tap copies the bookmarklet, since there is no bar to drag it
	// to. On a desktop the link is left alone: clicking it runs the bookmarklet
	// on this very page, exactly as the bookmark will on a call page.
	if (browser.mobile) {
		link.addEventListener('click', (event) => {
			event.preventDefault()
			void copyBookmarklet()
		})
	}
})()
