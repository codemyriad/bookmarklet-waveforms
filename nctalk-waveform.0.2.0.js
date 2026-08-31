(() => {
	'use strict'

	const VERSION = '0.2.0'
	const GLOBAL_KEY = '__NCTALK_WAVEFORM__'
	const HOST_ID = 'nctalk-waveform'
	const STORAGE_KEY = 'nctalk-waveform-placement'
	const MODE_STORAGE_KEY = 'nctalk-waveform-mode'
	const HISTORY_WINDOW_MS = 15_000
	const HISTORY_SAMPLE_MS = 50
	const SPECTROGRAM_SAMPLE_MS = 50
	const AudioContextClass = window.AudioContext || window.webkitAudioContext

	if (!AudioContextClass) {
		window.alert('Talk waveform: Web Audio is not supported by this browser.')
		return
	}

	window[GLOBAL_KEY]?.destroy?.()
	document.getElementById(HOST_ID)?.remove()

	const audioContext = new AudioContextClass()
	const sources = new Map()
	const ownedStreams = new Set()
	let nextSourceNumber = 1
	let nextTrackNumber = 1
	const trackKeys = new WeakMap()
	let mode = 'waveform'
	try {
		const savedMode = localStorage.getItem(MODE_STORAGE_KEY)
		if (['waveform', 'amplitude', 'spectrum', 'spectrogram'].includes(savedMode)) mode = savedMode
	} catch {}
	let animationFrame = 0
	let scanTimer = 0
	let destroyed = false

	const host = document.createElement('div')
	host.id = HOST_ID
	host.setAttribute('role', 'region')
	host.setAttribute('aria-label', 'Talk audio waveforms')
	const shadow = host.attachShadow({ mode: 'open' })
	shadow.innerHTML = `
		<style>
			:host {
				all: initial;
				position: fixed;
				left: 16px;
				bottom: 16px;
				z-index: 2147483647;
				width: min(420px, calc(100vw - 32px));
				height: 250px;
				min-width: 280px;
				min-height: 150px;
				max-width: calc(100vw - 16px);
				max-height: calc(100vh - 16px);
				resize: both;
				overflow: hidden;
				color-scheme: light dark;
				font: 14px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			}
			* { box-sizing: border-box; }
			[hidden] { display: none !important; }
			.panel {
				display: flex;
				flex-direction: column;
				height: 100%;
				font: 14px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
				color: #f5f7fa;
				background: rgba(22, 27, 34, .96);
				border: 1px solid rgba(255, 255, 255, .16);
				border-radius: 12px;
				box-shadow: 0 12px 40px rgba(0, 0, 0, .38);
				overflow: hidden;
			}
			.header {
				display: flex;
				align-items: center;
				gap: 8px;
				min-height: 46px;
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
			button, select {
				appearance: none;
				min-height: 32px;
				padding: 4px 9px;
				color: inherit;
				background: rgba(255, 255, 255, .08);
				border: 1px solid rgba(255, 255, 255, .12);
				border-radius: 7px;
				font: inherit;
				cursor: pointer;
			}
			button:hover, button:focus-visible, select:hover, select:focus-visible { background: rgba(255, 255, 255, .16); outline: none; }
			button:disabled { cursor: wait; opacity: .55; }
			.close { width: 32px; padding: 0; font-size: 19px; line-height: 1; }
			.body { flex: 1; min-height: 0; padding: 10px; overflow: auto; }
			.empty {
				display: grid;
				place-items: center;
				height: 100%;
				padding: 18px;
				color: #aeb6c2;
				text-align: center;
			}
			.lanes { display: grid; gap: 9px; }
			.lane {
				display: grid;
				grid-template-columns: minmax(80px, 118px) 1fr;
				align-items: center;
				gap: 9px;
				min-height: 62px;
				padding: 7px 8px;
				background: rgba(255, 255, 255, .045);
				border-radius: 8px;
			}
			.identity { min-width: 0; }
			.label { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #dce2ea; }
			.meta { display: block; margin-top: 2px; color: #8d98a7; font-size: 10px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
			.scope { position: relative; height: 46px; min-width: 0; overflow: hidden; border-radius: 5px; background: #0b1118; }
			canvas { display: block; width: 100%; height: 100%; }
			.level { position: absolute; inset: auto 0 0; height: 3px; background: linear-gradient(90deg, #4ade80, #facc15, #fb7185); transform: scaleX(0); transform-origin: left; }
			@media (max-width: 420px) {
				:host { left: 8px; bottom: 8px; width: calc(100vw - 16px); }
				.lane { grid-template-columns: 92px 1fr; }
				.mic { display: none; }
			}
		</style>
		<div class="panel">
			<div class="header">
				<span class="title">Talk waveforms</span>
				<span class="count" aria-label="Audio source count">0</span>
				<select class="mode" title="Visualization mode" aria-label="Visualization mode">
					<option value="waveform">Wave</option>
					<option value="amplitude">Level · 15s</option>
					<option value="spectrum">Spectrum</option>
					<option value="spectrogram">Spectrogram</option>
				</select>
				<button class="mic" type="button" title="Capture the microphone directly">Mic</button>
				<button class="close" type="button" title="Close" aria-label="Close Talk waveforms">&times;</button>
			</div>
			<div class="body">
				<div class="empty">Waiting for Talk audio. Join the call, or use Mic for a direct microphone test.</div>
				<div class="lanes"></div>
			</div>
		</div>`

	const header = shadow.querySelector('.header')
	const count = shadow.querySelector('.count')
	const empty = shadow.querySelector('.empty')
	const lanes = shadow.querySelector('.lanes')
	const modeButton = shadow.querySelector('.mode')
	modeButton.value = mode
	const micButton = shadow.querySelector('.mic')
	const closeButton = shadow.querySelector('.close')

	try {
		const placement = JSON.parse(localStorage.getItem(STORAGE_KEY))
		if (Number.isFinite(placement?.width)) host.style.width = `${Math.max(280, placement.width)}px`
		if (Number.isFinite(placement?.height)) host.style.height = `${Math.max(150, placement.height)}px`
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

	function sourceMeta(direction, origin) {
		return `${direction === 'local' ? 'Local' : 'Remote'} · ${origin === 'webrtc' ? 'WebRTC' : origin === 'capture' ? 'Capture' : 'DOM'}`
	}

	function isLocalMediaElement(element) {
		if (element.closest?.('.localVideoContainer, [class*="local-video"], [class*="localVideo"]')) return true
		if (element.closest?.('.video-container, [class*="participant"], [class*="remote-video"], [class*="remoteVideo"]')) return false
		return element.muted
	}

	function associateDomTrack(stream) {
		const audioTracks = stream.getAudioTracks().filter((track) => track.readyState === 'live')
		if (audioTracks.length !== 1) return
		const track = audioTracks[0]
		const currentKey = trackKeys.get(track)
		if (currentKey && sources.has(currentKey)) return
		const receiverSource = [...sources.values()].find((source) => (
			source.origin === 'webrtc'
			&& source.direction === 'remote'
			&& source.trackId === track.id
			&& source.elements.size === 0
		))
		if (receiverSource) trackKeys.set(track, receiverSource.key)
	}

	function updateEmptyState() {
		count.textContent = String(sources.size)
		empty.hidden = sources.size > 0
		lanes.hidden = sources.size === 0
	}

	function removeSource(key) {
		const source = sources.get(key)
		if (!source) return
		try { source.node.disconnect() } catch {}
		source.lane.remove()
		sources.delete(key)
		updateEmptyState()
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
			if (newLabel && newLabelQuality > existing.labelQuality) {
				existing.label = newLabel
				existing.labelElement.textContent = newLabel
				existing.labelElement.title = newLabel
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
			existing.persistent ||= Boolean(options.persistent)
			existing.metaElement.textContent = sourceMeta(existing.direction, existing.origin)
			if (options.element) existing.elements.add(options.element)
			return existing
		}

		let node
		try {
			node = audioContext.createMediaStreamSource(stream)
		} catch (error) {
			console.warn('Talk waveform could not analyse a media stream:', error)
			return null
		}
		const analyser = audioContext.createAnalyser()
		analyser.fftSize = 1024
		analyser.smoothingTimeConstant = 0.72
		node.connect(analyser)

		const providedLabel = cleanText(options.label)
		const fallbackLabel = `Participant ${nextSourceNumber++}`
		const label = providedLabel || fallbackLabel
		const lane = document.createElement('div')
		lane.className = 'lane'
		const identity = document.createElement('div')
		identity.className = 'identity'
		const labelElement = document.createElement('span')
		labelElement.className = 'label'
		labelElement.textContent = label
		labelElement.title = label
		const direction = options.direction || 'remote'
		const origin = options.origin || 'dom'
		const metaElement = document.createElement('span')
		metaElement.className = 'meta'
		metaElement.textContent = sourceMeta(direction, origin)
		identity.append(labelElement, metaElement)
		const scope = document.createElement('div')
		scope.className = 'scope'
		const canvas = document.createElement('canvas')
		canvas.setAttribute('aria-label', `${label} audio waveform`)
		const level = document.createElement('div')
		level.className = 'level'
		scope.append(canvas, level)
		lane.append(identity, scope)
		lanes.append(lane)

		const source = {
			key,
			stream,
			trackId: audioTracks[0].id,
			receiverTrack: options.receiverTrack || null,
			elements: new Set(options.element ? [options.element] : []),
			owned: Boolean(options.owned),
			persistent: Boolean(options.persistent),
			direction,
			origin,
			node,
			analyser,
			lane,
			label,
			labelElement,
			metaElement,
			labelQuality: labelQuality(label),
			canvas,
			level,
			timeData: new Float32Array(analyser.fftSize),
			frequencyData: new Uint8Array(analyser.frequencyBinCount),
			amplitudeHistory: [],
			lastHistoryAt: 0,
			spectrogramCanvas: document.createElement('canvas'),
			lastSpectrogramAt: 0,
			spectrogramFrames: 0,
			lastLevel: 0,
		}
		sources.set(key, source)
		for (const track of audioTracks) {
			track.addEventListener('ended', () => {
				if (!stream.getAudioTracks().some((candidate) => candidate.readyState === 'live')) removeSource(key)
			}, { once: true })
		}
		updateEmptyState()
		return source
	}

	function scan() {
		if (destroyed) return
		const seenElements = new Set()
		for (const element of document.querySelectorAll('audio, video')) {
			const stream = element.srcObject
			if (!(stream instanceof MediaStream) || !stream.getAudioTracks().some((track) => track.readyState === 'live')) continue
			associateDomTrack(stream)
			seenElements.add(element)
			addStream(stream, {
				element,
				label: guessLabel(element, stream),
				direction: isLocalMediaElement(element) ? 'local' : 'remote',
				origin: 'dom',
			})
		}

		for (const [key, source] of sources) {
			for (const element of source.elements) {
				if (!element.isConnected || !(element.srcObject instanceof MediaStream) || trackKey(element.srcObject) !== key) source.elements.delete(element)
			}
			const live = source.stream.getAudioTracks().some((track) => track.readyState === 'live')
			if (!live || (!source.owned && !source.persistent && source.elements.size === 0 && seenElements.size > 0)) removeSource(key)
		}
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
		source.analyser.getByteFrequencyData(source.frequencyData)
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

	function drawSpectrogram(context, source, width, height, now) {
		const buffer = source.spectrogramCanvas
		if (buffer.width !== width || buffer.height !== height) {
			buffer.width = width
			buffer.height = height
			source.lastSpectrogramAt = 0
		}
		const bufferContext = buffer.getContext('2d')
		if (now - source.lastSpectrogramAt >= SPECTROGRAM_SAMPLE_MS) {
			source.analyser.getByteFrequencyData(source.frequencyData)
			const shift = Math.max(1, Math.round((window.devicePixelRatio || 1)))
			bufferContext.drawImage(buffer, shift, 0, width - shift, height, 0, 0, width - shift, height)
			bufferContext.fillStyle = '#071018'
			bufferContext.fillRect(width - shift, 0, shift, height)
			const nyquist = audioContext.sampleRate / 2
			const maxBin = Math.min(source.frequencyData.length - 1, Math.floor(8_000 / nyquist * source.frequencyData.length))
			for (let y = 0; y < height; y++) {
				const normalizedFrequency = 1 - y / Math.max(1, height - 1)
				const bin = Math.floor(normalizedFrequency * normalizedFrequency * maxBin)
				const value = Math.max(0, (source.frequencyData[bin] - 18) / 237)
				const hue = 230 - value * 210
				bufferContext.fillStyle = `hsl(${hue} 88% ${7 + value * 60}%)`
				bufferContext.fillRect(width - shift, y, shift, 1)
			}
			source.lastSpectrogramAt = now
			source.spectrogramFrames++
		}
		context.drawImage(buffer, 0, 0, width, height)
	}

	function render(now = performance.now()) {
		if (destroyed) return
		for (const source of sources.values()) {
			const context = source.canvas.getContext('2d')
			const { width, height } = sizeCanvas(source.canvas)
			context.clearRect(0, 0, width, height)
			source.analyser.getFloatTimeDomainData(source.timeData)
			const currentLevel = sampleAmplitude(source, now)
			if (mode === 'waveform') drawWaveform(context, source, width, height)
			else if (mode === 'amplitude') drawAmplitudeHistory(context, source, width, height, now)
			else if (mode === 'spectrum') drawSpectrum(context, source, width, height)
			else drawSpectrogram(context, source, width, height, now)
			source.lastLevel = Math.max(currentLevel, source.lastLevel * .82)
			source.level.style.transform = `scaleX(${Math.min(1, source.lastLevel * 3.3)})`
		}
		animationFrame = window.requestAnimationFrame(render)
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
	let wrappedSetRemoteDescription = null
	let wrappedGetReceivers = null

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

	function inspectPeerConnection(peerConnection) {
		if (!peerConnection || peerConnection.connectionState === 'closed') return
		try {
			for (const receiver of originalGetReceivers.call(peerConnection)) captureReceiverTrack(receiver.track)
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

	if (originalSetRemoteDescription && originalGetReceivers) {
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
		try {
			peerConnectionPrototype.setRemoteDescription = wrappedSetRemoteDescription
			peerConnectionPrototype.getReceivers = wrappedGetReceivers
		} catch {}
	}

	const mediaDevices = navigator.mediaDevices
	const originalGetUserMedia = mediaDevices?.getUserMedia
	let wrappedGetUserMedia = null
	if (originalGetUserMedia) {
		wrappedGetUserMedia = async function (...args) {
			const stream = await originalGetUserMedia.apply(this, args)
			if (stream.getAudioTracks().length) addStream(stream, {
				label: 'You',
				direction: 'local',
				origin: 'capture',
				persistent: true,
			})
			return stream
		}
		try { mediaDevices.getUserMedia = wrappedGetUserMedia } catch {}
	}

	modeButton.addEventListener('change', async () => {
		await resumeAudio()
		mode = modeButton.value
		try { localStorage.setItem(MODE_STORAGE_KEY, mode) } catch {}
	})

	micButton.addEventListener('click', async () => {
		if (!originalGetUserMedia) return
		micButton.disabled = true
		try {
			await resumeAudio()
			const stream = await originalGetUserMedia.call(mediaDevices, { audio: true, video: false })
			ownedStreams.add(stream)
			addStream(stream, {
				label: 'Microphone',
				owned: true,
				persistent: true,
				direction: 'local',
				origin: 'capture',
			})
		} catch (error) {
			window.alert(`Talk waveform microphone failed: ${error.message}`)
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
				width: Math.round(bounds.width),
				height: Math.round(bounds.height),
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

	function destroy() {
		if (destroyed) return
		destroyed = true
		window.cancelAnimationFrame(animationFrame)
		window.clearInterval(scanTimer)
		resizeObserver.disconnect()
		for (const stream of ownedStreams) stream.getTracks().forEach((track) => track.stop())
		for (const source of sources.values()) {
			try { source.node.disconnect() } catch {}
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
		sources.clear()
		if (mediaDevices?.getUserMedia === wrappedGetUserMedia) {
			try { mediaDevices.getUserMedia = originalGetUserMedia } catch {}
		}
		void audioContext.close()
		host.remove()
		if (window[GLOBAL_KEY]?.destroy === destroy) delete window[GLOBAL_KEY]
	}

	closeButton.addEventListener('click', destroy)
	host.addEventListener('pointerdown', resumeAudio, { once: true })
	document.documentElement.append(host)
	resizeObserver.observe(host)
	scan()
	scanTimer = window.setInterval(scan, 750)
	animationFrame = window.requestAnimationFrame(render)

	window[GLOBAL_KEY] = {
		version: VERSION,
		sources,
		context: audioContext,
		host,
		peerConnections,
		scan,
		addStream,
		get mode() { return mode },
		destroy,
	}
})()
