(() => {
	'use strict'

	const VERSION = '0.5.1'
	const GLOBAL_KEY = '__NCTALK_WAVEFORM__'
	const PUBLIC_GLOBAL_KEY = '__TALK_WAVEFORMS__'
	const HOST_ID = 'nctalk-waveform'
	const STORAGE_KEY = 'nctalk-waveform-placement'
	const HISTORY_WINDOW_MS = 15_000
	const AUDIO_SAMPLE_MS = 50
	const HISTORY_SAMPLE_MS = AUDIO_SAMPLE_MS
	const SPECTROGRAM_SAMPLE_MS = 100
	const SPECTROGRAM_HISTORY_WIDTH = Math.ceil(HISTORY_WINDOW_MS / SPECTROGRAM_SAMPLE_MS)
	const SPECTROGRAM_HISTORY_HEIGHT = 128
	const MODES = ['waveform', 'amplitude', 'spectrum', 'spectrogram']
	const MODE_LABELS = {
		waveform: 'Wave',
		amplitude: 'Level',
		spectrum: 'Spectrum',
		spectrogram: 'Spectrogram',
	}
	const AudioContextClass = window.AudioContext || window.webkitAudioContext

	if (!AudioContextClass) {
		const notice = document.createElement('div')
		notice.id = HOST_ID
		notice.textContent = 'This browser cannot visualize call audio.'
		Object.assign(notice.style, {
			position: 'fixed',
			left: '16px',
			bottom: '16px',
			zIndex: '2147483647',
			padding: '14px 16px',
			color: '#f5f7fa',
			background: '#161b22',
			border: '1px solid rgba(255,255,255,.16)',
			borderRadius: '11px',
			font: '14px/1.4 system-ui,sans-serif',
		})
		document.documentElement.append(notice)
		return
	}

	window[PUBLIC_GLOBAL_KEY]?.destroy?.()
	window[GLOBAL_KEY]?.destroy?.()
	document.getElementById(HOST_ID)?.remove()

	const audioContext = new AudioContextClass()
	const sources = new Map()
	const ownedStreams = new Set()
	let nextSourceNumber = 1
	let nextTrackNumber = 1
	const trackKeys = new WeakMap()
	const defaultMode = 'spectrogram'
	const isJitsiRuntime = Boolean(window.APP?.store?.getState && window.JitsiMeetJS)
	const isGoogleMeetRuntime = location.hostname === 'meet.google.com'
	const isTeamsRuntime = location.hostname === 'teams.live.com'
	const isNextcloudRuntime = /\/call\/[^/]+/.test(location.pathname) && Boolean(document.querySelector('#app-content-vue'))
	const isWhatsAppRuntime = location.hostname === 'web.whatsapp.com' || location.hostname === 'call.whatsapp.com'
	const usesCardOverlays = isJitsiRuntime || isGoogleMeetRuntime || isTeamsRuntime || isNextcloudRuntime
	let animationFrame = 0
	let sampleTimer = 0
	let scanTimer = 0
	let destroyed = false
	let collapsed = false
	const modifiedCards = new Map()
	const sourcesByView = new WeakMap()
	const mediaElementStreams = new WeakMap()
	const capturedMediaStreams = new Set()

	function hslToRgb(hue, saturation, lightness) {
		const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
		const section = ((hue % 360) + 360) % 360 / 60
		const secondary = chroma * (1 - Math.abs(section % 2 - 1))
		let red = 0
		let green = 0
		let blue = 0
		if (section < 1) [red, green] = [chroma, secondary]
		else if (section < 2) [red, green] = [secondary, chroma]
		else if (section < 3) [green, blue] = [chroma, secondary]
		else if (section < 4) [green, blue] = [secondary, chroma]
		else if (section < 5) [red, blue] = [secondary, chroma]
		else [red, blue] = [chroma, secondary]
		const match = lightness - chroma / 2
		return [red, green, blue].map((component) => Math.round((component + match) * 255))
	}

	const spectrogramPalette = new Uint8ClampedArray(256 * 4)
	for (let index = 0; index < 256; index++) {
		const value = Math.max(0, (index - 18) / 237)
		const [red, green, blue] = hslToRgb(230 - value * 210, .88, .07 + value * .6)
		const offset = index * 4
		spectrogramPalette[offset] = red
		spectrogramPalette[offset + 1] = green
		spectrogramPalette[offset + 2] = blue
		spectrogramPalette[offset + 3] = 255
	}

	const host = document.createElement('div')
	host.id = HOST_ID
	host.hidden = false
	host.setAttribute('aria-live', 'polite')
	const shadow = host.attachShadow({ mode: 'open' })
	const panelStyles = new CSSStyleSheet()
	panelStyles.replaceSync(`
			:host {
				all: initial;
				position: fixed;
				left: 16px;
				bottom: 16px;
				z-index: 2147483647;
				width: min(340px, calc(100vw - 32px));
				max-width: calc(100vw - 16px);
				overflow: visible;
				color-scheme: light dark;
				font: 14px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			}
			:host(.collapsed) { width: auto; }
			* { box-sizing: border-box; }
			[hidden] { display: none !important; }
			.panel {
				display: flex;
				flex-direction: column;
				font: 14px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
				color: #f5f7fa;
				background: rgba(22, 27, 34, .96);
				border: 1px solid rgba(255, 255, 255, .16);
				border-radius: 11px;
				box-shadow: 0 12px 40px rgba(0, 0, 0, .38);
				overflow: hidden;
			}
			.header {
				display: flex;
				align-items: center;
				gap: 8px;
				min-height: 44px;
				padding: 6px 8px 6px 13px;
				background: rgba(255, 255, 255, .055);
				border-bottom: 1px solid rgba(255, 255, 255, .1);
				cursor: move;
				user-select: none;
				touch-action: none;
			}
			.title { margin-right: auto; font-weight: 650; letter-spacing: .01em; }
			.count {
				min-width: 24px;
				padding: 2px 7px;
				border-radius: 999px;
				color: #b9f6ca;
				background: rgba(46, 160, 67, .24);
				text-align: center;
				font-size: 12px;
			}
			button {
				appearance: none;
				min-height: 30px;
				padding: 4px 9px;
				color: inherit;
				background: rgba(255, 255, 255, .08);
				border: 1px solid rgba(255, 255, 255, .12);
				border-radius: 7px;
				font: inherit;
				cursor: pointer;
			}
			button:hover, button:focus-visible { background: rgba(255, 255, 255, .16); outline: none; }
			button:disabled { cursor: wait; opacity: .55; }
			.collapse { width: 30px; padding: 0; font-size: 20px; line-height: 1; }
			.body { max-height: min(280px, calc(100vh - 90px)); padding: 8px; overflow: auto; border-top: 1px solid rgba(255, 255, 255, .1); }
			.empty {
				padding: 9px 10px;
				color: #aeb6c2;
				text-align: center;
			}
			.lanes { display: grid; gap: 7px; }
			.reopen {
				display: inline-flex;
				align-items: center;
				gap: 8px;
				min-height: 42px;
				padding: 7px 13px;
				color: #f5f7fa;
				background: rgba(22, 27, 34, .96);
				border: 1px solid rgba(255, 255, 255, .16);
				border-radius: 999px;
				box-shadow: 0 8px 28px rgba(0, 0, 0, .35);
				font-weight: 650;
				white-space: nowrap;
			}
			@media (max-width: 420px) {
				:host { left: 8px; bottom: 8px; width: min(320px, calc(100vw - 16px)); }
				:host(.collapsed) { width: auto; }
				.mic { display: none; }
			}
	`)
	shadow.adoptedStyleSheets = [panelStyles]

	function uiElement(tagName, className, textContent = '') {
		const element = document.createElement(tagName)
		if (className) element.className = className
		if (textContent) element.textContent = textContent
		return element
	}

	const panel = uiElement('div', 'panel')
	const header = uiElement('div', 'header')
	const title = uiElement('span', 'title', 'Call audio')
	const count = uiElement('span', 'count', '0')
	count.setAttribute('aria-label', 'Audio source count')
	const micButton = uiElement('button', 'mic', 'Mic test')
	micButton.type = 'button'
	micButton.title = 'Direct microphone fallback'
	const collapseButton = uiElement('button', 'collapse', '−')
	collapseButton.type = 'button'
	collapseButton.title = 'Collapse'
	collapseButton.setAttribute('aria-label', 'Collapse call audio')
	header.append(title, count, micButton, collapseButton)
	const body = uiElement('div', 'body')
	const empty = uiElement('div', 'empty', 'Looking for audio streams…')
	const lanes = uiElement('div', 'lanes')
	body.append(empty, lanes)
	panel.append(header, body)
	const reopenButton = uiElement('button', 'reopen', 'Call audio ')
	reopenButton.type = 'button'
	reopenButton.hidden = true
	reopenButton.setAttribute('aria-label', 'Reopen call audio')
	const reopenCount = uiElement('span', 'count', '0')
	reopenButton.append(reopenCount)
	shadow.append(panel, reopenButton)
	const visibilityObserver = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			const source = sourcesByView.get(entry.target)
			if (source) source.renderVisible = entry.isIntersecting
		}
		requestRender()
	})

	try {
		const placement = JSON.parse(localStorage.getItem(STORAGE_KEY))
		if (Number.isFinite(placement?.left) && Number.isFinite(placement?.top)) {
			host.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, placement.left))}px`
			host.style.top = `${Math.max(0, Math.min(window.innerHeight - 46, placement.top))}px`
			host.style.right = 'auto'
			host.style.bottom = 'auto'
		}
	} catch {}

	function trackKey(stream) {
		return stream.getAudioTracks().map((track) => {
			let key = trackKeys.get(track)
			if (!key) {
				key = `track-${nextTrackNumber++}`
				trackKeys.set(track, key)
			}
			return key
		}).sort().join(':')
	}

	function cleanText(value) {
		return String(value || '').replace(/\s+/g, ' ').trim()
	}

	function labelQuality(value) {
		const label = cleanText(value).toLowerCase()
		if (!label || /^participant \d+$/.test(label)) return 0
		if (['guest', 'remote audio', 'audio', 'video'].includes(label)) return 1
		return 2
	}

	function guessLabel(element, stream) {
		const meetContainer = element?.closest?.('[data-participant-id],[data-self-name],[data-participant-name]')
		if (meetContainer) {
			for (const attribute of ['data-participant-name', 'data-self-name']) {
				const candidate = cleanText(meetContainer.getAttribute(attribute))
				if (candidate && candidate.length < 80) return attribute === 'data-self-name' ? 'You' : candidate
			}
			for (const candidateElement of meetContainer.querySelectorAll('[data-participant-name],[data-self-name]')) {
				for (const attribute of ['data-participant-name', 'data-self-name']) {
					const candidate = cleanText(candidateElement.getAttribute(attribute))
					if (candidate && candidate.length < 80) return attribute === 'data-self-name' ? 'You' : candidate
				}
			}
		}

		if (isTeamsRuntime) {
			if (element?.closest?.('[data-tid="prejoin-v2-video-preview-container"],[data-tid="local-video-tile"],[data-tid*="local-video"]')) return 'You'
			const teamsContainer = element?.closest?.('[data-tid*="participant"],[data-tid*="video-tile"],[data-cid],[data-participant-id]')
			for (const candidateElement of teamsContainer?.querySelectorAll?.('[data-tid*="display-name"],[data-tid*="participant-name"],[aria-label]') || []) {
				const candidate = cleanText(candidateElement.getAttribute('aria-label') || candidateElement.textContent)
				if (candidate && candidate.length < 80 && !/^(more options|mute|unmute|video|audio)$/i.test(candidate)) return candidate
			}
		}

		const labelled = cleanText(element?.getAttribute?.('aria-label'))
		if (labelled && labelled.length < 80) return labelled

		const container = element?.closest?.([
			'.video-container',
			'[class*="video-container"]',
			'[class*="participant"]',
			'[class*="call-view"]',
			'[class*="tile"]',
		].join(',')) || element?.parentElement
		const nameSelectors = [
			'.video-container__user-name',
			'.video-container__name',
			'.displayname',
			'[id$="_name"]',
			'[data-testid*="name"]',
			'[class*="participant-name"]',
			'[class*="user-name"]',
			'[class$="__name"]',
			'figcaption',
		]
		for (const selector of nameSelectors) {
			const candidate = cleanText(container?.querySelector?.(selector)?.textContent)
			if (candidate && candidate.length < 80) return candidate
		}
		const containerText = cleanText(container?.textContent)
		if (containerText && containerText.length < 80) return containerText

		const trackLabel = cleanText(stream?.getAudioTracks?.()[0]?.label)
		return trackLabel && trackLabel.length < 80 ? trackLabel : ''
	}

	function participantCardFor(element) {
		if (isTeamsRuntime) {
			return element?.closest?.([
				'[data-tid="prejoin-v2-video-preview-container"]',
				'[data-tid*="participant-tile"]',
				'[data-tid*="video-tile"]',
				'[data-cid][role="listitem"]',
			].join(',')) || null
		}
		return element?.closest?.([
			'[data-participant-id]',
			'[data-self-name]',
			'[data-participant-name]',
			'.video-container',
			'.localVideoContainer',
			'.videocontainer',
			'#localVideoContainer',
			'[id^="participant_"]',
			'[class*="video-container"]',
			'[data-testid*="participant"]',
			'[class*="participant-card"]',
			'[class*="participant-tile"]',
			'[class*="call-view__participant"]',
			'[class*="remote-video"]',
		].join(',')) || null
	}

	function isLocalMediaElement(element) {
		if (isTeamsRuntime && element.closest?.('[data-tid="prejoin-v2-video-preview-container"],[data-tid="local-video-tile"],[data-tid*="local-video"]')) return true
		if (element.closest?.('[data-self-name]')) return true
		if (element.closest?.('.localVideoContainer, #localVideoContainer, [class*="local-video"], [class*="localVideo"]')) return true
		if (element.closest?.('.video-container, [class*="participant"], [class*="remote-video"], [class*="remoteVideo"]')) return false
		return element.muted
	}

	function associateDomTrack(stream, direction) {
		const audioTracks = stream.getAudioTracks().filter((track) => track.readyState === 'live')
		if (audioTracks.length !== 1) return
		const track = audioTracks[0]
		const currentKey = trackKeys.get(track)
		if (currentKey && sources.has(currentKey)) return
		const webRtcSource = [...sources.values()].find((source) => (
			source.origin === 'webrtc'
			&& source.direction === direction
			&& source.trackId === track.id
			&& source.elements.size === 0
		))
		if (webRtcSource) trackKeys.set(track, webRtcSource.key)
	}

	function restoreCard(card) {
		if (!card || [...sources.values()].some((source) => source.card === card)) return
		if (!modifiedCards.has(card)) return
		card.style.position = modifiedCards.get(card)
		modifiedCards.delete(card)
	}

	function mountSource(source, element = null, explicitCard = null) {
		const nextCard = usesCardOverlays
			? (explicitCard?.isConnected ? explicitCard : participantCardFor(element))
			: null
		const previousCard = source.card
		if (nextCard) {
			if (!modifiedCards.has(nextCard) && getComputedStyle(nextCard).position === 'static') {
				modifiedCards.set(nextCard, nextCard.style.position)
				nextCard.style.position = 'relative'
			}
			source.card = nextCard
			source.viewHost.dataset.placement = 'card'
			nextCard.append(source.viewHost)
		} else if (!source.card?.isConnected) {
			source.card = null
			source.viewHost.dataset.placement = 'fallback'
			lanes.append(source.viewHost)
		}
		source.viewHost.hidden = collapsed
		if (previousCard && previousCard !== nextCard) restoreCard(previousCard)
		updateEmptyState()
	}

	function updateEmptyState() {
		count.textContent = String(sources.size)
		reopenCount.textContent = String(sources.size)
		empty.hidden = sources.size > 0
		const fallbackCount = [...sources.values()].filter((source) => !source.card?.isConnected).length
		empty.textContent = isWhatsAppRuntime
			? 'No call audio found yet. Join the call or try Mic test.'
			: usesCardOverlays
				? 'No call audio found yet.'
				: 'No audio streams found on this page.'
		lanes.hidden = fallbackCount === 0
		body.hidden = sources.size > 0 && fallbackCount === 0
		host.style.display = !usesCardOverlays || sources.size === 0 || fallbackCount > 0 ? '' : 'none'
		const hasLocalSource = [...sources.values()].some((source) => source.direction === 'local' && source.origin !== 'capture')
		micButton.disabled = hasLocalSource
		micButton.title = hasLocalSource ? 'Outgoing call audio is already detected' : 'Direct microphone fallback'
	}

	function removeSource(key) {
		const source = sources.get(key)
		if (!source) return
		try { source.node.disconnect() } catch {}
		const card = source.card
		visibilityObserver.unobserve(source.viewHost)
		source.viewHost.remove()
		sources.delete(key)
		restoreCard(card)
		updateEmptyState()
	}

	function createSourceView(source) {
		const viewHost = document.createElement('div')
		viewHost.className = 'nctalk-waveform-source'
		viewHost.dataset.placement = 'fallback'
		viewHost.dataset.collapsed = 'false'
		viewHost.setAttribute('role', 'group')
		const viewShadow = viewHost.attachShadow({ mode: 'open' })
		const viewStyles = new CSSStyleSheet()
		viewStyles.replaceSync(`
				:host {
					all: initial;
					display: block;
					height: 72px;
					min-width: 0;
					box-sizing: border-box;
					color-scheme: dark;
					font: 12px/1.25 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
				}
				:host([hidden]) { display: none; }
				:host([data-placement="card"]) {
					position: absolute;
					left: 8px;
					right: auto;
					bottom: 8px;
					width: min(640px, calc(100% - 16px));
					z-index: 30;
					pointer-events: auto;
				}
				:host([data-placement="card"][data-collapsed="true"]) {
					left: 8px;
					width: auto;
					min-width: 0;
					height: 30px;
				}
				* { box-sizing: border-box; }
				.view {
					position: relative;
					height: 100%;
					overflow: hidden;
					color: #f5f7fa;
					background: rgba(7, 16, 24, .86);
					border: 1px solid rgba(255, 255, 255, .22);
					border-radius: 8px;
					box-shadow: 0 4px 18px rgba(0, 0, 0, .3);
					backdrop-filter: blur(5px);
				}
				canvas { display: block; width: 100%; height: 100%; }
				.identity {
					position: absolute;
					left: 7px;
					top: 6px;
					z-index: 2;
					max-width: calc(100% - 138px);
					padding: 2px 5px;
					border-radius: 4px;
					background: rgba(0, 0, 0, .52);
					pointer-events: none;
				}
				.label { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 650; }
				.mode {
					position: absolute;
					right: 36px;
					top: 6px;
					z-index: 3;
					min-height: 25px;
					padding: 2px 7px;
					color: #f5f7fa;
					background: rgba(0, 0, 0, .62);
					border: 1px solid rgba(255, 255, 255, .26);
					border-radius: 6px;
					font: 10px/1 system-ui, sans-serif;
					cursor: pointer;
					pointer-events: auto;
				}
				.mode:hover, .mode:focus-visible { background: rgba(31, 41, 52, .92); outline: none; }
				.collapse {
					position: absolute;
					right: 6px;
					top: 6px;
					z-index: 3;
					width: 25px;
					height: 25px;
					padding: 0;
					color: #f5f7fa;
					background: rgba(0, 0, 0, .62);
					border: 1px solid rgba(255, 255, 255, .26);
					border-radius: 6px;
					font: 16px/1 system-ui, sans-serif;
					cursor: pointer;
				}
				.reopen {
					display: none;
					height: 30px;
					padding: 0 10px;
					color: #f5f7fa;
					background: rgba(7, 16, 24, .9);
					border: 1px solid rgba(255, 255, 255, .22);
					border-radius: 999px;
					box-shadow: 0 4px 18px rgba(0, 0, 0, .3);
					font: 11px/1 system-ui, sans-serif;
					cursor: pointer;
				}
				.collapse:hover, .collapse:focus-visible, .reopen:hover, .reopen:focus-visible { background: rgba(31, 41, 52, .96); outline: none; }
				:host([data-collapsed="true"]) .view { display: none; }
				:host([data-collapsed="true"]) .reopen { display: block; }
				.level { position: absolute; inset: auto 0 0; height: 3px; background: linear-gradient(90deg, #4ade80, #facc15, #fb7185); transform: scaleX(0); transform-origin: left; }
		`)
		viewShadow.adoptedStyleSheets = [viewStyles]
		const view = uiElement('div', 'view')
		const canvas = document.createElement('canvas')
		const identity = uiElement('div', 'identity')
		const labelElement = uiElement('span', 'label')
		identity.append(labelElement)
		const modeButton = uiElement('button', 'mode')
		modeButton.type = 'button'
		const sourceCollapseButton = uiElement('button', 'collapse', '−')
		sourceCollapseButton.type = 'button'
		sourceCollapseButton.title = 'Collapse audio visualization'
		sourceCollapseButton.setAttribute('aria-label', 'Collapse audio visualization')
		const level = uiElement('div', 'level')
		view.append(canvas, identity, modeButton, sourceCollapseButton, level)
		const sourceReopenButton = uiElement('button', 'reopen', 'Show audio')
		sourceReopenButton.type = 'button'
		viewShadow.append(view, sourceReopenButton)
		source.viewHost = viewHost
		source.viewShadow = viewShadow
		source.labelElement = labelElement
		source.modeButton = modeButton
		source.collapseButton = sourceCollapseButton
		source.reopenButton = sourceReopenButton
		source.canvas = canvas
		source.level = level
		source.modeButton.addEventListener('click', async () => {
			await resumeAudio()
			source.mode = MODES[(MODES.indexOf(source.mode) + 1) % MODES.length]
			updateSourceView(source)
			requestRender()
		})
		source.collapseButton.addEventListener('click', () => setSourceCollapsed(source, true))
		source.reopenButton.addEventListener('click', async () => {
			await resumeAudio()
			setSourceCollapsed(source, false)
		})
		for (const eventName of ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu']) {
			viewHost.addEventListener(eventName, (event) => event.stopPropagation())
		}
		sourcesByView.set(viewHost, source)
		visibilityObserver.observe(viewHost)
		updateSourceView(source)
		return viewHost
	}

	function updateSourceView(source) {
		source.labelElement.textContent = source.label
		source.labelElement.title = source.label
		source.modeButton.textContent = MODE_LABELS[source.mode]
		source.modeButton.title = `Change ${source.label} visualization (currently ${MODE_LABELS[source.mode]})`
		source.modeButton.setAttribute('aria-label', source.modeButton.title)
		source.reopenButton.title = `Show ${source.label} audio visualization`
		source.reopenButton.setAttribute('aria-label', source.reopenButton.title)
		source.canvas.setAttribute('aria-label', `${source.label} ${MODE_LABELS[source.mode]} visualization`)
	}

	function setSourceCollapsed(source, value) {
		source.collapsed = Boolean(value)
		source.viewHost.dataset.collapsed = String(source.collapsed)
		requestRender()
	}

	function addStream(stream, options = {}) {
		if (!(stream instanceof MediaStream)) return null
		const audioTracks = stream.getAudioTracks().filter((track) => track.readyState === 'live')
		if (!audioTracks.length) return null

		const key = trackKey(stream)
		if (!key) return null
		const existing = sources.get(key)
		if (existing) {
			const newLabel = cleanText(options.label)
			const newLabelQuality = labelQuality(newLabel)
			if (newLabel && (newLabelQuality > existing.labelQuality || options.authoritativeLabel || options.senderTrack)) {
				existing.label = newLabel
				existing.labelQuality = newLabelQuality
			}
			if (options.origin === 'webrtc') {
				existing.direction = options.direction || 'remote'
				existing.origin = 'webrtc'
			} else if (existing.origin !== 'webrtc') {
				if (options.direction) existing.direction = options.direction
				if (options.origin === 'capture' || !existing.origin) existing.origin = options.origin
			}
			if (options.receiverTrack) existing.receiverTrack = options.receiverTrack
			if (options.senderTrack) existing.senderTrack = options.senderTrack
			if (options.jitsiParticipantId) existing.jitsiParticipantId = options.jitsiParticipantId
			existing.persistent ||= Boolean(options.persistent)
			if (options.element) {
				existing.elements.add(options.element)
				mountSource(existing, options.element, options.card)
			}
			else if (options.card) mountSource(existing, null, options.card)
			updateSourceView(existing)
			return existing
		}

		let node
		try {
			node = audioContext.createMediaStreamSource(stream)
		} catch (error) {
			console.warn('Talk waveforms could not analyse a media stream:', error)
			return null
		}
		const analyser = audioContext.createAnalyser()
		analyser.fftSize = 1024
		analyser.smoothingTimeConstant = 0.72
		node.connect(analyser)

		const providedLabel = cleanText(options.label)
		const fallbackLabel = `Participant ${nextSourceNumber++}`
		const label = providedLabel || fallbackLabel
		const direction = options.direction || 'remote'
		const origin = options.origin || 'dom'

		const source = {
			key,
			stream,
			trackId: audioTracks[0].id,
			receiverTrack: options.receiverTrack || null,
			senderTrack: options.senderTrack || null,
			elements: new Set(options.element ? [options.element] : []),
			owned: Boolean(options.owned),
			persistent: Boolean(options.persistent),
			direction,
			origin,
			jitsiParticipantId: options.jitsiParticipantId || null,
			node,
			analyser,
			card: null,
			viewHost: null,
			label,
			labelQuality: labelQuality(label),
			mode: defaultMode,
			collapsed: false,
			timeData: new Float32Array(analyser.fftSize),
			frequencyData: new Uint8Array(analyser.frequencyBinCount),
			amplitudeHistory: [],
			lastHistoryAt: 0,
			spectrogramCanvas: document.createElement('canvas'),
			spectrogramContext: null,
			spectrogramColumn: null,
			spectrogramBinMap: new Uint16Array(SPECTROGRAM_HISTORY_HEIGHT),
			spectrogramWriteIndex: 0,
			spectrogramFrameCount: 0,
			lastSpectrogramAt: 0,
			spectrogramFrames: 0,
			lastLevel: 0,
			renderVisible: true,
			renderFrames: 0,
			lastRenderedMode: null,
			lastRenderedFrequencyFrame: -1,
		}
		source.spectrogramCanvas.width = SPECTROGRAM_HISTORY_WIDTH
		source.spectrogramCanvas.height = SPECTROGRAM_HISTORY_HEIGHT
		source.spectrogramContext = source.spectrogramCanvas.getContext('2d')
		source.spectrogramContext.fillStyle = '#071018'
		source.spectrogramContext.fillRect(0, 0, SPECTROGRAM_HISTORY_WIDTH, SPECTROGRAM_HISTORY_HEIGHT)
		source.spectrogramColumn = source.spectrogramContext.createImageData(1, SPECTROGRAM_HISTORY_HEIGHT)
		const nyquist = audioContext.sampleRate / 2
		const maxBin = Math.min(source.frequencyData.length - 1, Math.floor(8_000 / nyquist * source.frequencyData.length))
		for (let y = 0; y < SPECTROGRAM_HISTORY_HEIGHT; y++) {
			const normalizedFrequency = 1 - y / Math.max(1, SPECTROGRAM_HISTORY_HEIGHT - 1)
			source.spectrogramBinMap[y] = Math.floor(normalizedFrequency * normalizedFrequency * maxBin)
		}
		createSourceView(source)
		source.lane = source.viewHost
		sources.set(key, source)
		mountSource(source, options.element, options.card)
		for (const track of audioTracks) {
			track.addEventListener('ended', () => {
				if (!stream.getAudioTracks().some((candidate) => candidate.readyState === 'live')) removeSource(key)
			}, { once: true })
		}
		updateEmptyState()
		return source
	}

	function scanJitsiTracks() {
		const state = window.APP?.store?.getState?.()
		const tracks = state?.['features/base/tracks']
		const participants = state?.['features/base/participants']
		if (!Array.isArray(tracks) || !participants) return

		for (const trackState of tracks) {
			if (trackState?.mediaType !== 'audio') continue
			const jitsiTrack = trackState.jitsiTrack
			const track = jitsiTrack?.getTrack?.()
			if (!(track instanceof MediaStreamTrack) || track.readyState !== 'live') continue
			const local = Boolean(trackState.local)
			const participantId = trackState.participantId || jitsiTrack?.getParticipantId?.()
			const participant = local ? participants.local : participants.remote?.get?.(participantId)
			const card = local
				? document.querySelector('#localVideoContainer')
				: document.getElementById(`participant_${participantId}`)
			const source = addStream(new MediaStream([track]), {
				label: local ? 'You' : participant?.name,
				authoritativeLabel: true,
				direction: local ? 'local' : 'remote',
				origin: 'webrtc',
				persistent: true,
				card,
				jitsiParticipantId: participantId,
				...(local ? { senderTrack: track } : { receiverTrack: track }),
			})
			if (source && card && source.card !== card) mountSource(source, null, card)
		}
	}

	function directOrCapturedStream(element) {
		const directStream = element.srcObject
		if (directStream instanceof MediaStream
			&& directStream.getAudioTracks().some((track) => track.readyState === 'live')) return directStream

		let capturedStream = mediaElementStreams.get(element)
		if (!capturedStream
			&& !element.muted
			&& element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
			const capture = element.captureStream || element.mozCaptureStream
			if (typeof capture === 'function') {
				try {
					capturedStream = capture.call(element)
					if (capturedStream instanceof MediaStream) {
						mediaElementStreams.set(element, capturedStream)
						capturedMediaStreams.add(capturedStream)
					}
				} catch {}
			}
		}
		return capturedStream instanceof MediaStream
			&& capturedStream.getAudioTracks().some((track) => track.readyState === 'live')
			? capturedStream
			: null
	}

	function knownStreamForElement(element) {
		const directStream = element.srcObject
		if (directStream instanceof MediaStream
			&& directStream.getAudioTracks().some((track) => track.readyState === 'live')) return directStream
		return mediaElementStreams.get(element) || null
	}

	function scan() {
		if (destroyed) return
		scanJitsiTracks()
		const seenElements = new Set()
		for (const element of document.querySelectorAll('audio, video')) {
			const stream = directOrCapturedStream(element)
			if (!stream) continue
			const direction = isLocalMediaElement(element) ? 'local' : 'remote'
			associateDomTrack(stream, direction)
			seenElements.add(element)
			addStream(stream, {
				element,
				label: guessLabel(element, stream),
				direction,
				origin: 'dom',
			})
		}

		for (const [key, source] of sources) {
			for (const element of source.elements) {
				const elementStream = knownStreamForElement(element)
				if (!element.isConnected || !elementStream || trackKey(elementStream) !== key) source.elements.delete(element)
			}
			if (!source.card?.isConnected) {
				const connectedElement = [...source.elements].find((element) => element.isConnected)
				mountSource(source, connectedElement)
			}
			const live = source.stream.getAudioTracks().some((track) => track.readyState === 'live')
			if (!live || (!source.owned && !source.persistent && source.elements.size === 0 && seenElements.size > 0)) removeSource(key)
		}
		updateEmptyState()
	}

	function sizeCanvas(canvas) {
		const ratio = Math.min(window.devicePixelRatio || 1, 2)
		const width = Math.max(1, Math.round(canvas.clientWidth * ratio))
		const height = Math.max(1, Math.round(canvas.clientHeight * ratio))
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width
			canvas.height = height
		}
		return { width, height }
	}

	function drawWaveform(context, source, width, height) {
		context.strokeStyle = 'rgba(255, 255, 255, .09)'
		context.lineWidth = 1
		context.beginPath()
		context.moveTo(0, Math.round(height / 2) + .5)
		context.lineTo(width, Math.round(height / 2) + .5)
		context.stroke()
		context.beginPath()
		for (let index = 0; index < source.timeData.length; index++) {
			const x = index * width / (source.timeData.length - 1)
			const y = (1 - source.timeData[index]) * height / 2
			if (index === 0) context.moveTo(x, y)
			else context.lineTo(x, y)
		}
		context.strokeStyle = '#5eead4'
		context.lineWidth = Math.max(1.5, width / 360)
		context.stroke()
	}

	function sampleAmplitude(source, now) {
		let sum = 0
		for (const sample of source.timeData) sum += sample * sample
		const level = Math.sqrt(sum / source.timeData.length)
		if (now - source.lastHistoryAt >= HISTORY_SAMPLE_MS) {
			source.amplitudeHistory.push({ time: now, level })
			source.lastHistoryAt = now
			const cutoff = now - HISTORY_WINDOW_MS
			while (source.amplitudeHistory[0]?.time < cutoff) source.amplitudeHistory.shift()
		}
		return level
	}

	function drawAmplitudeHistory(context, source, width, height, now) {
		context.strokeStyle = 'rgba(255, 255, 255, .07)'
		context.lineWidth = 1
		for (let seconds = 5; seconds < HISTORY_WINDOW_MS / 1000; seconds += 5) {
			const x = width - seconds * 1000 / HISTORY_WINDOW_MS * width
			context.beginPath()
			context.moveTo(Math.round(x) + .5, 0)
			context.lineTo(Math.round(x) + .5, height)
			context.stroke()
		}
		if (!source.amplitudeHistory.length) return
		const cutoff = now - HISTORY_WINDOW_MS
		context.beginPath()
		for (let index = 0; index < source.amplitudeHistory.length; index++) {
			const sample = source.amplitudeHistory[index]
			const x = Math.max(0, (sample.time - cutoff) / HISTORY_WINDOW_MS * width)
			const y = height - Math.min(1, sample.level * 3.3) * (height - 4) - 2
			if (index === 0) context.moveTo(x, y)
			else context.lineTo(x, y)
		}
		context.strokeStyle = '#5eead4'
		context.lineWidth = Math.max(1.5, width / 360)
		context.stroke()

		const last = source.amplitudeHistory[source.amplitudeHistory.length - 1]
		const lastX = Math.max(0, (last.time - cutoff) / HISTORY_WINDOW_MS * width)
		context.lineTo(lastX, height)
		context.lineTo(Math.max(0, (source.amplitudeHistory[0].time - cutoff) / HISTORY_WINDOW_MS * width), height)
		context.closePath()
		const gradient = context.createLinearGradient(0, 0, 0, height)
		gradient.addColorStop(0, 'rgba(94, 234, 212, .38)')
		gradient.addColorStop(1, 'rgba(94, 234, 212, .02)')
		context.fillStyle = gradient
		context.fill()
	}

	function drawSpectrum(context, source, width, height) {
		const bars = Math.min(56, source.frequencyData.length)
		const step = Math.max(1, Math.floor(source.frequencyData.length * 0.58 / bars))
		const gap = 1
		const barWidth = Math.max(1, width / bars - gap)
		for (let index = 0; index < bars; index++) {
			const value = source.frequencyData[index * step] / 255
			const barHeight = Math.max(1, value * height)
			context.fillStyle = `hsl(${168 - value * 35} 78% ${58 + value * 8}%)`
			context.fillRect(index * (barWidth + gap), height - barHeight, barWidth, barHeight)
		}
	}

	function sampleSpectrogram(source, now) {
		if (now - source.lastSpectrogramAt < SPECTROGRAM_SAMPLE_MS) return
		source.analyser.getByteFrequencyData(source.frequencyData)
		const pixels = source.spectrogramColumn.data
		for (let y = 0; y < SPECTROGRAM_HISTORY_HEIGHT; y++) {
			const paletteOffset = source.frequencyData[source.spectrogramBinMap[y]] * 4
			const pixelOffset = y * 4
			pixels[pixelOffset] = spectrogramPalette[paletteOffset]
			pixels[pixelOffset + 1] = spectrogramPalette[paletteOffset + 1]
			pixels[pixelOffset + 2] = spectrogramPalette[paletteOffset + 2]
			pixels[pixelOffset + 3] = 255
		}
		source.spectrogramContext.putImageData(source.spectrogramColumn, source.spectrogramWriteIndex, 0)
		source.spectrogramWriteIndex = (source.spectrogramWriteIndex + 1) % SPECTROGRAM_HISTORY_WIDTH
		source.spectrogramFrameCount = Math.min(SPECTROGRAM_HISTORY_WIDTH, source.spectrogramFrameCount + 1)
		source.lastSpectrogramAt = now
		source.spectrogramFrames++
	}

	function drawSpectrogram(context, source, width, height) {
		const buffer = source.spectrogramCanvas
		const frames = source.spectrogramFrameCount
		if (!frames) return
		if (frames < SPECTROGRAM_HISTORY_WIDTH) {
			const destinationX = width * (SPECTROGRAM_HISTORY_WIDTH - frames) / SPECTROGRAM_HISTORY_WIDTH
			context.drawImage(buffer, 0, 0, frames, buffer.height, destinationX, 0, width - destinationX, height)
			return
		}
		const oldest = source.spectrogramWriteIndex
		const firstWidth = SPECTROGRAM_HISTORY_WIDTH - oldest
		const split = firstWidth / SPECTROGRAM_HISTORY_WIDTH * width
		context.drawImage(buffer, oldest, 0, firstWidth, buffer.height, 0, 0, split, height)
		if (oldest) context.drawImage(buffer, 0, 0, oldest, buffer.height, split, 0, width - split, height)
	}

	function sampleSources(now = performance.now()) {
		if (destroyed) return
		for (const source of sources.values()) {
			source.analyser.getFloatTimeDomainData(source.timeData)
			const currentLevel = sampleAmplitude(source, now)
			source.lastLevel = Math.max(currentLevel, source.lastLevel * .72)
			sampleSpectrogram(source, now)
		}
		requestRender()
	}

	function requestRender() {
		if (destroyed || document.hidden || animationFrame) return
		animationFrame = window.requestAnimationFrame(render)
	}

	function render(now = performance.now()) {
		animationFrame = 0
		if (destroyed || document.hidden) return
		for (const source of sources.values()) {
			if (source.collapsed || source.viewHost.hidden || !source.renderVisible || !source.viewHost.isConnected) continue
			if (!source.canvas.clientWidth || !source.canvas.clientHeight) continue
			source.level.style.transform = `scaleX(${Math.min(1, source.lastLevel * 3.3)})`
			const frequencyView = source.mode === 'spectrum' || source.mode === 'spectrogram'
			if (frequencyView
				&& source.lastRenderedMode === source.mode
				&& source.lastRenderedFrequencyFrame === source.spectrogramFrames) continue
			const context = source.canvas.getContext('2d')
			const { width, height } = sizeCanvas(source.canvas)
			context.fillStyle = '#071018'
			context.fillRect(0, 0, width, height)
			if (source.mode === 'waveform') drawWaveform(context, source, width, height)
			else if (source.mode === 'amplitude') drawAmplitudeHistory(context, source, width, height, now)
			else if (source.mode === 'spectrum') drawSpectrum(context, source, width, height)
			else drawSpectrogram(context, source, width, height)
			source.lastRenderedMode = source.mode
			source.lastRenderedFrequencyFrame = source.spectrogramFrames
			source.renderFrames++
		}
	}

	async function resumeAudio() {
		if (audioContext.state === 'suspended') {
			try { await audioContext.resume() } catch {}
		}
	}

	const peerConnections = new Set()
	const peerConnectionCleanups = new Map()
	const pendingTrackCleanups = new Map()
	const peerConnectionPrototype = window.RTCPeerConnection?.prototype
	const originalSetRemoteDescription = peerConnectionPrototype?.setRemoteDescription
	const originalGetReceivers = peerConnectionPrototype?.getReceivers
	const originalGetSenders = peerConnectionPrototype?.getSenders
	const originalAddTrack = peerConnectionPrototype?.addTrack
	const originalAddTransceiver = peerConnectionPrototype?.addTransceiver
	const senderPrototype = window.RTCRtpSender?.prototype
	const originalReplaceTrack = senderPrototype?.replaceTrack
	let wrappedSetRemoteDescription = null
	let wrappedGetReceivers = null
	let wrappedGetSenders = null
	let wrappedAddTrack = null
	let wrappedAddTransceiver = null
	let wrappedReplaceTrack = null

	function captureRemoteTrack(track) {
		if (!(track instanceof MediaStreamTrack) || track.kind !== 'audio' || track.readyState !== 'live') return null
		pendingTrackCleanups.get(track)?.()
		const currentKey = trackKeys.get(track)
		if (!currentKey || !sources.has(currentKey)) {
			const domSource = [...sources.values()].find((source) => (
				source.origin === 'dom'
				&& !source.receiverTrack
				&& source.trackId === track.id
			))
			if (domSource) trackKeys.set(track, domSource.key)
		}
		return addStream(new MediaStream([track]), {
			direction: 'remote',
			origin: 'webrtc',
			persistent: true,
			receiverTrack: track,
		})
	}

	function captureReceiverTrack(track) {
		if (!(track instanceof MediaStreamTrack) || track.kind !== 'audio' || track.readyState !== 'live') return
		if (!track.muted) {
			captureRemoteTrack(track)
			return
		}
		if (pendingTrackCleanups.has(track)) return
		const cleanup = () => {
			track.removeEventListener('unmute', onUnmute)
			track.removeEventListener('ended', cleanup)
			pendingTrackCleanups.delete(track)
		}
		const onUnmute = () => {
			cleanup()
			captureRemoteTrack(track)
		}
		track.addEventListener('unmute', onUnmute, { once: true })
		track.addEventListener('ended', cleanup, { once: true })
		pendingTrackCleanups.set(track, cleanup)
	}

	function captureLocalTrack(track) {
		if (!(track instanceof MediaStreamTrack) || track.kind !== 'audio' || track.readyState !== 'live') return null
		const currentKey = trackKeys.get(track)
		if (!currentKey || !sources.has(currentKey)) {
			const domSource = [...sources.values()].find((source) => (
				source.origin === 'dom'
				&& source.direction === 'local'
				&& !source.senderTrack
				&& source.trackId === track.id
			))
			if (domSource) trackKeys.set(track, domSource.key)
		}
		return addStream(new MediaStream([track]), {
			label: 'You',
			direction: 'local',
			origin: 'webrtc',
			persistent: true,
			senderTrack: track,
		})
	}

	function inspectPeerConnection(peerConnection) {
		if (!peerConnection || peerConnection.connectionState === 'closed') return
		try {
			for (const receiver of originalGetReceivers.call(peerConnection)) captureReceiverTrack(receiver.track)
		} catch {}
		try {
			for (const sender of originalGetSenders.call(peerConnection)) captureLocalTrack(sender.track)
		} catch {}
	}

	function watchPeerConnection(peerConnection) {
		if (!peerConnection || peerConnections.has(peerConnection)) return
		peerConnections.add(peerConnection)
		const onTrack = (event) => captureRemoteTrack(event.track)
		const onStateChange = () => {
			inspectPeerConnection(peerConnection)
			if (peerConnection.connectionState === 'closed') {
				peerConnection.removeEventListener('track', onTrack)
				peerConnection.removeEventListener('connectionstatechange', onStateChange)
				peerConnectionCleanups.delete(peerConnection)
				peerConnections.delete(peerConnection)
			}
		}
		peerConnection.addEventListener('track', onTrack)
		peerConnection.addEventListener('connectionstatechange', onStateChange)
		peerConnectionCleanups.set(peerConnection, () => {
			peerConnection.removeEventListener('track', onTrack)
			peerConnection.removeEventListener('connectionstatechange', onStateChange)
		})
		inspectPeerConnection(peerConnection)
	}

	// Jitsi publishes participant-to-track identity in its Redux store. Its raw
	// receiver track is replaced by a participant-specific playback track, so
	// generic peer-connection capture would show both as duplicate lanes.
	if (!isJitsiRuntime && originalSetRemoteDescription && originalGetReceivers && originalGetSenders) {
		wrappedSetRemoteDescription = function (...args) {
			watchPeerConnection(this)
			const result = originalSetRemoteDescription.apply(this, args)
			Promise.resolve(result).then(() => inspectPeerConnection(this), () => {})
			return result
		}
		wrappedGetReceivers = function (...args) {
			watchPeerConnection(this)
			const receivers = originalGetReceivers.apply(this, args)
			for (const receiver of receivers) captureReceiverTrack(receiver.track)
			return receivers
		}
		wrappedGetSenders = function (...args) {
			watchPeerConnection(this)
			const senders = originalGetSenders.apply(this, args)
			for (const sender of senders) captureLocalTrack(sender.track)
			return senders
		}
		wrappedAddTrack = function (track, ...streams) {
			watchPeerConnection(this)
			const sender = originalAddTrack.call(this, track, ...streams)
			captureLocalTrack(track)
			return sender
		}
		wrappedAddTransceiver = function (trackOrKind, ...args) {
			watchPeerConnection(this)
			const transceiver = originalAddTransceiver.call(this, trackOrKind, ...args)
			if (trackOrKind instanceof MediaStreamTrack) captureLocalTrack(trackOrKind)
			else captureLocalTrack(transceiver?.sender?.track)
			return transceiver
		}
		wrappedReplaceTrack = function (track) {
			const result = originalReplaceTrack.call(this, track)
			captureLocalTrack(track)
			return result
		}
		try {
			peerConnectionPrototype.setRemoteDescription = wrappedSetRemoteDescription
			peerConnectionPrototype.getReceivers = wrappedGetReceivers
			peerConnectionPrototype.getSenders = wrappedGetSenders
			if (originalAddTrack) peerConnectionPrototype.addTrack = wrappedAddTrack
			if (originalAddTransceiver) peerConnectionPrototype.addTransceiver = wrappedAddTransceiver
			if (originalReplaceTrack) senderPrototype.replaceTrack = wrappedReplaceTrack
		} catch {}
	}

	const mediaDevices = navigator.mediaDevices
	const originalGetUserMedia = mediaDevices?.getUserMedia
	let wrappedGetUserMedia = null

	if (originalGetUserMedia) {
		wrappedGetUserMedia = function (...args) {
			const result = originalGetUserMedia.apply(this, args)
			return Promise.resolve(result).then((stream) => {
				if (!destroyed && stream instanceof MediaStream
					&& stream.getAudioTracks().some((track) => track.readyState === 'live')) {
					addStream(stream, {
						label: 'You',
						direction: 'local',
						origin: 'get-user-media',
						persistent: true,
					})
				}
				return stream
			})
		}
		try { mediaDevices.getUserMedia = wrappedGetUserMedia } catch {}
	}

	micButton.addEventListener('click', async () => {
		if (!originalGetUserMedia) return
		micButton.disabled = true
		try {
			await resumeAudio()
			const stream = await originalGetUserMedia.call(mediaDevices, { audio: true, video: false })
			ownedStreams.add(stream)
			addStream(stream, {
				label: 'Microphone test',
				owned: true,
				persistent: true,
				direction: 'local',
				origin: 'capture',
			})
		} catch (error) {
			empty.textContent = `Microphone unavailable: ${error.message}`
			empty.hidden = false
			body.hidden = false
			host.style.display = ''
		} finally {
			micButton.disabled = false
		}
	})

	let drag = null
	function savePlacement() {
		if (!host.isConnected) return
		const bounds = host.getBoundingClientRect()
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({
				left: Math.round(bounds.left),
				top: Math.round(bounds.top),
			}))
		} catch {}
	}

	header.addEventListener('pointerdown', (event) => {
		if (event.target.closest('button, select')) return
		const bounds = host.getBoundingClientRect()
		drag = { pointerId: event.pointerId, x: event.clientX - bounds.left, y: event.clientY - bounds.top }
		header.setPointerCapture(event.pointerId)
	})
	header.addEventListener('pointermove', (event) => {
		if (!drag || drag.pointerId !== event.pointerId) return
		const left = Math.max(0, Math.min(window.innerWidth - host.offsetWidth, event.clientX - drag.x))
		const top = Math.max(0, Math.min(window.innerHeight - host.offsetHeight, event.clientY - drag.y))
		host.style.left = `${left}px`
		host.style.top = `${top}px`
		host.style.right = 'auto'
		host.style.bottom = 'auto'
	})
	header.addEventListener('pointerup', (event) => {
		if (drag?.pointerId === event.pointerId) {
			drag = null
			savePlacement()
		}
	})
	const resizeObserver = new ResizeObserver(savePlacement)

	function setCollapsed(value) {
		collapsed = Boolean(value)
		host.classList.toggle('collapsed', collapsed)
		panel.hidden = collapsed
		reopenButton.hidden = !collapsed
		for (const source of sources.values()) source.viewHost.hidden = collapsed
		savePlacement()
		requestRender()
	}

	function onVisibilityChange() {
		if (!document.hidden) requestRender()
	}

	function destroy() {
		if (destroyed) return
		destroyed = true
		window.cancelAnimationFrame(animationFrame)
		window.clearInterval(sampleTimer)
		window.clearInterval(scanTimer)
		document.removeEventListener('visibilitychange', onVisibilityChange)
		resizeObserver.disconnect()
		visibilityObserver.disconnect()
		for (const stream of ownedStreams) stream.getTracks().forEach((track) => track.stop())
		for (const stream of capturedMediaStreams) stream.getTracks().forEach((track) => track.stop())
		for (const source of sources.values()) {
			try { source.node.disconnect() } catch {}
			source.viewHost.remove()
		}
		for (const cleanup of peerConnectionCleanups.values()) cleanup()
		peerConnectionCleanups.clear()
		peerConnections.clear()
		for (const cleanup of pendingTrackCleanups.values()) cleanup()
		pendingTrackCleanups.clear()
		if (peerConnectionPrototype?.setRemoteDescription === wrappedSetRemoteDescription) {
			try { peerConnectionPrototype.setRemoteDescription = originalSetRemoteDescription } catch {}
		}
		if (peerConnectionPrototype?.getReceivers === wrappedGetReceivers) {
			try { peerConnectionPrototype.getReceivers = originalGetReceivers } catch {}
		}
		if (peerConnectionPrototype?.getSenders === wrappedGetSenders) {
			try { peerConnectionPrototype.getSenders = originalGetSenders } catch {}
		}
		if (peerConnectionPrototype?.addTrack === wrappedAddTrack) {
			try { peerConnectionPrototype.addTrack = originalAddTrack } catch {}
		}
		if (peerConnectionPrototype?.addTransceiver === wrappedAddTransceiver) {
			try { peerConnectionPrototype.addTransceiver = originalAddTransceiver } catch {}
		}
		if (senderPrototype?.replaceTrack === wrappedReplaceTrack) {
			try { senderPrototype.replaceTrack = originalReplaceTrack } catch {}
		}
		if (mediaDevices?.getUserMedia === wrappedGetUserMedia) {
			try { mediaDevices.getUserMedia = originalGetUserMedia } catch {}
		}
		sources.clear()
		for (const [card, originalPosition] of modifiedCards) {
			card.style.position = originalPosition
		}
		modifiedCards.clear()
		void audioContext.close()
		host.remove()
		if (window[GLOBAL_KEY]?.destroy === destroy) delete window[GLOBAL_KEY]
		if (window[PUBLIC_GLOBAL_KEY]?.destroy === destroy) delete window[PUBLIC_GLOBAL_KEY]
	}

	collapseButton.addEventListener('click', () => setCollapsed(true))
	reopenButton.addEventListener('click', async () => {
		await resumeAudio()
		setCollapsed(false)
	})
	host.addEventListener('pointerdown', resumeAudio, { once: true })
	document.documentElement.append(host)
	resizeObserver.observe(host)
	document.addEventListener('visibilitychange', onVisibilityChange)
	scan()
	scanTimer = window.setInterval(scan, 750)
	sampleSources()
	sampleTimer = window.setInterval(sampleSources, AUDIO_SAMPLE_MS)

	const publicApi = {
		version: VERSION,
		platform: isJitsiRuntime
			? 'jitsi'
			: isGoogleMeetRuntime
				? 'google-meet'
				: isTeamsRuntime
					? 'microsoft-teams'
					: isNextcloudRuntime
						? 'nextcloud-talk'
						: isWhatsAppRuntime
							? 'whatsapp'
							: 'generic',
		sources,
		context: audioContext,
		host,
		peerConnections,
		scan,
		addStream,
		get mode() { return defaultMode },
		get collapsed() { return collapsed },
		collapse: () => setCollapsed(true),
		reopen: () => setCollapsed(false),
		destroy,
	}
	window[GLOBAL_KEY] = publicApi
	window[PUBLIC_GLOBAL_KEY] = publicApi
})()
