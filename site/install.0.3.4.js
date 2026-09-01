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

	function renderBookmarksShortcut() {
		const platform = navigator.platform || navigator.userAgentData?.platform || ''
		const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
			|| (/Mac/i.test(platform) && navigator.maxTouchPoints > 1)
		const instruction = document.querySelector('#bookmarks-instruction')
		const targets = document.querySelectorAll('[data-bookmarks-shortcut]')

		if (mobile) {
			if (instruction) instruction.textContent = 'Open your browser’s bookmark controls'
			targets.forEach((target) => {
				target.textContent = 'Menu'
				target.setAttribute('aria-label', 'browser menu')
			})
			return
		}

		const isApple = /Mac|iPhone|iPad|iPod/i.test(platform)
		const keys = isApple ? ['⌘', '⇧', 'B'] : ['Ctrl', '⇧', 'B']
		const spoken = isApple ? 'Command Shift B' : 'Control Shift B'
		targets.forEach((target) => {
			target.replaceChildren()
			for (const key of keys) {
				const keycap = document.createElement('kbd')
				keycap.textContent = key
				target.append(keycap)
			}
			target.setAttribute('aria-label', spoken)
		})
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
			heading.setAttribute('tabindex', '-1')
			heading.scrollIntoView({
				behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
				block: 'start',
			})
			heading.focus({ preventScroll: true })
		}

		document.addEventListener('keydown', (event) => {
			if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
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

	renderBookmarksShortcut()
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
