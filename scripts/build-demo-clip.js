const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

// Prepares the demo audio clip for the homepage: Tom Lehrer's "The Elements"
// from Cassini Format (../cassini-format/site/static/demo/elements.opus).
//   node scripts/build-demo-clip.js   -> site/assets/elements.<version>.opus and .mp4

const root = path.join(__dirname, '..')
const { version } = require(path.join(root, 'package.json'))
const cassiniSource = path.resolve(root, '..', 'cassini-format', 'site', 'static', 'demo', 'elements.opus')
const outputBase = path.join(root, 'site', 'assets', `elements.${version}`)

function run(args) {
	const result = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args], { encoding: 'utf8' })
	if (result.status !== 0) throw new Error(result.stderr)
}

if (!fs.existsSync(cassiniSource)) {
	console.error(`Source not found at ${cassiniSource}`)
	process.exit(1)
}

// Copy the bit-exact Cassini .opus bundle
const opusOutput = `${outputBase}.opus`
fs.copyFileSync(cassiniSource, opusOutput)
console.log(`${path.relative(root, opusOutput)} (${Math.round(fs.statSync(opusOutput).size / 1024)} KB)`)

// Encode MP4 (AAC audio) for Safari compatibility
const mp4Output = `${outputBase}.mp4`
run([
	'-i', cassiniSource,
	'-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
	mp4Output,
])
console.log(`${path.relative(root, mp4Output)} (${Math.round(fs.statSync(mp4Output).size / 1024)} KB)`)

