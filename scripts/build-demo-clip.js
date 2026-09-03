const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Builds the short clip the homepage uses as a test signal: two spoken
// sentences over a steady 120 Hz hum (the fan), with the waveform drawn as the
// picture. Requires ffmpeg with flite, libx264 and aac.
//   node scripts/build-demo-clip.js   -> site/assets/demo-call.<version>.mp4 and .webm
// The MP4 (H.264/AAC) is for Safari; the WebM (VP9/Opus) covers Chromium
// builds without proprietary codecs.

const root = path.join(__dirname, '..')
const { version } = require(path.join(root, 'package.json'))
const outputBase = path.join(root, 'site', 'assets', `demo-call.${version}`)
const turns = [
	{ voice: 'slt', delay: 0.8, text: 'Can anyone else hear that hum?' },
	{ voice: 'rms', delay: 5.2, text: 'Yes. It is a fan, and it is on your side.' },
]
const duration = 11

function run(args) {
	const result = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args], { encoding: 'utf8' })
	if (result.status !== 0) throw new Error(result.stderr)
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-waveforms-demo-'))
try {
	const utterances = turns.map((turn, index) => {
		const textPath = path.join(directory, `turn-${index}.txt`)
		const wavPath = path.join(directory, `turn-${index}.wav`)
		fs.writeFileSync(textPath, turn.text)
		run([
			'-f', 'lavfi', '-i', `flite=textfile=${textPath}:voice=${turn.voice}`,
			'-af', 'highpass=f=90,lowpass=f=4800,speechnorm=e=6.25:r=0.00001:l=1',
			'-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', wavPath,
		])
		return wavPath
	})
	const delayed = turns.map((turn, index) => `[${index + 1}:a]adelay=${Math.round(turn.delay * 1000)}[s${index}]`).join(';')
	const labels = turns.map((turn, index) => `[s${index}]`).join('')
	const mixPath = path.join(directory, 'mix.wav')
	run([
		'-f', 'lavfi', '-t', String(duration), '-i', 'sine=frequency=120:sample_rate=48000,volume=0.035',
		...utterances.flatMap((wav) => ['-i', wav]),
		'-filter_complex', `${delayed};[0:a]${labels}amix=inputs=${turns.length + 1}:duration=first:normalize=0[out]`,
		'-map', '[out]', '-t', String(duration), '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', mixPath,
	])
	const picture = [
		'showwaves=s=640x360:mode=p2p:colors=0x38bdf8:rate=30:scale=lin:draw=full',
		"drawtext=text='test clip \u00b7 two voices and a fan':x=20:y=20:fontsize=20:fontcolor=0xfafafa@0.7",
		'format=yuv420p',
	].join(',')
	const encodings = [
		['.mp4', ['-c:v', 'libx264', '-preset', 'veryslow', '-crf', '28', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart']],
		['.webm', ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1', '-c:a', 'libopus', '-b:a', '48k']],
	]
	for (const [extension, codecs] of encodings) {
		const outputPath = outputBase + extension
		run([
			'-i', mixPath,
			'-filter_complex', `[0:a]asplit=2[a][v];[v]${picture}[vid]`,
			'-map', '[vid]', '-map', '[a]', '-r', '30', ...codecs, '-ac', '1', outputPath,
		])
		console.log(`${path.relative(root, outputPath)} (${Math.round(fs.statSync(outputPath).size / 1024)} KB)`)
	}
} finally {
	fs.rmSync(directory, { recursive: true, force: true })
}
