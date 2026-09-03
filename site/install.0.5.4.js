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

	// The screenshots: a scroll-snap strip (swipe on phones) with buttons, dots,
	// arrow keys anywhere on the page, and a slow slideshow that stops as soon
	// as the visitor takes over. Reduced-motion users get no slideshow at all.
	const SLIDESHOW_INTERVAL = 6000
	function initCarousel() {
		const track = document.querySelector('#carousel-track')
		const status = document.querySelector('#carousel-status')
		const dots = document.querySelector('#carousel-dots')
		const previous = document.querySelector('#carousel-previous')
		const next = document.querySelector('#carousel-next')
		const playButton = document.querySelector('#carousel-play')
		if (!track || !dots || !previous || !next || !playButton) return
		const slides = [...track.querySelectorAll('.slide')]
		const total = slides.length
		const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
		let current = 0
		let timer = 0
		let slideshow = !reducedMotion.matches
		let hovering = false
		let focused = false

		const dotButtons = slides.map((slide, index) => {
			const item = document.createElement('li')
			const button = document.createElement('button')
			button.type = 'button'
			button.setAttribute('aria-label', t('carouselGoTo', { index: index + 1, platform: slide.dataset.platform }))
			button.addEventListener('click', () => takeOver(index))
			item.append(button)
			dots.append(item)
			return button
		})
		slides.forEach((slide, index) => {
			slide.setAttribute('aria-label', t('carouselSlide', { index: index + 1, total, platform: slide.dataset.platform }))
		})

		function offsetFor(index) {
			const slide = slides[index]
			return slide.offsetLeft - (track.clientWidth - slide.clientWidth) / 2
		}

		// Our own short tween instead of native smooth scrolling: a native smooth
		// scroll cannot be reliably replaced while it is still in flight.
		let tween = 0
		function stopTween() {
			cancelAnimationFrame(tween)
			tween = 0
			track.classList.remove('is-tweening')
		}
		function goTo(index, behavior) {
			const target = ((index % total) + total) % total
			const from = track.scrollLeft
			const to = offsetFor(target)
			stopTween()
			if (behavior === 'instant' || reducedMotion.matches || Math.abs(to - from) < 1) {
				track.scrollTo({ left: to, behavior: 'instant' })
			} else {
				const start = performance.now()
				const duration = 380
				track.classList.add('is-tweening')
				const stepTween = (now) => {
					const progress = Math.min(1, (now - start) / duration)
					const eased = 1 - (1 - progress) ** 3
					track.scrollTo({ left: from + (to - from) * eased, behavior: 'instant' })
					if (progress < 1) tween = requestAnimationFrame(stepTween)
					else stopTween()
				}
				tween = requestAnimationFrame(stepTween)
			}
			setCurrent(target)
		}

		// Manual navigation: announce the position and end the slideshow.
		function takeOver(index) {
			setSlideshow(false)
			goTo(index)
		}

		function setCurrent(index) {
			current = index
			slides.forEach((slide, slideIndex) => slide.classList.toggle('is-current', slideIndex === index))
			dotButtons.forEach((button, buttonIndex) => {
				if (buttonIndex === index) button.setAttribute('aria-current', 'true')
				else button.removeAttribute('aria-current')
			})
			if (status) status.textContent = `${index + 1} / ${total}`
		}

		function schedule() {
			window.clearTimeout(timer)
			timer = 0
			if (!slideshow || hovering || focused || document.hidden) return
			timer = window.setTimeout(() => goTo(current + 1), SLIDESHOW_INTERVAL)
		}

		// The button's accessible name says what it does next (pause or resume);
		// no aria-pressed, as the ARIA carousel pattern recommends.
		function setSlideshow(value) {
			slideshow = value
			playButton.setAttribute('aria-label', t(value ? 'carouselPause' : 'carouselPlay'))
			playButton.textContent = value ? '❚❚' : '▶'
			// Automatic transitions stay silent for screen readers; manual ones are announced.
			if (status) status.setAttribute('aria-live', value ? 'off' : 'polite')
			schedule()
		}

		let frame = 0
		track.addEventListener('scroll', () => {
			if (frame) return
			frame = requestAnimationFrame(() => {
				frame = 0
				if (tween) return // our own tween already knows where it is going
				const middle = track.scrollLeft + track.clientWidth / 2
				let nearest = 0
				let distance = Infinity
				slides.forEach((slide, index) => {
					const gap = Math.abs(slide.offsetLeft + slide.clientWidth / 2 - middle)
					if (gap < distance) { distance = gap; nearest = index }
				})
				if (nearest !== current) setCurrent(nearest)
				schedule()
			})
		}, { passive: true })
		previous.addEventListener('click', () => takeOver(current - 1))
		next.addEventListener('click', () => takeOver(current + 1))
		playButton.addEventListener('click', () => setSlideshow(!slideshow))
		track.addEventListener('pointerdown', () => { stopTween(); setSlideshow(false) }, { passive: true })
		const carousel = track.closest('.carousel')
		// Mouse hover and keyboard focus each hold the slideshow on their own.
		// Touch pointers do not count: phones rarely send pointerleave.
		carousel.addEventListener('pointerenter', (event) => { if (event.pointerType === 'mouse') { hovering = true; schedule() } })
		carousel.addEventListener('pointerleave', (event) => { if (event.pointerType === 'mouse') { hovering = false; schedule() } })
		carousel.addEventListener('focusin', () => { focused = true; schedule() })
		carousel.addEventListener('focusout', (event) => { if (!carousel.contains(event.relatedTarget)) { focused = false; schedule() } })
		document.addEventListener('visibilitychange', schedule)
		reducedMotion.addEventListener?.('change', () => { if (reducedMotion.matches) setSlideshow(false) })
		document.addEventListener('keydown', (event) => {
			if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
			const target = event.target
			if (target instanceof Element && target.closest('input, textarea, select, dialog[open], video, [contenteditable=""], [contenteditable="true"]')) return
			if (event.key === 'ArrowLeft') { event.preventDefault(); takeOver(current - 1) }
			else if (event.key === 'ArrowRight') { event.preventDefault(); takeOver(current + 1) }
			else if (event.key === 'Home' && target === track) { event.preventDefault(); takeOver(0) }
			else if (event.key === 'End' && target === track) { event.preventDefault(); takeOver(total - 1) }
		})
		window.addEventListener('resize', () => track.scrollTo({ left: offsetFor(current), behavior: 'instant' }))
		track.scrollTo({ left: offsetFor(0), behavior: 'instant' })
		setCurrent(0)
		setSlideshow(slideshow)
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
	initCarousel()
	watchForBookmarklet()

	function initKaraokePlayer() {
		const stage = document.querySelector('#karaoke-stage')
		const audio = document.querySelector('#demo-clip')
		const playBtn = document.querySelector('#karaoke-play')
		const timeEl = document.querySelector('#karaoke-time')
		const durationEl = document.querySelector('#karaoke-duration')
		const scrubBar = document.querySelector('#karaoke-scrub')
		const barFill = document.querySelector('#karaoke-bar-fill')
		const fsBtn = document.querySelector('#karaoke-fs')
		const beforeEl = document.querySelector('#lyrics-before')
		const nowBtn = document.querySelector('#lyrics-now')
		const afterEl = document.querySelector('#lyrics-after')
		if (!stage || !audio || !playBtn || !beforeEl || !nowBtn || !afterEl) return

		const words = [{"startMs": 9341, "endMs": 9521, "text": "There's"}, {"startMs": 9581, "endMs": 9941, "text": "antimony,"}, {"startMs": 10021, "endMs": 10381, "text": "arsenic,"}, {"startMs": 10401, "endMs": 10801, "text": "aluminum,"}, {"startMs": 10861, "endMs": 11321, "text": "selenium,"}, {"startMs": 11361, "endMs": 11441, "text": "and"}, {"startMs": 11461, "endMs": 11821, "text": "hydrogen"}, {"startMs": 11861, "endMs": 11961, "text": "and"}, {"startMs": 12001, "endMs": 12321, "text": "oxygen"}, {"startMs": 12361, "endMs": 12441, "text": "and"}, {"startMs": 12461, "endMs": 12821, "text": "nitrogen"}, {"startMs": 12881, "endMs": 12961, "text": "and"}, {"startMs": 12981, "endMs": 13361, "text": "rhenium,"}, {"startMs": 13401, "endMs": 13481, "text": "and"}, {"startMs": 13481, "endMs": 13681, "text": "nickel,"}, {"startMs": 13701, "endMs": 14301, "text": "neodymium,"}, {"startMs": 14341, "endMs": 14821, "text": "neptunium,"}, {"startMs": 14841, "endMs": 15362, "text": "germanium,"}, {"startMs": 15402, "endMs": 15482, "text": "and"}, {"startMs": 15622, "endMs": 15762, "text": "iron,"}, {"startMs": 15802, "endMs": 16362, "text": "americium,"}, {"startMs": 16402, "endMs": 16902, "text": "ruthenium,"}, {"startMs": 16962, "endMs": 17422, "text": "uranium,"}, {"startMs": 17482, "endMs": 17902, "text": "europium,"}, {"startMs": 17962, "endMs": 18442, "text": "zirconium,"}, {"startMs": 18482, "endMs": 19002, "text": "lutetium,"}, {"startMs": 19022, "endMs": 19482, "text": "vanadium,"}, {"startMs": 19502, "endMs": 19582, "text": "and"}, {"startMs": 19602, "endMs": 20002, "text": "lanthanum"}, {"startMs": 20022, "endMs": 20102, "text": "and"}, {"startMs": 20162, "endMs": 20522, "text": "osmium"}, {"startMs": 20542, "endMs": 20622, "text": "and"}, {"startMs": 20682, "endMs": 21102, "text": "astatine"}, {"startMs": 21102, "endMs": 21202, "text": "and"}, {"startMs": 21222, "endMs": 21542, "text": "radium,"}, {"startMs": 21582, "endMs": 21642, "text": "and"}, {"startMs": 21682, "endMs": 21842, "text": "gold"}, {"startMs": 21862, "endMs": 21922, "text": "and"}, {"startMs": 21922, "endMs": 22562, "text": "protactinium"}, {"startMs": 22602, "endMs": 22682, "text": "and"}, {"startMs": 22723, "endMs": 23043, "text": "indium"}, {"startMs": 23063, "endMs": 23143, "text": "and"}, {"startMs": 23183, "endMs": 23663, "text": "gallium,"}, {"startMs": 24583, "endMs": 24683, "text": "and"}, {"startMs": 24843, "endMs": 25123, "text": "iodine"}, {"startMs": 25123, "endMs": 25223, "text": "and"}, {"startMs": 25263, "endMs": 25643, "text": "thorium"}, {"startMs": 25663, "endMs": 25763, "text": "and"}, {"startMs": 25843, "endMs": 26223, "text": "thulium"}, {"startMs": 26243, "endMs": 26323, "text": "and"}, {"startMs": 26403, "endMs": 26903, "text": "thallium."}, {"startMs": 28803, "endMs": 29003, "text": "There's"}, {"startMs": 29063, "endMs": 29363, "text": "yttrium,"}, {"startMs": 29403, "endMs": 29903, "text": "ytterbium,"}, {"startMs": 29943, "endMs": 30384, "text": "actinium,"}, {"startMs": 30444, "endMs": 30904, "text": "rubidium,"}, {"startMs": 30944, "endMs": 31024, "text": "and"}, {"startMs": 31044, "endMs": 31304, "text": "boron,"}, {"startMs": 31344, "endMs": 31904, "text": "gadolinium,"}, {"startMs": 31944, "endMs": 32444, "text": "niobium,"}, {"startMs": 32484, "endMs": 32924, "text": "iridium,"}, {"startMs": 32964, "endMs": 33044, "text": "and"}, {"startMs": 33044, "endMs": 33444, "text": "strontium"}, {"startMs": 33464, "endMs": 33564, "text": "and"}, {"startMs": 33584, "endMs": 33944, "text": "silicon"}, {"startMs": 33964, "endMs": 34064, "text": "and"}, {"startMs": 34104, "endMs": 34404, "text": "silver"}, {"startMs": 34424, "endMs": 34504, "text": "and"}, {"startMs": 34524, "endMs": 35064, "text": "samarium,"}, {"startMs": 35084, "endMs": 35164, "text": "and"}, {"startMs": 35204, "endMs": 35484, "text": "bismuth,"}, {"startMs": 35504, "endMs": 35844, "text": "bromine,"}, {"startMs": 35844, "endMs": 36164, "text": "lithium,"}, {"startMs": 36184, "endMs": 36644, "text": "beryllium,"}, {"startMs": 36664, "endMs": 36764, "text": "and"}, {"startMs": 36804, "endMs": 37304, "text": "barium."}, {"startMs": 43505, "endMs": 43685, "text": "There's"}, {"startMs": 43725, "endMs": 44085, "text": "holmium"}, {"startMs": 44105, "endMs": 44205, "text": "and"}, {"startMs": 44205, "endMs": 44545, "text": "helium"}, {"startMs": 44585, "endMs": 44645, "text": "and"}, {"startMs": 44665, "endMs": 45045, "text": "hafnium"}, {"startMs": 45085, "endMs": 45165, "text": "and"}, {"startMs": 45205, "endMs": 45526, "text": "erbium,"}, {"startMs": 45566, "endMs": 45646, "text": "and"}, {"startMs": 45686, "endMs": 46086, "text": "phosphorus"}, {"startMs": 46126, "endMs": 46206, "text": "and"}, {"startMs": 46206, "endMs": 46566, "text": "francium"}, {"startMs": 46606, "endMs": 46686, "text": "and"}, {"startMs": 46706, "endMs": 47126, "text": "fluorine"}, {"startMs": 47146, "endMs": 47206, "text": "and"}, {"startMs": 47226, "endMs": 47626, "text": "terbium,"}, {"startMs": 47666, "endMs": 47746, "text": "and"}, {"startMs": 47746, "endMs": 48166, "text": "manganese"}, {"startMs": 48166, "endMs": 48246, "text": "and"}, {"startMs": 48246, "endMs": 48566, "text": "mercury,"}, {"startMs": 48626, "endMs": 49086, "text": "molybdenum,"}, {"startMs": 49106, "endMs": 49606, "text": "magnesium,"}, {"startMs": 49626, "endMs": 50146, "text": "dysprosium,"}, {"startMs": 50166, "endMs": 50246, "text": "and"}, {"startMs": 50266, "endMs": 50666, "text": "scandium"}, {"startMs": 50686, "endMs": 50786, "text": "and"}, {"startMs": 50806, "endMs": 51186, "text": "cerium"}, {"startMs": 51206, "endMs": 51306, "text": "and"}, {"startMs": 51346, "endMs": 51746, "text": "cesium,"}, {"startMs": 51786, "endMs": 51846, "text": "and"}, {"startMs": 51886, "endMs": 51986, "text": "lead,"}, {"startMs": 52026, "endMs": 52706, "text": "praseodymium,"}, {"startMs": 52726, "endMs": 52826, "text": "and"}, {"startMs": 52846, "endMs": 53247, "text": "platinum,"}, {"startMs": 53267, "endMs": 53787, "text": "plutonium,"}, {"startMs": 53807, "endMs": 54267, "text": "palladium,"}, {"startMs": 54307, "endMs": 54787, "text": "promethium,"}, {"startMs": 54807, "endMs": 55267, "text": "potassium,"}, {"startMs": 55307, "endMs": 55767, "text": "polonium,"}, {"startMs": 55787, "endMs": 55887, "text": "and"}, {"startMs": 55887, "endMs": 56247, "text": "tantalum,"}, {"startMs": 56267, "endMs": 56767, "text": "technetium,"}, {"startMs": 56807, "endMs": 57267, "text": "titanium,"}, {"startMs": 57327, "endMs": 57947, "text": "tellurium,"}, {"startMs": 59167, "endMs": 59267, "text": "and"}, {"startMs": 59307, "endMs": 59767, "text": "cadmium"}, {"startMs": 59787, "endMs": 59867, "text": "and"}, {"startMs": 59887, "endMs": 60287, "text": "calcium"}, {"startMs": 60327, "endMs": 60387, "text": "and"}, {"startMs": 60407, "endMs": 60848, "text": "chromium"}, {"startMs": 60868, "endMs": 60968, "text": "and"}, {"startMs": 61008, "endMs": 61488, "text": "curium."}, {"startMs": 63408, "endMs": 63608, "text": "There's"}, {"startMs": 63648, "endMs": 63888, "text": "sulfur,"}, {"startMs": 63928, "endMs": 64548, "text": "californium,"}, {"startMs": 64588, "endMs": 64668, "text": "and"}, {"startMs": 64688, "endMs": 65048, "text": "fermium,"}, {"startMs": 65068, "endMs": 65628, "text": "berkelium,"}, {"startMs": 65668, "endMs": 65748, "text": "and"}, {"startMs": 65768, "endMs": 65948, "text": "also"}, {"startMs": 66008, "endMs": 66628, "text": "mendelevium,"}, {"startMs": 66668, "endMs": 67188, "text": "einsteinium,"}, {"startMs": 67228, "endMs": 67728, "text": "nobelium,"}, {"startMs": 67768, "endMs": 67848, "text": "and"}, {"startMs": 67888, "endMs": 68069, "text": "argon,"}, {"startMs": 68089, "endMs": 68389, "text": "krypton,"}, {"startMs": 68409, "endMs": 68649, "text": "neon,"}, {"startMs": 68689, "endMs": 68909, "text": "radon,"}, {"startMs": 68929, "endMs": 69169, "text": "xenon,"}, {"startMs": 69189, "endMs": 69329, "text": "zinc,"}, {"startMs": 69349, "endMs": 69449, "text": "and"}, {"startMs": 69469, "endMs": 69809, "text": "rhodium,"}, {"startMs": 69829, "endMs": 69909, "text": "and"}, {"startMs": 69929, "endMs": 70209, "text": "chlorine,"}, {"startMs": 70229, "endMs": 70489, "text": "carbon,"}, {"startMs": 70509, "endMs": 70789, "text": "cobalt,"}, {"startMs": 70809, "endMs": 71049, "text": "copper,"}, {"startMs": 71069, "endMs": 71349, "text": "tungsten,"}, {"startMs": 71389, "endMs": 71529, "text": "tin,"}, {"startMs": 71549, "endMs": 71629, "text": "and"}, {"startMs": 71689, "endMs": 72149, "text": "sodium."}, {"startMs": 74289, "endMs": 74469, "text": "These"}, {"startMs": 74509, "endMs": 74649, "text": "are"}, {"startMs": 74649, "endMs": 74729, "text": "the"}, {"startMs": 74789, "endMs": 74949, "text": "only"}, {"startMs": 75089, "endMs": 75269, "text": "ones"}, {"startMs": 75309, "endMs": 75349, "text": "of"}, {"startMs": 75389, "endMs": 75549, "text": "which"}, {"startMs": 75589, "endMs": 75650, "text": "the"}, {"startMs": 75690, "endMs": 75950, "text": "news"}, {"startMs": 75990, "endMs": 76110, "text": "has"}, {"startMs": 76150, "endMs": 76310, "text": "come"}, {"startMs": 76350, "endMs": 76430, "text": "to"}, {"startMs": 76530, "endMs": 77390, "text": "Harvard,"}, {"startMs": 77970, "endMs": 78070, "text": "and"}, {"startMs": 78090, "endMs": 78210, "text": "there"}, {"startMs": 78230, "endMs": 78330, "text": "may"}, {"startMs": 78370, "endMs": 78430, "text": "be"}, {"startMs": 78490, "endMs": 78670, "text": "many"}, {"startMs": 78770, "endMs": 78990, "text": "others,"}, {"startMs": 79030, "endMs": 79110, "text": "but"}, {"startMs": 79150, "endMs": 79250, "text": "they"}, {"startMs": 79270, "endMs": 79490, "text": "haven't"}, {"startMs": 79510, "endMs": 79630, "text": "been"}, {"startMs": 79650, "endMs": 80370, "text": "discovered."}]
		let durationMs = 86491
		let timeMs = 0
		let playing = false
		let raf = 0

		const clock = (ms) => {
			const total = Math.max(0, Math.floor(ms / 1000))
			return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
		}

		function findCursor(t) {
			if (!words.length) return { index: -1, active: false }
			let lo = 0, hi = words.length - 1, candidate = -1
			while (lo <= hi) {
				const mid = (lo + hi) >> 1
				if (words[mid].startMs <= t) {
					candidate = mid
					lo = mid + 1
				} else {
					hi = mid - 1
				}
			}
			if (candidate < 0) return { index: 0, active: false }
			return { index: candidate, active: t < words[candidate].endMs }
		}

		function renderStage() {
			if (!words.length) return
			const cursor = findCursor(timeMs)
			const c = cursor.index
			const beforeWords = words.slice(Math.max(0, c - 4), c)
			const currentWord = words[c]
			const afterWords = words.slice(c + 1, c + 5)

			beforeEl.innerHTML = ''
			beforeWords.forEach((w, i) => {
				const btn = document.createElement('button')
				btn.type = 'button'
				btn.className = 'ctx'
				btn.dataset.near = String(beforeWords.length - i)
				btn.textContent = w.text
				btn.onclick = () => jumpToWord(w)
				beforeEl.appendChild(btn)
			})

			nowBtn.textContent = currentWord.text
			nowBtn.className = 'now' + (cursor.active ? ' is-sung' : '')
			nowBtn.onclick = () => jumpToWord(currentWord)

			afterEl.innerHTML = ''
			afterWords.forEach((w, i) => {
				const btn = document.createElement('button')
				btn.type = 'button'
				btn.className = 'ctx'
				btn.dataset.near = String(i + 1)
				btn.textContent = w.text
				btn.onclick = () => jumpToWord(w)
				afterEl.appendChild(btn)
			})
		}

		function updateTransport() {
			timeEl.textContent = clock(timeMs)
			const pct = durationMs > 0 ? Math.min(100, Math.max(0, (timeMs / durationMs) * 100)) : 0
			barFill.style.width = `${pct}%`
			scrubBar.setAttribute('aria-valuenow', String(Math.round(pct)))
		}

		function tick() {
			if (audio && playing) {
				timeMs = audio.currentTime * 1000
				renderStage()
				updateTransport()
				raf = requestAnimationFrame(tick)
			}
		}

		function jumpToWord(word) {
			const fraction = durationMs ? word.startMs / durationMs : 0
			seekTo(fraction)
			audio.play()
		}

		function seekTo(fraction) {
			if (!audio || !durationMs) return
			const targetSec = (fraction * durationMs) / 1000
			audio.currentTime = targetSec
			timeMs = fraction * durationMs
			renderStage()
			updateTransport()
		}

		function seekBy(deltaMs) {
			if (!audio || !durationMs) return
			const next = Math.min(durationMs, Math.max(0, timeMs + deltaMs))
			audio.currentTime = next / 1000
			timeMs = next
			renderStage()
			updateTransport()
		}

		function toggle() {
			if (audio.paused) audio.play()
			else audio.pause()
		}

		playBtn.addEventListener('click', toggle)

		audio.addEventListener('play', () => {
			playing = true
			playBtn.textContent = '❚❚'
			playBtn.setAttribute('aria-label', 'Pause')
			cancelAnimationFrame(raf)
			raf = requestAnimationFrame(tick)
		})

		audio.addEventListener('pause', () => {
			playing = false
			playBtn.textContent = '▶'
			playBtn.setAttribute('aria-label', 'Play')
			cancelAnimationFrame(raf)
			timeMs = audio.currentTime * 1000
			renderStage()
			updateTransport()
		})

		audio.addEventListener('ended', () => {
			playing = false
			playBtn.textContent = '▶'
			playBtn.setAttribute('aria-label', 'Play')
			cancelAnimationFrame(raf)
		})

		audio.addEventListener('loadedmetadata', () => {
			const d = audio.duration
			if (Number.isFinite(d) && d > 0) {
				durationMs = d * 1000
				durationEl.textContent = clock(durationMs)
			}
		})

		scrubBar.addEventListener('click', (event) => {
			const rect = scrubBar.getBoundingClientRect()
			const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
			seekTo(fraction)
		})

		async function toggleFs() {
			try {
				if (document.fullscreenElement) await document.exitFullscreen()
				else await stage.requestFullscreen()
			} catch {}
		}
		fsBtn?.addEventListener('click', toggleFs)
		document.addEventListener('fullscreenchange', () => {
			stage.classList.toggle('is-fullscreen', document.fullscreenElement === stage)
		})

		renderStage()
		updateTransport()
	}

	initKeyboardGuide()
	initKaraokePlayer()

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
