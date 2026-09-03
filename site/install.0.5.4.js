(() => {
	'use strict'

	const link = document.querySelector('#bookmarklet')
	const status = document.querySelector('#status')
	const steps = document.querySelector('#install-steps')
	const browserName = document.querySelector('#browser-name')
	const browserPick = document.querySelector('.browser-pick')
	const mobileNotice = document.querySelector('#mobile-notice')
	const tryStatus = document.querySelector('#try-status')
	let bookmarklet = ''

	// The page speaks the browser's primary language when it is one of the
	// translations; English otherwise. `?lang=xx` overrides it for testing.
	const translations = window.TALK_WAVEFORMS_TRANSLATIONS || {}
	function pickLanguage() {
		const requested = new URLSearchParams(location.search).get('lang')
		const candidates = requested ? [requested] : [navigator.language, ...(navigator.languages || [])]
		for (const candidate of candidates) {
			const base = String(candidate || '').toLowerCase().split(/[-_]/)[0]
			if (translations[base]) return base
		}
		return 'en'
	}
	const language = pickLanguage()
	const strings = translations[language] || translations.en || {}
	function t(key, values = {}) {
		const template = strings[key] ?? translations.en?.[key] ?? key
		return template.replace(/\{(\w+)\}/g, (match, name) => (name in values ? values[name] : match))
	}

	function applyTranslations() {
		document.documentElement.lang = language
		for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n)
		for (const element of document.querySelectorAll('[data-i18n-html]')) element.innerHTML = t(element.dataset.i18nHtml)
		for (const element of document.querySelectorAll('[data-i18n-alt]')) element.alt = t(element.dataset.i18nAlt)
		for (const element of document.querySelectorAll('[data-i18n-aria-label]')) element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel))
	}

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
		if (/Android/i.test(agent) || navigator.userAgentData?.mobile === true) return { choice: 'android', apple: false, mobile: true }
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
		item.append(...parts)
		return item
	}

	function fragment(html) {
		const template = document.createElement('template')
		template.innerHTML = html
		return template.content
	}

	function dragAside() {
		const element = document.createElement('span')
		element.className = 'aside'
		const [before, after] = t('dragAside').split('{copy}')
		const copy = document.createElement('a')
		copy.id = 'copy-bookmarklet'
		copy.href = '#copy'
		copy.textContent = t('copyIt')
		copy.addEventListener('click', (event) => {
			event.preventDefault()
			void copyBookmarklet()
		})
		element.append(before || '', copy, after || '')
		return element
	}

	function renderGuideShortcut(keys, spoken) {
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

	function renderSteps(choice) {
		const apple = choice === 'safari' || browser.apple
		const keys = shortcutKeys(apple)
		const spoken = apple ? 'Command Shift B' : 'Control Shift B'
		const bar = choice === 'safari' ? t('barSafari') : choice === 'firefox' ? t('barFirefox') : t('barChrome')
		const instruction = document.createElement('span')
		instruction.id = 'bookmarks-instruction'
		instruction.textContent = t('showBar', { bar })
		const dragItem = document.createElement('li')
		dragItem.append(fragment(t('dragStep')), dragAside())
		const items = [step(instruction, keycaps(keys, spoken), '.'), dragItem]
		steps.replaceChildren(...items)
		renderGuideShortcut(keys, spoken)
	}

	const browserNames = {
		chrome: 'browserChrome',
		firefox: 'browserFirefox',
		safari: 'browserSafari',
	}

	// Phones get no install steps: the bookmarklet only makes sense on a
	// desktop browser with a bookmarks bar. They get a notice and can still
	// tap the button to see it run on this page.
	function initBrowserSteps() {
		if (!steps) return
		document.documentElement.dataset.browser = browser.choice
		if (browser.mobile) {
			if (mobileNotice) mobileNotice.hidden = false
			if (browserPick) browserPick.hidden = true
			document.querySelector('.what')?.setAttribute('hidden', '')
			steps.hidden = true
			steps.replaceChildren()
			const installTitle = document.querySelector('#install-title [data-i18n="install"]')
			if (installTitle) installTitle.textContent = t('installMobile')
			renderGuideShortcut(shortcutKeys(browser.apple), browser.apple ? 'Command Shift B' : 'Control Shift B')
			return
		}
		if (browserName) browserName.textContent = t(browserNames[browser.choice])
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
			const sources = running ? [...(window.__TALK_WAVEFORMS__?.sources?.values?.() || [])] : []
			const hearing = sources.some((source) => source.lastLevel > 0.02)
			// Once audio has been seen, keep saying so while the bookmarklet runs:
			// silences in the clip are not a reason to take the confirmation back.
			const state = hearing || (running && lastState === 'hearing') ? 'hearing' : running ? 'running' : 'idle'
			if (state === lastState) return
			lastState = state
			tryStatus.classList.toggle('running', running)
			if (state === 'hearing') tryStatus.innerHTML = t('tryHearing')
			else if (state === 'running') tryStatus.innerHTML = t('tryRunning')
			else tryStatus.textContent = original
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

	applyTranslations()
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
			status.textContent = t(browser.mobile ? 'statusMobile' : 'statusDesktop')
		})
		.catch((error) => {
			link.textContent = t('statusUnavailable')
			status.textContent = t('statusLoadError', { error: error.message })
		})

	async function copyBookmarklet() {
		if (!bookmarklet) return
		try {
			if (!copyPlainText(bookmarklet)) await navigator.clipboard.writeText(bookmarklet)
			status.textContent = t('statusCopied')
		} catch {
			status.textContent = t('statusDenied')
		}
	}

	// The link is left alone on purpose: clicking or tapping it runs the
	// bookmarklet on this very page, exactly as the bookmark will on a call page.
})()
